/**
 * Unified event protocol.
 *
 * Every CLI source (Claude Code hook, Zcode hook, Codex notify, Codex session
 * poller) is normalized into this single shape before it reaches the daemon's
 * state machine, sound engine, and console panel. Adding a new CLI only means
 * writing a new adapter that emits {@link UnifiedEvent}s.
 */

export type CliSource = 'claude' | 'zcode' | 'codex';

/**
 * High-level event kinds. These are the only things the rest of the daemon
 * cares about — the per-CLI noise (raw hook names, JSON payload shapes) is
 * stripped by the normalizer.
 */
export type UnifiedEventKind =
  | 'task_started'
  | 'message'
  | 'tool_call'
  | 'tool_result'
  | 'permission_request'
  | 'plan_started'
  | 'task_complete'
  | 'error';

export type MessageRole = 'user' | 'assistant' | 'tool';

/**
 * The single canonical event that flows through the daemon.
 *
 * `summary` is a short human-readable string (≤120 chars) used by the console
 * panel. It is NOT a full transcript — by design this project only surfaces
 * status/summary, not conversation history.
 */
export interface UnifiedEvent {
  source: CliSource;
  sessionId: string;
  event: UnifiedEventKind;
  role?: MessageRole;
  /** Short, human-readable text shown in the console panel. */
  summary?: string;
  /** Tool name when relevant (e.g. "Bash", "AskUserQuestion", "ExitPlanMode"). */
  toolName?: string;
  /** Working directory of the session, when known. */
  cwd?: string;
  /** Unix epoch milliseconds. */
  ts: number;
}

/** Composite key used by the sound map and rate limiter. */
export type SoundKey = `${CliSource}:${UnifiedEventKind}`;
