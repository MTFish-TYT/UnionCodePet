/**
 * Central sound configuration.
 *
 * This is the single source of truth for "which sound plays on which event".
 * The whole point of the dispatcher architecture: sound control is owned by
 * the daemon, not scattered across per-CLI ps1 scripts. When the desktop-pet
 * UI lands, this map becomes a GUI table.
 *
 * Edit the paths below to point at your own wav files, then restart the daemon.
 * Hot-reload is not supported yet (restart required) — see TODO.
 */
import type { SoundKey } from './protocol.js';

export interface DaemonConfig {
  /** Port the local HTTP server listens on. dispatcher.ps1 POSTs here. */
  port: number;
  /** Bind address. 127.0.0.1 only — never expose outside localhost. */
  host: string;
  /** Codex session-dir polling interval in ms. */
  codexPollIntervalMs: number;
  /** Where Codex stores sessions. */
  codexSessionRoot: string;
  /** Rate limits per event kind, in ms. */
  rateLimitsMs: {
    task_complete: number;
    permission_request: number;
    plan_started: number;
    tool_call: number;
    tool_result: number;
    error: number;
    message: number;
    task_started: number;
  };
}

export const CONFIG: DaemonConfig = {
  port: 23333,
  host: '127.0.0.1',
  codexPollIntervalMs: 1500,
  // codexSessionRoot is resolved against the user profile at runtime (see
  // codex-poller.ts) because it contains %USERPROFILE%. Kept here as reference.
  codexSessionRoot: '',
  rateLimitsMs: {
    task_complete: 10_000,
    permission_request: 180_000,
    plan_started: 30_000,
    tool_call: 10_000,
    tool_result: 10_000,
    error: 10_000,
    message: 5_000,
    task_started: 5_000,
  },
};

/**
 * Sound map. Keys are `${source}:${event}`.
 *
 * Paths mirror the user's existing setup (see their notes doc), so sounds stay
 * familiar. `null` means "tracked but silent" — useful for tool_call spam that
 * you want in the panel but not as audio.
 *
 * Replace these with your own files. All currently point at existing wav files
 * verified on the user's machine.
 */
export const SOUND_MAP: Partial<Record<SoundKey, string | null>> = {
  // ---- Claude Code ----
  'claude:task_complete': 'D:\\AL\\VoicePal\\html\\client_ui\\sound\\default\\connected.wav',
  'claude:permission_request': 'D:\\AL\\VoicePal\\html\\client_ui\\sound\\default\\talkpower_requested.wav',

  // ---- Zcode ----
  'zcode:task_complete': 'D:\\AL\\VoicePal\\次元错位\\04崩月水仙\\Suisen_omake1_08.wav',
  'zcode:permission_request': 'D:\\AL\\VoicePal\\次元错位\\04崩月水仙\\Suisen_omake1_15.wav',
  'zcode:plan_started': 'D:\\AL\\VoicePal\\次元错位\\04崩月水仙\\Suisen_omake1_05.wav',

  // ---- Codex ----
  'codex:task_complete': 'D:\\AL\\VoicePal\\html\\client_ui\\sound\\default\\servergroup_assigned.wav',
  // Codex approval/idle are not exposed by `notify`; left silent intentionally.
  'codex:permission_request': null,

  // ---- Cross-cutting: noisy events default to silent ----
  'claude:tool_call': null,
  'zcode:tool_call': null,
  'codex:tool_call': null,
  'codex:message': null,
};
