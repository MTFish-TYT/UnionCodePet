/**
 * PomodoroEngine host — the Electron-side wrapper around the pure state machine.
 *
 * Owns:
 *  - one {@link PomodoroEngine} instance
 *  - a 500ms `setInterval` tick that drives the clock
 *  - the side effects when a phase ends: play the configured sound + tell the
 *    pet window to react (cheer / wave)
 *  - broadcasting snapshots to the timer window + config window
 *
 * Lives in the main process so timing continues even when the config window is
 * closed (only the tray + pet + timer windows keep the app alive).
 */
import { POMODORO, getConfigPath, loadConfig } from '../../src/config.js';
import { PomodoroEngine, type PomodoroSnapshot, type PomodoroPhase } from '../../src/pomodoro.js';
import { SoundEngine } from '../../src/sound-engine.js';

/** What the pet should do when a pomodoro phase ends. */
export type PetReaction = 'cheer' | 'wave' | 'none';

export interface PomodoroHost {
  /** The underlying engine (for direct control). */
  engine: PomodoroEngine;
  /** Start the 500ms tick loop. */
  startTicking(): void;
  /** Stop the tick loop (call on app quit). */
  stopTicking(): void;
  /** Push the current snapshot to all listeners immediately. */
  broadcast(): void;
  /** Subscribe to snapshot updates (timer window + config window). */
  onSnapshot(cb: (s: PomodoroSnapshot) => void): () => void;
  /** Subscribe to phase-end pet reactions. */
  onPetReaction(cb: (reaction: PetReaction, phase: PomodoroPhase) => void): () => void;
  /** Apply a preset by id (re-reads config, resets the engine). */
  applyPresetById(id: string): boolean;
}

const TICK_MS = 500;

export function createPomodoroHost(): PomodoroHost {
  // Resolve the active preset from the external config.
  const cfg = loadConfig();
  const preset =
    cfg.pomodoro.presets.find((p) => p.id === cfg.pomodoro.activePresetId) ??
    cfg.pomodoro.presets[0];
  const engine = new PomodoroEngine(preset);

  const sound = new SoundEngine((m) => console.log(`[pomodoro] ${m}`));
  const snapshotCbs = new Set<(s: PomodoroSnapshot) => void>();
  const reactionCbs = new Set<(r: PetReaction, p: PomodoroPhase) => void>();
  let tickHandle: ReturnType<typeof setInterval> | null = null;

  function broadcast(): void {
    const snap = engine.snapshot(Date.now());
    for (const cb of snapshotCbs) cb(snap);
  }

  function handlePhaseEnd(endedPhase: PomodoroPhase): void {
    // 1. Sound: focus-end sound when a focus phase ended, break-end otherwise.
    const focusEnded = endedPhase === 'focusing';
    const soundPath = focusEnded ? POMODORO.soundOnFocusEnd : POMODORO.soundOnBreakEnd;
    if (typeof soundPath === 'string' && soundPath.length > 0) {
      sound.playFile(soundPath);
    }
    // 2. Pet reaction: cheer when focus completes, wave when a break ends.
    const reaction: PetReaction = focusEnded ? 'cheer' : 'wave';
    for (const cb of reactionCbs) cb(reaction, endedPhase);
    // Count completed focus rounds for the snapshot's lifetime counter.
    if (focusEnded) engine.notifyFocusEnded();
  }

  function startTicking(): void {
    if (tickHandle) return;
    tickHandle = setInterval(() => {
      const before = engine.snapshot(Date.now());
      const res = engine.tick(Date.now());
      if (res.phaseChanged && res.endedPhase) {
        handlePhaseEnd(res.endedPhase);
      }
      // Only broadcast when something visible changed (remainingMs always moves
      // while running, so we broadcast every tick while active; skip when idle
      // to avoid spamming a static snapshot).
      const after = engine.snapshot(Date.now());
      if (before.running || after.running || res.phaseChanged) broadcast();
    }, TICK_MS);
  }

  function stopTicking(): void {
    if (tickHandle) {
      clearInterval(tickHandle);
      tickHandle = null;
    }
  }

  function applyPresetById(id: string): boolean {
    // Re-read config so freshly-saved presets are visible.
    const fresh = loadConfig();
    const found = fresh.pomodoro.presets.find((p) => p.id === id);
    if (!found) return false;
    engine.setPreset(found);
    broadcast();
    return true;
  }

  return {
    engine,
    startTicking,
    stopTicking,
    broadcast,
    onSnapshot: (cb) => {
      snapshotCbs.add(cb);
      return () => snapshotCbs.delete(cb);
    },
    onPetReaction: (cb) => {
      reactionCbs.add(cb);
      return () => reactionCbs.delete(cb);
    },
    applyPresetById,
  };
}

/** Re-export so callers don't need to know the config path helper. */
export { getConfigPath };
