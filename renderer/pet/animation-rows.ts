// hatch-pet sprite-sheet animation contract.
//
// This is the SINGLE SOURCE OF TRUTH for how the 1536×1872 sprite atlas is
// sliced and played. Per the Codex pet contract, this data is NOT in pet.json —
// it's hardcoded in the renderer. Copied verbatim from the hatch-pet
// animation-rows.md spec so any hatch-pet-generated pet renders correctly.
//
// Atlas geometry: 8 columns × 9 rows, each cell 192×208.
// Row = animation state, column = frame index within that state.

export interface AnimationRow {
  /** Row index in the atlas (0-8). */
  row: number;
  /** Logical name, used by state-map to pick a row. */
  state: PetState;
  /** Column indices this animation uses (length = frame count). */
  frames: number[];
  /** Duration of each frame in ms, aligned with `frames` by index. */
  durations: number[];
}

export type PetState =
  | 'idle'
  | 'running-right'
  | 'running-left'
  | 'waving'
  | 'jumping'
  | 'failed'
  | 'waiting'
  | 'running'
  | 'review';

/** Atlas cell size in pixels. */
export const CELL_W = 192;
export const CELL_H = 208;
/** Atlas grid: 8 columns × 9 rows. */
export const COLS = 8;
export const ROWS = 9;

// Helper: N frames, same duration, last frame different.
const uniform = (n: number, ms: number, lastMs: number): number[] => {
  const d = new Array(n).fill(ms);
  d[d.length - 1] = lastMs;
  return d;
};

export const ANIMATION_ROWS: Record<PetState, AnimationRow> = {
  idle:           { row: 0, state: 'idle',           frames: [0, 1, 2, 3, 4, 5], durations: [280, 110, 110, 140, 140, 320] },
  'running-right':{ row: 1, state: 'running-right',  frames: [0, 1, 2, 3, 4, 5, 6, 7], durations: uniform(8, 120, 220) },
  'running-left': { row: 2, state: 'running-left',   frames: [0, 1, 2, 3, 4, 5, 6, 7], durations: uniform(8, 120, 220) },
  waving:         { row: 3, state: 'waving',         frames: [0, 1, 2, 3],           durations: uniform(4, 140, 280) },
  jumping:        { row: 4, state: 'jumping',        frames: [0, 1, 2, 3, 4],        durations: uniform(5, 140, 280) },
  failed:         { row: 5, state: 'failed',         frames: [0, 1, 2, 3, 4, 5, 6, 7], durations: uniform(8, 140, 240) },
  waiting:        { row: 6, state: 'waiting',        frames: [0, 1, 2, 3, 4, 5],     durations: uniform(6, 150, 260) },
  running:        { row: 7, state: 'running',        frames: [0, 1, 2, 3, 4, 5],     durations: uniform(6, 120, 220) },
  review:         { row: 8, state: 'review',         frames: [0, 1, 2, 3, 4, 5],     durations: uniform(6, 150, 280) },
};
