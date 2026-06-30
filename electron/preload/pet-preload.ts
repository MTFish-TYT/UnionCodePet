// Preload for the pet window. Exposes a tiny IPC bridge: the main process
// pushes session updates + the active pet's spritesheet path; the renderer
// subscribes and drives the animation.
//
// electron-vite compiles this to CJS; use require for electron.
const { contextBridge, ipcRenderer } = require('electron');

const api = {
  // Receive the active pet's spritesheet (as a base64 data URL) on boot.
  onPetReady: (cb: (info: { spritesheetDataUrl: string; displayName: string }) => void) => {
    const handler = (_e: unknown, info: { spritesheetDataUrl: string; displayName: string }) => cb(info);
    ipcRenderer.on('pet:ready', handler);
    return () => ipcRenderer.removeListener('pet:ready', handler);
  },
  // Pull the current sessions on demand. More reliable than relying solely on
  // the push subscription (which can drop if the preload listener misses the
  // window). The pet polls this every 500ms as a backstop.
  getSessions: () => ipcRenderer.invoke('pet:get-sessions'),
  // Recent event history for the history panel (newest first).
  getHistory: () => ipcRenderer.invoke('pet:get-history'),
  // Live session list (same shape as the config window gets).
  onSessionsUpdate: (cb: (sessions: unknown[]) => void) => {
    const handler = (_e: unknown, sessions: unknown[]) => cb(sessions);
    ipcRenderer.on('sessions:update', handler);
    return () => ipcRenderer.removeListener('sessions:update', handler);
  },
  // Live pomodoro phase (focusing / short-break / long-break / idle) so the pet
  // animation can reflect the timer even when no CLI session is active.
  onPomodoroPhase: (cb: (phase: string) => void) => {
    const handler = (_e: unknown, phase: string) => cb(phase);
    ipcRenderer.on('pomodoro:phase', handler);
    return () => ipcRenderer.removeListener('pomodoro:phase', handler);
  },
  // One-shot reaction when a pomodoro phase ends: 'cheer' (focus done) | 'wave'.
  onPetReaction: (cb: (reaction: string) => void) => {
    const handler = (_e: unknown, reaction: string) => cb(reaction);
    ipcRenderer.on('pet:reaction', handler);
    return () => ipcRenderer.removeListener('pet:reaction', handler);
  },
  // Context-menu actions the renderer can request back to main.
  toggleClickThrough: () => ipcRenderer.send('pet:toggle-clickthrough'),
  hidePet: () => ipcRenderer.send('pet:hide'),
  openConfig: () => ipcRenderer.send('pet:open-config'),
  quitApp: () => ipcRenderer.send('pet:quit'),
  // Double-click on the pet shows the menu (right-click is swallowed by the
  // drag region on Windows, so we use double-click instead).
  showMenu: () => ipcRenderer.send('pet:show-menu'),
};

export type PetApi = typeof api;

contextBridge.exposeInMainWorld('pet', api);
