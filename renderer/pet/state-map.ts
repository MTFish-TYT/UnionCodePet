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

// ---------------------------------------------------------------------------
// Pomodoro integration (independent second source, layered on top of CLI state)
// ---------------------------------------------------------------------------

export type PomodoroPhase = 'idle' | 'focusing' | 'short-break' | 'long-break';

/** A pomodoro status slice the pet cares about (phase + live countdown). */
export interface PomodoroPetStatus {
  phase: PomodoroPhase;
  /** Remaining ms in the current phase (for the bubble countdown). */
  remainingMs: number;
  /** Current focus round within the set (1..cyclesPerSet). */
  focusCountInSet: number;
  cyclesPerSet: number;
}

/**
 * Short bubble text for the pomodoro phase, e.g. "🍅 专注".
 *
 * Only the MODE is shown — neither the countdown nor the round counter (1/4)
 * is included, because the pet window only receives phase *changes* (not the
 * 500ms ticks / per-round updates that drive the timer window). A stale time
 * or round would freeze and look broken. Live progress lives in the timer
 * overlay; the bubble just says what mode the pet is in.
 */
export function pomodoroBubbleText(p: PomodoroPetStatus): string {
  if (p.phase === 'idle') return '';
  const phaseName = p.phase === 'focusing' ? '专注' : p.phase === 'long-break' ? '长休息' : '短休息';
  return `🍅 ${phaseName}`;
}

/**
 * Decide the pet animation when the pomodoro timer is the active driver
 * (i.e. no higher-priority CLI phase is showing). Focusing → running,
 * breaks → review (a calm "thinking" pose).
 */
export function pomodoroPhaseToPetState(phase: PomodoroPhase): PetState | null {
  switch (phase) {
    case 'focusing': return 'running';
    case 'short-break':
    case 'long-break': return 'review';
    case 'idle':
    default: return null;
  }
}

/**
 * Merge a CLI pet status with a pomodoro status into the final PetStatus the
 * canvas renders. The CLI phase drives the animation (waiting/error/working
 * always win); pomodoro only contributes its bubble text (prepended when the
 * timer is running). The pomodoro→animation override is handled in PetCanvas
 * via `pomodoroOverride`, kept separate so the layering is explicit.
 */
export function mergeWithPomodoro(cli: PetStatus, pomo: PomodoroPetStatus | null): PetStatus {
  if (!pomo || pomo.phase === 'idle') return cli;
  const pomoText = pomodoroBubbleText(pomo);
  const cliActive = cli.phase === 'waiting' || cli.phase === 'error' || cli.phase === 'working';
  // Bubble: pomodoro text first, then CLI detail if the CLI is also active.
  const label = cli.label && cliActive ? `${pomoText} · ${cli.label}` : (cli.label || pomoText);
  return { phase: cli.phase, label };
}
