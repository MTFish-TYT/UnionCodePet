// Preload for the pomodoro timer window. Exposes a tiny IPC bridge: main
// pushes snapshot updates; the window can control the engine + hide itself.
//
// electron-vite compiles this to CJS; use require for electron.
const { contextBridge, ipcRenderer } = require('electron');

const api = {
  // Pull the current snapshot on demand (seed + 500ms poll backstop).
  getSnapshot: () => ipcRenderer.invoke('pomodoro:get-snapshot'),
  // Live snapshot stream (pushed every tick while running + on state change).
  onSnapshot: (cb: (snapshot: unknown) => void) => {
    const handler = (_e: unknown, snapshot: unknown) => cb(snapshot);
    ipcRenderer.on('pomodoro:snapshot', handler);
    return () => ipcRenderer.removeListener('pomodoro:snapshot', handler);
  },
  // Control actions: 'start' | 'pause' | 'resume' | 'reset' | 'skip'.
  control: (action: string) => ipcRenderer.invoke('pomodoro:control', action),
  // Hide the timer window (only the close button; tray reopens it).
  hide: () => ipcRenderer.send('timer:hide'),
};

export type TimerApi = typeof api;

contextBridge.exposeInMainWorld('timer', api);
