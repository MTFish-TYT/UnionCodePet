// Timer window global types. `window.timer` is exposed by timer-preload.mjs.
// Re-declared here (renderer-local) rather than importing from the preload,
// since electron/ is excluded from this tsconfig.

export interface PomodoroSnapshot {
  phase: 'idle' | 'focusing' | 'short-break' | 'long-break';
  running: boolean;
  remainingMs: number;
  totalMs: number;
  stepIndex: number;
  completedFocus: number;
  focusCountInSet: number;
  cyclesPerSet: number;
}

export interface TimerApi {
  getSnapshot: () => Promise<PomodoroSnapshot>;
  onSnapshot: (cb: (snapshot: PomodoroSnapshot) => void) => () => void;
  control: (action: string) => Promise<PomodoroSnapshot>;
  hide: () => void;
}

declare global {
  interface Window {
    timer: TimerApi;
  }
}
