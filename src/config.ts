/**
 * Central configuration — now externalized to a JSON file so the UI can edit it.
 *
 * Design:
 * - `CONFIG` and `SOUND_MAP` are kept as exported mutable runtime instances so
 *   the existing modules (session-state, sound-engine, codex-poller) keep their
 *   `import { CONFIG } from './config.js'` working unchanged.
 * - On boot, `loadConfig()` reads `~/.unioncodepet/config.json` (creating it
 *   from defaults on first run) and mutates those instances in place.
 * - The UI calls `saveConfig()` to persist changes; `applyConfig()` hot-reloads
 *   them into the runtime instances without a restart.
 */
import { join } from 'node:path';
import { homedir } from 'node:os';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import type { CliSource, UnifiedEventKind, SoundKey } from './protocol.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DaemonConfig {
  /** Port the local HTTP server listens on. dispatcher.ps1 POSTs here. */
  port: number;
  /** Bind address. 127.0.0.1 only — never expose outside localhost. */
  host: string;
  /** Codex session-dir polling interval in ms. */
  codexPollIntervalMs: number;
  /** Where Codex stores sessions. Resolved at runtime if empty. */
  codexSessionRoot: string;
  /** Rate limits per event kind, in ms. */
  rateLimitsMs: Record<UnifiedEventKind, number>;
}

export interface RuntimeConfig {
  version: number;
  daemon: {
    port: number;
    host: string;
    codexPollIntervalMs: number;
  };
  rateLimitsMs: Record<UnifiedEventKind, number>;
  soundMap: Partial<Record<SoundKey, string | null>>;
  /** Active pet id (matches a pet's `id` in pets/<id>/pet.json). '' = first found. */
  activePet: string;
}

// ---------------------------------------------------------------------------
// Defaults (migrated from the old hardcoded config — keeps existing setups working)
// ---------------------------------------------------------------------------

const DEFAULT_RATE_LIMITS: Record<UnifiedEventKind, number> = {
  task_complete: 10_000,
  permission_request: 180_000,
  plan_started: 30_000,
  tool_call: 10_000,
  tool_result: 10_000,
  error: 10_000,
  message: 5_000,
  task_started: 5_000,
};

const DEFAULT_SOUND_MAP: Partial<Record<SoundKey, string | null>> = {
  'claude:task_complete': 'D:\\AL\\VoicePal\\html\\client_ui\\sound\\default\\connected.wav',
  'claude:permission_request': 'D:\\AL\\VoicePal\\html\\client_ui\\sound\\default\\talkpower_requested.wav',
  'zcode:task_complete': 'D:\\AL\\VoicePal\\次元错位\\04崩月水仙\\Suisen_omake1_08.wav',
  'zcode:permission_request': 'D:\\AL\\VoicePal\\次元错位\\04崩月水仙\\Suisen_omake1_15.wav',
  'zcode:plan_started': 'D:\\AL\\VoicePal\\次元错位\\04崩月水仙\\Suisen_omake1_05.wav',
  'codex:task_complete': 'D:\\AL\\VoicePal\\html\\client_ui\\sound\\default\\servergroup_assigned.wav',
  'codex:permission_request': null, // Codex notify doesn't expose approval
  'claude:tool_call': null,
  'zcode:tool_call': null,
  'codex:tool_call': null,
  'codex:message': null,
};

function defaultConfig(): RuntimeConfig {
  return {
    version: 1,
    daemon: { port: 23333, host: '127.0.0.1', codexPollIntervalMs: 1500 },
    rateLimitsMs: { ...DEFAULT_RATE_LIMITS },
    soundMap: { ...DEFAULT_SOUND_MAP },
    activePet: '', // '' = use the first pet found in pets/
  };
}

// ---------------------------------------------------------------------------
// Mutable runtime instances (kept for backward-compat with existing imports)
// ---------------------------------------------------------------------------

/** Daemon-level runtime config. Mutated by applyConfig(). */
export const CONFIG: DaemonConfig = {
  ...defaultConfig().daemon,
  codexSessionRoot: '', // resolved at runtime by the poller
  rateLimitsMs: { ...DEFAULT_RATE_LIMITS },
};

/** Sound map. Mutated by applyConfig(). `null` = tracked but silent. */
export const SOUND_MAP: Partial<Record<SoundKey, string | null>> = { ...DEFAULT_SOUND_MAP };

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

const CONFIG_DIR = join(homedir(), '.unioncodepet');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

export function getConfigPath(): string {
  return CONFIG_PATH;
}

/** Read config from disk; fall back to defaults + write them on first run. */
export function loadConfig(): RuntimeConfig {
  let cfg: RuntimeConfig;
  if (existsSync(CONFIG_PATH)) {
    try {
      const raw = readFileSync(CONFIG_PATH, 'utf-8');
      cfg = mergeWithDefaults(JSON.parse(raw));
    } catch {
      cfg = defaultConfig();
    }
  } else {
    // First run: persist defaults so the UI has a file to edit.
    cfg = defaultConfig();
    try {
      mkdirSync(CONFIG_DIR, { recursive: true });
      writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf-8');
    } catch {
      // Non-fatal: defaults still apply in memory.
    }
  }
  applyConfig(cfg);
  return cfg;
}

/** Persist config to disk. */
export function saveConfig(cfg: RuntimeConfig): void {
  try {
    mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf-8');
    applyConfig(cfg);
  } catch (e) {
    throw new Error(`无法写入配置文件: ${(e as Error).message}`);
  }
}

/** Hot-reload a config into the mutable runtime instances. */
export function applyConfig(cfg: RuntimeConfig): void {
  CONFIG.port = cfg.daemon.port;
  CONFIG.host = cfg.daemon.host;
  CONFIG.codexPollIntervalMs = cfg.daemon.codexPollIntervalMs;
  CONFIG.rateLimitsMs = { ...cfg.rateLimitsMs };
  // Replace SOUND_MAP contents in place (other modules hold the reference).
  for (const k of Object.keys(SOUND_MAP)) delete (SOUND_MAP as Record<string, unknown>)[k];
  Object.assign(SOUND_MAP, cfg.soundMap);
}

/** Reset to defaults, persist, and apply. */
export function resetConfig(): RuntimeConfig {
  const cfg = defaultConfig();
  saveConfig(cfg);
  return cfg;
}

/** Ensure a parsed config has all required fields (for forward-compat). */
function mergeWithDefaults(parsed: Partial<RuntimeConfig>): RuntimeConfig {
  const def = defaultConfig();
  return {
    version: parsed.version ?? def.version,
    daemon: {
      port: parsed.daemon?.port ?? def.daemon.port,
      host: parsed.daemon?.host ?? def.daemon.host,
      codexPollIntervalMs: parsed.daemon?.codexPollIntervalMs ?? def.daemon.codexPollIntervalMs,
    },
    rateLimitsMs: { ...def.rateLimitsMs, ...(parsed.rateLimitsMs ?? {}) },
    soundMap: { ...def.soundMap, ...(parsed.soundMap ?? {}) },
    activePet: parsed.activePet ?? def.activePet,
  };
}

// ---------------------------------------------------------------------------
// Helpers for the UI
// ---------------------------------------------------------------------------

export const ALL_SOURCES: CliSource[] = ['claude', 'zcode', 'codex'];
export const ALL_EVENTS: UnifiedEventKind[] = [
  'task_started', 'message', 'tool_call', 'tool_result',
  'permission_request', 'plan_started', 'task_complete', 'error',
];

/** Enumerate every possible sound-map key (source × event = 24 combos). */
export function allSoundKeys(): SoundKey[] {
  const out: SoundKey[] = [];
  for (const s of ALL_SOURCES) for (const e of ALL_EVENTS) out.push(`${s}:${e}` as SoundKey);
  return out;
}
