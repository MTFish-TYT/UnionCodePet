/**
 * Sound engine.
 *
 * Node has no built-in audio, so on Windows we shell out to PowerShell's
 * System.Media.SoundPlayer (the same API the user's existing play-sound.ps1
 * uses). It blocks until playback finishes, so we run it detached (no await) to
 * avoid stalling the event loop.
 *
 * The sound path comes from the central SOUND_MAP; this module only plays what
 * it's told. Non-Windows platforms log instead (placeholder for future Electron
 * Web Audio path).
 */
import { spawn } from 'node:child_process';
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
    if (!existsSync(path)) {
      this.log(`[sound] missing file for ${key}: ${path}`);
      return false;
    }
    this.playWav(path);
    return true;
  }

  /** Fire-and-forget wav playback via PowerShell SoundPlayer. */
  private playWav(path: string): void {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
        // -LiteralPath keeps Chinese characters in paths intact.
        `(New-Object System.Media.SoundPlayer -LiteralPath '${path.replace(/'/g, "''")}').PlaySync()`],
      { windowsHide: true, detached: true, stdio: 'ignore' },
    );
    child.on('error', (e) => this.log(`[sound] spawn failed: ${e.message}`));
    child.unref();
  }
}
