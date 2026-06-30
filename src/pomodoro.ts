/**
 * Pomodoro timer state machine (pure logic, no timers / no side effects).
 *
 * Design borrows from Catime:
 *  - The user-facing config is 4 knobs (focus / short break / cycles-per-set /
 *    long break), expanded into a repeating round sequence at runtime.
 *  - Timing uses an ABSOLUTE target-end timestamp (not a setInterval accumulator)
 *    so it doesn't drift over long focus sessions. Pause/resume shifts the
 *    target to compensate for the paused interval.
 *
 * This module only computes state. The Electron side (`pomodoro-engine.ts`)
 * owns the wall-clock tick (500ms) and feeds `now` in, so this stays testable.
 */
import type { PomodoroPreset } from './config.js';

export type PomodoroPhase = 'idle' | 'focusing' | 'short-break' | 'long-break';

/** Read-only view of the engine, pushed to the timer window + config UI. */
export interface PomodoroSnapshot {
  phase: PomodoroPhase;
  /** True while a phase is counting down; false when paused or idle. */
  running: boolean;
  /** Remaining ms in the current phase (0 when idle). */
  remainingMs: number;
  /** Total ms of the current phase (for progress-bar math). */
  totalMs: number;
  /** Cursor into the expanded round sequence. */
  stepIndex: number;
  /** Total completed focus rounds (lifetime of the current run). */
  completedFocus: number;
  /** Which focus round within the current set (1..cyclesPerSet). */
  focusCountInSet: number;
  /** How many focus rounds make one set (drives long-break). */
  cyclesPerSet: number;
}

/** What a tick reports back so the engine can fire side effects (sound/pet). */
export interface TickResult {
  /** A phase just ended and we advanced to a new one. */
  phaseChanged: boolean;
  /** The phase that just finished (null if none). */
  endedPhase: PomodoroPhase | null;
  /** The phase we're now in (may equal the previous one if nothing changed). */
  phase: PomodoroPhase;
}

const MS_PER_MIN = 60_000;

/** Expand the 4 preset knobs into the per-step durations (ms) of one set. */
export function expandSetSequence(preset: PomodoroPreset): number[] {
  const focus = preset.focusMin * MS_PER_MIN;
  const short = preset.shortBreakMin * MS_PER_MIN;
  const long = preset.longBreakMin * MS_PER_MIN;
  const n = Math.max(1, Math.floor(preset.cyclesPerSet));
  const seq: number[] = [];
  for (let i = 0; i < n; i++) {
    seq.push(focus);
    // After the last focus of the set → long break; otherwise short break.
    seq.push(i === n - 1 ? long : short);
  }
  return seq;
}

/** A step is a focus phase when its index is even (0,2,4…). */
function isFocusStep(stepIndex: number): boolean {
  return stepIndex % 2 === 0;
}

/**
 * The pomodoro state machine. One instance lives in the main process; the
 * Electron wrapper drives it with a 500ms tick.
 */
export class PomodoroEngine {
  private preset: PomodoroPreset;
  /** Per-step durations of the current set, expanded from the preset. */
  private sequence: number[];
  private phase: PomodoroPhase = 'idle';
  private running = false;
  private stepIndex = 0;
  private completedFocus = 0;
  private focusCountInSet = 1;
  /** Absolute epoch-ms when the current phase should end. */
  private targetEndMs = 0;
  /** Total duration of the current phase (ms). */
  private totalMs = 0;
  /** When the current pause started (0 = not paused). */
  private pauseStartMs = 0;

  constructor(preset: PomodoroPreset) {
    this.preset = preset;
    this.sequence = expandSetSequence(preset);
  }

  /** Swap to a different preset and reset the run (used by apply-preset). */
  setPreset(preset: PomodoroPreset): void {
    this.preset = preset;
    this.sequence = expandSetSequence(preset);
    this.reset();
  }

  /** Current preset (read-only accessor). */
  getPreset(): PomodoroPreset {
    return this.preset;
  }

  /** Begin a fresh run from the first focus phase. No-op if already running. */
  start(now: number): void {
    if (this.running) return;
    this.reset();
    this.beginStep(now, 0);
  }

  /** Pause the current phase (shifts target so resume keeps the remainder). */
  pause(now: number): void {
    if (!this.running || this.phase === 'idle') return;
    this.running = false;
    this.pauseStartMs = now;
  }

  /** Resume a paused phase (compensate target for the paused interval). */
  resume(now: number): void {
    if (this.running || this.phase === 'idle' || this.pauseStartMs === 0) return;
    this.targetEndMs += now - this.pauseStartMs;
    this.pauseStartMs = 0;
    this.running = true;
  }

  /** Stop everything and return to idle (keeps the preset). */
  reset(): void {
    this.phase = 'idle';
    this.running = false;
    this.stepIndex = 0;
    this.completedFocus = 0;
    this.focusCountInSet = 1;
    this.targetEndMs = 0;
    this.totalMs = 0;
    this.pauseStartMs = 0;
  }

  /**
   * Skip the rest of the current phase and advance to the next one.
   * Returns the tick-style result so callers can fire the same side effects
   * (sound/pet) as a natural phase end.
   */
  skip(now: number): TickResult {
    if (this.phase === 'idle') {
      this.start(now);
      return { phaseChanged: true, endedPhase: null, phase: this.phase };
    }
    return this.advance(now);
  }

  /**
   * Drive the clock. Call ~every 500ms with the current epoch-ms.
   * When the current phase elapses, advances to the next phase (and loops the
   * set indefinitely — there's no global round cap; the user stops manually).
   */
  tick(now: number): TickResult {
    if (!this.running || this.phase === 'idle') {
      return { phaseChanged: false, endedPhase: null, phase: this.phase };
    }
    if (now < this.targetEndMs) {
      return { phaseChanged: false, endedPhase: null, phase: this.phase };
    }
    return this.advance(now);
  }

  /** Advance from the current phase to the next, starting it immediately. */
  private advance(now: number): TickResult {
    const endedPhase = this.phase;
    // Wrap the sequence cursor at the end of the set.
    const next = (this.stepIndex + 1) % this.sequence.length;
    this.beginStep(now, next);
    return { phaseChanged: true, endedPhase, phase: this.phase };
  }

  /** Begin a specific step: set phase/duration/target and start counting. */
  private beginStep(now: number, stepIndex: number): void {
    this.stepIndex = stepIndex;
    const duration = this.sequence[stepIndex] ?? 0;
    this.totalMs = duration;
    this.targetEndMs = now + duration;
    this.running = true;
    this.pauseStartMs = 0;

    if (isFocusStep(stepIndex)) {
      // Starting a focus step: it's a new round within the set.
      this.focusCountInSet = stepIndex / 2 + 1;
      this.phase = 'focusing';
    } else {
      // Break step: short or long depending on position in the set.
      const isLastBreak = stepIndex === this.sequence.length - 1;
      this.phase = isLastBreak ? 'long-break' : 'short-break';
    }
  }

  /**
   * Mark the just-ended focus phase as completed (call once when a focusing
   * phase naturally ends, before advance() rolls to the break). Done implicitly
   * by snapshot() consumers via completedFocus — but we bump it here so the
   * lifetime counter is correct the moment focus ends.
   */
  notifyFocusEnded(): void {
    this.completedFocus += 1;
  }

  /** Read-only snapshot for the UI. `now` injected so remainingMs is live. */
  snapshot(now: number): PomodoroSnapshot {
    let remainingMs = 0;
    if (this.running && this.phase !== 'idle') {
      remainingMs = Math.max(0, this.targetEndMs - now);
    } else if (this.phase !== 'idle') {
      // Paused: freeze at the moment we paused.
      remainingMs = this.pauseStartMs > 0
        ? Math.max(0, this.targetEndMs - this.pauseStartMs)
        : Math.max(0, this.targetEndMs - now);
    }
    return {
      phase: this.phase,
      running: this.running,
      remainingMs,
      totalMs: this.totalMs,
      stepIndex: this.stepIndex,
      completedFocus: this.completedFocus,
      focusCountInSet: this.focusCountInSet,
      cyclesPerSet: Math.max(1, Math.floor(this.preset.cyclesPerSet)),
    };
  }
}

// ---------------------------------------------------------------------------
// Formatting helpers (shared by the timer window + config UI)
// ---------------------------------------------------------------------------

/** Format remaining ms as M:SS or H:MM:SS. Ceil so we never show 00:00 early. */
export function formatRemaining(ms: number): string {
  const totalSec = Math.ceil(Math.max(0, ms) / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Human label for a phase (used by the timer window + pet bubble). */
export function phaseLabel(phase: PomodoroPhase): string {
  switch (phase) {
    case 'focusing': return '专注';
    case 'short-break': return '短休息';
    case 'long-break': return '长休息';
    case 'idle':
    default: return '空闲';
  }
}
