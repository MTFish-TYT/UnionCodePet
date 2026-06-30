/**
 * Pomodoro timer window — a transparent, always-on-top, frameless overlay
 * showing the countdown (Catime-style). Created by main; receives snapshot
 * updates from the pomodoro engine host.
 *
 * Window traits (mirrors pet-window.ts):
 *  - transparent + frameless + always-on-top
 *  - draggable via CSS -webkit-app-region on the card
 *  - skipTaskbar so it doesn't clutter the taskbar
 *  - placed beside the pet window (to its left) on creation
 */
import { BrowserWindow, ipcMain, screen } from 'electron';
import { join } from 'node:path';
import type { PomodoroSnapshot } from '../../src/pomodoro.js';

let timerWindow: BrowserWindow | null = null;

/** Create the timer window. Call once on app ready. */
export function createTimerWindow(): void {
  if (timerWindow && !timerWindow.isDestroyed()) return;

  const winW = 200;
  const winH = 150;
  const { workArea } = screen.getPrimaryDisplay();
  // Default position: just left of where the pet window sits (bottom-right).
  // Matches pet-window's margin (24) + pet width (340) so they don't overlap.
  const margin = 24;
  const petW = 340;
  const x = workArea.x + workArea.width - petW - winW - margin;
  const y = workArea.y + workArea.height - winH - margin;

  timerWindow = new BrowserWindow({
    width: winW,
    height: winH,
    x,
    y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    show: false, // shown on first ready-to-show; can be toggled from tray.
    webPreferences: {
      preload: join(__dirname, '../preload/timer-preload.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  timerWindow.on('ready-to-show', () => timerWindow?.show());

  // The window's close button only hides it (keep the engine + window alive).
  timerWindow.on('close', (e) => {
    e.preventDefault();
    timerWindow?.hide();
  });

  // IPC from the timer renderer.
  ipcMain.on('timer:hide', () => timerWindow?.hide());

  if (process.env['ELECTRON_RENDERER_URL']) {
    void timerWindow.loadURL(process.env['ELECTRON_RENDERER_URL'] + '/timer.html');
  } else {
    void timerWindow.loadFile(join(__dirname, '../renderer/timer.html'));
  }
}

/** Push a snapshot to the timer window (drives its countdown display). */
export function broadcastSnapshotToTimer(snap: PomodoroSnapshot): void {
  if (timerWindow && !timerWindow.isDestroyed()) {
    timerWindow.webContents.send('pomodoro:snapshot', snap);
  }
}

/** Show/focus the timer window (called from the tray menu). */
export function showTimerWindow(): void {
  if (timerWindow && !timerWindow.isDestroyed()) {
    timerWindow.show();
    timerWindow.focus();
  }
}

/** Toggle the timer window visibility (tray menu). */
export function toggleTimerWindow(): void {
  if (!timerWindow || timerWindow.isDestroyed()) return;
  if (timerWindow.isVisible()) timerWindow.hide();
  else timerWindow.show();
}
