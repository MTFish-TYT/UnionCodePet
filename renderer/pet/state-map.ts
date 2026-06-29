// Map the live session list → a single global status (phase + bubble label).
//
// Aggregation picks the highest-priority phase across ALL CLI sessions (so the
// one pet reflects "what's happening anywhere"). The label is what the speech
// bubble shows — it includes the source + state + specific content when we
// have it (responsePreview, question text, tool name).
import type { PetState } from './animation-rows';

export type GlobalPhase = 'idle' | 'working' | 'waiting' | 'done' | 'error';

export interface PetStatus {
  phase: GlobalPhase;
  /** Text for the speech bubble; empty when phase is idle (bubble hidden). */
  label: string;
}

export interface SessionLike {
  source: string;
  phase: string;
  lastSummary?: string;
  lastEventKind?: string;
  lastToolName?: string;
  cwd?: string;
  updatedAt: number;
}

const SOURCE_LABEL: Record<string, string> = {
  claude: 'Claude',
  zcode: 'Zcode',
  codex: 'Codex',
};

/** How long a 'done' phase keeps the pet cheering before reverting to idle. */
const DONE_CHEER_MS = 10000;
/** How long a 'waiting'/'error' phase stays active before going stale. */
const STALE_MS = 120000;
/**
 * How long a 'working' phase stays active before going stale. Shorter than
 * waiting/error because working sessions should keep emitting tool_call /
 * tool_result events — if none arrive for this long, the task has likely
 * finished (or stalled) without a Stop, and the pet should drop back to idle
 * instead of pretending to work forever.
 */
const WORKING_STALE_MS = 60000;

/** Map a global phase onto the pet animation state. */
export function phaseToPetState(phase: GlobalPhase): PetState {
  switch (phase) {
    case 'waiting':
      return 'waiting';
    case 'error':
      return 'failed';
    case 'working':
      return 'running';
    case 'done':
      return 'jumping';
    case 'idle':
    default:
      return 'idle';
  }
}

/**
 * Aggregate sessions into one global status (phase + bubble label).
 * @param now epoch ms (injected for testability)
 */
export function aggregateStatus(sessions: SessionLike[], now = Date.now()): PetStatus {
  if (sessions.length === 0) return { phase: 'idle', label: '' };

  const isFresh = (s: SessionLike): boolean => now - s.updatedAt < STALE_MS;
  const labelFor = (s: SessionLike, stateText: string): string => {
    const src = SOURCE_LABEL[s.source] ?? s.source;
    const tool = s.lastToolName ? ` [${s.lastToolName}]` : '';
    return `${src}：${stateText}${tool}`;
  };

  // Priority: waiting > error > working > (done) > idle.
  const waiting = sessions.find((s) => s.phase === 'waiting' && isFresh(s));
  if (waiting) {
    // lastSummary carries the question/plan text when we have it.
    const detail = waiting.lastSummary ? `（${waiting.lastSummary}）` : '';
    return { phase: 'waiting', label: labelFor(waiting, '等待确认') + detail };
  }

  const errored = sessions.find((s) => s.phase === 'error' && isFresh(s));
  if (errored) return { phase: 'error', label: labelFor(errored, '出错') };

  const working = sessions.find((s) => s.phase === 'working' && now - s.updatedAt < WORKING_STALE_MS);
  if (working) return { phase: 'working', label: labelFor(working, '工作中') };

  // 'done' only counts if recent (within the cheer window).
  const done = sessions.find((s) => s.phase === 'done' && now - s.updatedAt < DONE_CHEER_MS);
  if (done) {
    const summary = done.lastSummary ? ` - ${done.lastSummary}` : '';
    return { phase: 'done', label: labelFor(done, '完成') + summary };
  }

  return { phase: 'idle', label: '' };
}
