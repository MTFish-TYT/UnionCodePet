/**
 * Electron main process entry point.
 *
 * Wires together: external config load → HTTP server → Codex poller → window.
 * All CLI events converge on the ingester (see ingest.ts); session changes are
 * pushed to the renderer via IPC `sessions:update`.
 */
import { app, BrowserWindow, shell } from 'electron';
import { join } from 'node:path';
import { loadConfig } from '../../src/config.js';
import { CodexPoller } from '../../src/codex-poller.js';
import { startHttpServer } from './http-server.js';
import { registerIpc } from './ipc-handlers.js';

let mainWindow: BrowserWindow | null = null;
let poller: CodexPoller | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 640,
    minWidth: 720,
    minHeight: 520,
    show: false,
    autoHideMenuBar: true,
    title: 'UnionCodePet',
    webPreferences: {
      // electron-vite emits preload as .mjs (root is "type":"module").
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.on('ready-to-show', () => mainWindow?.show());

  mainWindow.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url);
    return { action: 'deny' };
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  // 1. Load (or create) external config → mutates the runtime CONFIG/SOUND_MAP.
  loadConfig();

  // 2. HTTP server + ingester. onSessionsChange broadcasts to the renderer.
  const { server, ingester } = startHttpServer(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('sessions:update', ingester.allSessions());
    }
  });

  // 3. Codex sessions poller feeds the same ingester.
  poller = new CodexPoller(ingester.ingest, (m) => console.log(`[codex-poller] ${m}`));
  poller.start();

  // 4. IPC handlers (config read/save/preview — wired in M3).
  registerIpc();

  // 5. Window.
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // Clean shutdown.
  const shutdown = (): void => {
    poller?.stop();
    server.close();
  };
  app.on('before-quit', shutdown);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
