/**
 * Per-session state machine + rate limiting.
 *
 * Tracks one state per (source, sessionId) so the console panel can show what
 * each CLI session is doing independently, and so noisy events don't spam sound.
 * Rate limits are borrowed from Code-Notify (stop 10s, notification 180s, …).
 */
import type { UnifiedEvent, UnifiedEventKind } from './protocol.js';
import { CONFIG } from './config.js';

export type SessionPhase = 'idle' | 'working' | 'waiting' | 'done' | 'error';

export interface SessionState {
  source: UnifiedEvent['source'];
  sessionId: string;
  phase: SessionPhase;
  lastSummary?: string;
  lastEventKind?: UnifiedEventKind;
  lastToolName?: string;
  cwd?: string;
  /** Last activity time (epoch ms). */
  updatedAt: number;
  /** Per-event-kind last-fired timestamps, for rate limiting sound. */
  lastSoundAt: Partial<Record<UnifiedEventKind, number>>;
}

const KEY_DELIM = '\u0001';
const key = (source: string, sessionId: string) => `${source}${KEY_DELIM}${sessionId}`;

export class SessionTracker {
  private sessions = new Map<string, SessionState>();

  /** Apply an event: mutate phase, return the (possibly rate-limited) state. */
  apply(ev: UnifiedEvent): SessionState {
    const k = key(ev.source, ev.sessionId);
    let s = this.sessions.get(k);
    if (!s) {
      s = {
        source: ev.source,
        sessionId: ev.sessionId,
        phase: 'idle',
        updatedAt: ev.ts,
        lastSoundAt: {},
      };
      this.sessions.set(k, s);
    }

    s.updatedAt = ev.ts;
    s.lastSummary = ev.summary ?? s.lastSummary;
    s.lastEventKind = ev.event;
    s.lastToolName = ev.toolName ?? s.lastToolName;
    if (ev.cwd) s.cwd = ev.cwd;
    s.phase = phaseFromEvent(ev.event, s.phase);

    return s;
  }

  /**
   * Decide whether a sound should fire for this event.
   * Returns false if the same kind fired too recently for this session.
   */
  shouldSound(ev: UnifiedEvent): boolean {
    const k = key(ev.source, ev.sessionId);
    const s = this.sessions.get(k);
    if (!s) return true;
    const limit = CONFIG.rateLimitsMs[ev.event];
    if (!limit || limit <= 0) return true;
    const last = s.lastSoundAt[ev.event];
    if (last == null) return true;
    return ev.ts - last >= limit;
  }

  /** Record that a sound fired, for future rate-limit decisions. */
  markSounded(ev: UnifiedEvent): void {
    const k = key(ev.source, ev.sessionId);
    const s = this.sessions.get(k);
    if (s) s.lastSoundAt[ev.event] = ev.ts;
  }

  /** All active sessions, for the console panel. */
  all(): SessionState[] {
    return [...this.sessions.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** Drop sessions inactive for longer than `ttlMs`. */
  gc(ttlMs: number, now = Date.now()): void {
    for (const [k, s] of this.sessions) {
      if (now - s.updatedAt > ttlMs) this.sessions.delete(k);
    }
  }
}

/** Map an incoming event kind onto the session phase, with sticky carry-over. */
function phaseFromEvent(kind: UnifiedEventKind, prev: SessionPhase): SessionPhase {
  switch (kind) {
    case 'task_started':
    case 'tool_call':
    case 'tool_result':
      return 'working';
    case 'message':
      // An assistant message can be a final answer (done) or commentary while
      // working. Keep previous phase unless we were idle.
      return prev === 'idle' ? 'working' : prev;
    case 'permission_request':
      return 'waiting';
    case 'plan_started':
      return 'waiting';
    case 'task_complete':
      return 'done';
    case 'error':
      return 'error';
    default:
      return prev;
  }
}
