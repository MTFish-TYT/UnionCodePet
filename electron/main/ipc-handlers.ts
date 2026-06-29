/**
 * IPC handlers — the bridge between the renderer (config UI) and the main process.
 *
 * Channels:
 *  - config:get / config:save / config:reset  → read/write external JSON
 *  - sound:preview                              → play a wav once (test button)
 *  - sound:browse                               → file picker for wav/mp3
 *
 * `sessions:update` (main → renderer) is sent directly from index.ts via
 * webContents.send, not handled here.
 */
import { ipcMain, dialog, BrowserWindow } from 'electron';
import {
  loadConfig,
  saveConfig,
  resetConfig,
  type RuntimeConfig,
} from '../../src/config.js';
import { SoundEngine } from '../../src/sound-engine.js';

// A throwaway sound engine just for preview (no log needed).
const previewSound = new SoundEngine();

export function registerIpc(onConfigSaved?: (cfg: RuntimeConfig) => void): void {
  // ---- config ----
  ipcMain.handle('config:get', () => {
    // Return the current in-memory config (re-reads file so it's fresh).
    return loadConfig();
  });

  ipcMain.handle('config:save', (_e, cfg: RuntimeConfig) => {
    saveConfig(cfg);
    const fresh = loadConfig();
    // Notify (e.g. so the pet window can hot-swap when activePet changed).
    onConfigSaved?.(fresh);
    return fresh;
  });

  ipcMain.handle('config:reset', () => {
    return resetConfig();
  });

  // ---- sound ----
  ipcMain.handle('sound:preview', (_e, path: string) => {
    if (!path) return false;
    // Build a synthetic event so SoundEngine.playFor maps the key correctly.
    // Preview bypasses the sound-map: just play the given file directly.
    return previewSound.playFile(path);
  });

  ipcMain.handle('sound:browse', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const opts: Electron.OpenDialogSyncOptions = {
      title: '选择提示音文件',
      properties: ['openFile'],
      filters: [
        { name: '音频文件', extensions: ['wav', 'mp3', 'm4a', 'aiff'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    };
    const result = win
      ? dialog.showOpenDialogSync(win, opts)
      : dialog.showOpenDialogSync(opts);
    return result && result.length > 0 ? result[0] : null;
  });
}
