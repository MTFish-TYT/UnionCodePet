// Map the live session list → a single global phase → the pet animation row.
//
// Aggregation picks the highest-priority phase across ALL CLI sessions (so the
// one pet reflects "what's happening anywhere"). 'done' only wins briefly after
// a task completes, then falls back to idle so the pet doesn't cheer forever.
import type { PetState } from './animation-rows';

export type GlobalPhase = 'idle' | 'working' | 'waiting' | 'done' | 'error';

interface SessionLike {
  phase: string;
  updatedAt: number;
}

// Priority order (first match wins). 'done' is special-cased by recency below.
const PHASE_PRIORITY: GlobalPhase[] = ['waiting', 'error', 'working'];

/** How long a 'done' phase keeps the pet cheering before reverting to idle. */
const DONE_CHEER_MS = 4000;

/**
 * Aggregate sessions into one global phase.
 * @param now epoch ms (injected for testability)
 */
export function aggregatePhase(sessions: SessionLike[], now = Date.now()): GlobalPhase {
  if (sessions.length === 0) return 'idle';

  // Highest-priority active phase (waiting > error > working).
  for (const target of PHASE_PRIORITY) {
    if (sessions.some((s) => s.phase === target)) return target;
  }

  // 'done' only counts if recent (within the cheer window).
  const hasRecentDone = sessions.some(
    (s) => s.phase === 'done' && now - s.updatedAt < DONE_CHEER_MS,
  );
  if (hasRecentDone) return 'done';

  return 'idle';
}

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
