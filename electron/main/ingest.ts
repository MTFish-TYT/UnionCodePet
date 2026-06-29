/**
 * Event ingestion core — the single funnel every CLI event passes through.
 *
 * Extracted from the old daemon.ts so it can be reused by the Electron main
 * process (HTTP server + Codex poller both feed into `createIngester()`).
 *
 * Unlike the old daemon, the "render" side effect is now a callback (the main
 * process broadcasts sessions to the renderer via IPC instead of drawing a
 * console panel).
 */
import { SessionTracker } from '../../src/session-state.js';
import { SoundEngine } from '../../src/sound-engine.js';
import {
  normalizeClaude,
  normalizeZcode,
  normalizeCodexNotify,
} from '../../src/normalizer.js';
import type { UnifiedEvent, CliSource } from '../../src/protocol.js';

export interface Ingester {
  /** Feed a normalized event into the funnel. */
  ingest(ev: UnifiedEvent): void;
  /** Current session states (for the renderer / health check). */
  allSessions(): ReturnType<SessionTracker['all']>;
}

interface IncomingDispatch {
  source: CliSource;
  kind?: string;
  payload?: unknown;
  sessionId?: string;
}

/**
 * Build the ingest pipeline.
 * - `onSessionsChange`: called whenever a session's state changes (main uses it
 *   to push `sessions:update` to the renderer).
 */
export function createIngester(onSessionsChange: () => void): Ingester {
  const tracker = new SessionTracker();
  const sound = new SoundEngine((m) => console.log(`[sound] ${m}`));

  function ingest(ev: UnifiedEvent): void {
    tracker.apply(ev);
    if (tracker.shouldSound(ev)) {
      if (sound.playFor(ev)) tracker.markSounded(ev);
    }
    const t = new Date().toISOString().slice(11, 23);
    console.log(`[${t}] ▶ ${ev.source}/${ev.event} ${ev.summary ?? ''}`);
    onSessionsChange();
  }

  return { ingest, allSessions: () => tracker.all() };
}

/** Turn an incoming dispatch into a normalized UnifiedEvent (or null). */
export function toUnifiedEvent(msg: IncomingDispatch): UnifiedEvent | null {
  const ts = Date.now();
  const sessionId = msg.sessionId ?? 'unknown';
  const payload = parsePayload(msg.payload);

  switch (msg.source) {
    case 'claude':
      return normalizeClaude(msg.kind ?? '', payload, sessionId, ts);
    case 'zcode':
      return normalizeZcode(payload, sessionId, ts);
    case 'codex':
      return normalizeCodexNotify(payload, sessionId, ts);
    default:
      return null;
  }
}

/**
 * Parse a hook/notify payload, which may be a JSON string or an object.
 * Three-stage fallback handles: valid JSON → control-char-stripped JSON →
 * regex extraction of ASCII fields (for Zcode's GBK-corrupted Chinese payloads).
 */
export function parsePayload(p: unknown): Record<string, unknown> | null {
  if (p == null) return null;
  if (typeof p === 'string') {
    try {
      return JSON.parse(p);
    } catch {
      // Fallback 1: strip literal control chars and retry.
      try {
        const cleaned = p.replace(/[\x00-\x1F]/g, (m) => (m === '\n' ? '\\n' : m === '\t' ? '\\t' : ''));
        return JSON.parse(cleaned);
      } catch {
        // Fall through to regex extraction.
      }
      // Fallback 2: regex extraction of ASCII state fields (mirrors play-sound.ps1).
      const obj: Record<string, unknown> = {};
      const m = (re: RegExp): string | undefined => {
        const r = p.match(re);
        return r ? r[1] : undefined;
      };
      const he = m(/"hookEventName"\s*:\s*"([^"]*)"/);
      if (he) obj.hookEventName = he;
      const tn = m(/"toolName"\s*:\s*"([^"]*)"/);
      if (tn) obj.toolName = tn;
      const sid = m(/"sessionId"\s*:\s*"([^"]*)"/);
      if (sid) obj.sessionId = sid;
      const cwd = m(/"cwd"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (cwd) obj.cwd = cwd.replace(/\\\\/g, '\\');
      return Object.keys(obj).length ? obj : null;
    }
  }
  return p as Record<string, unknown>;
}
