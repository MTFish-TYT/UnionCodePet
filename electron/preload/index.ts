// Preload bridge. Runs in a sandboxed context with access to a subset of Node,
// exposes a safe IPC API to the renderer via contextBridge.
//
// electron-vite compiles this to CommonJS regardless of the root "type":"module",
// so we must use `require` (not import) for electron here.
const { contextBridge, ipcRenderer } = require('electron');

// M1: minimal bridge. Channels get fleshed out in M3 (config/sound/sessions).
const api = {
  // config (M3)
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (cfg: unknown) => ipcRenderer.invoke('config:save', cfg),
  resetConfig: () => ipcRenderer.invoke('config:reset'),

  // sound (M3)
  previewSound: (path: string) => ipcRenderer.invoke('sound:preview', path),
  browseSoundFile: () => ipcRenderer.invoke('sound:browse'),
  validateSounds: () => ipcRenderer.invoke('sounds:validate'),

  // sessions (M3) — main pushes updates; renderer subscribes.
  onSessionsUpdate: (cb: (sessions: unknown[]) => void) => {
    const handler = (_e: unknown, sessions: unknown[]) => cb(sessions);
    ipcRenderer.on('sessions:update', handler);
    return () => ipcRenderer.removeListener('sessions:update', handler);
  },

  // pets — enumerate available pets for the selection dropdown.
  listPets: () => ipcRenderer.invoke('pets:list'),

  // pomodoro — live snapshot stream + control actions.
  getPomodoroSnapshot: () => ipcRenderer.invoke('pomodoro:get-snapshot'),
  onPomodoroSnapshot: (cb: (snapshot: unknown) => void) => {
    const handler = (_e: unknown, snapshot: unknown) => cb(snapshot);
    ipcRenderer.on('pomodoro:snapshot', handler);
    return () => ipcRenderer.removeListener('pomodoro:snapshot', handler);
  },
  pomodoroControl: (action: string) => ipcRenderer.invoke('pomodoro:control', action),
  applyPomodoroPreset: (id: string) => ipcRenderer.invoke('pomodoro:apply-preset', id),
};

export type UcpApi = typeof api;

contextBridge.exposeInMainWorld('ucp', api);
