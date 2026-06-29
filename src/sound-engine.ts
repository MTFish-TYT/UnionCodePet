/**
 * Sound engine.
 *
 * Node has no built-in audio, so on Windows we shell out to PowerShell's
 * System.Media.SoundPlayer (the same API the user's existing play-sound.ps1
 * uses). The sound path comes from the central SOUND_MAP; this module only
 * plays what it's told. Non-Windows platforms log instead.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { UnifiedEvent } from './protocol.js';
import { SOUND_MAP } from './config.js';

export interface SoundLogger {
  (msg: string): void;
}

export class SoundEngine {
  constructor(private log: SoundLogger = () => {}) {}

  /** Play the sound mapped to this event, if any. Returns true if it fired. */
  playFor(ev: UnifiedEvent): boolean {
    const key = `${ev.source}:${ev.event}` as const;
    const path = SOUND_MAP[key];
    if (path === null) return false; // explicitly silent
    if (!path) return false; // unmapped → silent
    return this.playFile(path, key);
  }

  /**
   * Play a specific file directly (used by the config UI's preview button).
   * Bypasses the sound map. Returns true if it actually played.
   */
  playFile(path: string, key?: string): boolean {
    if (!existsSync(path)) {
      this.log(`[sound] missing file${key ? ` for ${key}` : ''}: ${path}`);
      return false;
    }
    if (key) this.log(`[sound] ▶ playing ${key} -> ${path}`);
    this.playWav(path);
    return true;
  }

  /**
   * Blocking wav playback via PowerShell SoundPlayer.
   *
   * Uses execFileSync (blocking) rather than spawn(detached) — the detached
   * variant gets reaped before PlaySync finishes on Windows, leaving no audio.
   * Blocking for ~1s is acceptable since sound only fires on state changes
   * (task complete / permission), not on every event.
   */
  private playWav(path: string): void {
    const safe = path.replace(/'/g, "''");
    const psScript = `$p=New-Object System.Media.SoundPlayer; $p.SoundLocation='${safe}'; $p.PlaySync()`;
    try {
      execFileSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psScript],
        { windowsHide: true, stdio: 'ignore', timeout: 5000 },
      );
    } catch (e) {
      this.log(`[sound] playback failed: ${(e as Error).message}`);
    }
  }
}
