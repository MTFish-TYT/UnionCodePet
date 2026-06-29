/**
 * Electron main process entry point.
 *
 * Wires together: external config load → HTTP server → Codex poller → window.
 * All CLI events converge on the ingester (see ingest.ts); session changes are
 * pushed to the renderer via IPC `sessions:update`.
 */
import { app, BrowserWindow, shell, ipcMain, Tray, Menu, nativeImage } from 'electron';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { loadConfig } from '../../src/config.js';
import { CodexPoller } from '../../src/codex-poller.js';
import { startHttpServer } from './http-server.js';
import { registerIpc } from './ipc-handlers.js';
import { createPetWindow, broadcastSessionsToPet, registerPetIpc, reloadPet, listPets } from './pet-window.js';

// Project root (where pets/ and build/ live).
// Dev: out/main → two levels up is the project root.
// Packaged: extraResources copies pets/ and build/ into process.resourcesPath.
const PROJECT_ROOT = app.isPackaged
  ? process.resourcesPath
  : join(__dirname, '..', '..');

let mainWindow: BrowserWindow | null = null;
let poller: CodexPoller | null = null;
// True only when the user explicitly quits (via tray menu). The main window's
// close button hides instead of closing unless this is set.
let isQuitting = false;
let tray: Tray | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 640,
    minWidth: 720,
    minHeight: 520,
    show: false,
    autoHideMenuBar: true,
    title: 'UnionCodePet',
    icon: join(PROJECT_ROOT, 'build', 'UnionCodePet.ico'),
    webPreferences: {
      // electron-vite emits preload as .mjs (root is "type":"module").
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.on('ready-to-show', () => mainWindow?.show());

  // Hide instead of close so the app stays resident (pet + daemon keep running).
  // Actual quit only happens via the tray menu, which sets isQuitting.
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });

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

/**
 * System tray icon. Keeps the app alive after the config window closes. The
 * tray menu offers show-config / show-pet / quit; double-click reopens config.
 * Icon: tries the active pet's spritesheet (resized), falls back to a generated
 * purple dot so it works even with no pet assets.
 */
function createTray(): void {
  // Use the bundled tray icon (a clear 32x32 png). We don't use the pet's
  // spritesheet because it's a large grid that becomes an unreadable blob when
  // shrunk to tray size.
  let icon: Electron.NativeImage = makeDotIcon();
  const iconPath = join(PROJECT_ROOT, 'build', 'UnionCodePet-32x32.png');
  if (existsSync(iconPath)) {
    const img = nativeImage.createFromPath(iconPath);
    if (!img.isEmpty()) {
      icon = img;
    }
  }

  tray = new Tray(icon);
  tray.setToolTip('UnionCodePet');

  const menu = Menu.buildFromTemplate([
    { label: '显示配置', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { label: '显示桌宠', click: () => showPetWindow() },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
  tray.on('double-click', () => { mainWindow?.show(); mainWindow?.focus(); });
}

/** Show/focus the pet window (called from the tray menu). */
function showPetWindow(): void {
  const wins = BrowserWindow.getAllWindows();
  for (const w of wins) {
    if (w.title === 'UnionCodePet Pet' || !w.title) {
      w.show();
      return;
    }
  }
}

/** Generate a 16x16 solid-color PNG as a fallback tray icon. */
function makeDotIcon(): Electron.NativeImage {
  // Minimal 1x1 purple pixel PNG, resized by Electron to 16x16.
  const b64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  return nativeImage.createFromBuffer(Buffer.from(b64, 'base64')).resize({ width: 16, height: 16 });
}

app.whenReady().then(() => {
  // 1. Load (or create) external config → mutates the runtime CONFIG/SOUND_MAP.
  loadConfig();

  // 2. HTTP server + ingester. onSessionsChange broadcasts to BOTH the config
  // window and the pet window (both drive off the same session list).
  const { server, ingester } = startHttpServer(() => {
    const sessions = ingester.allSessions();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('sessions:update', sessions);
    }
    broadcastSessionsToPet(sessions);
  });
  // Pet renderer can also PULL sessions on demand (backstop for the push).
  registerPetIpc(ingester.allSessions);

  // 3. Codex sessions poller feeds the same ingester.
  poller = new CodexPoller(ingester.ingest, (m) => console.log(`[codex-poller] ${m}`));
  poller.start();

  // 4. IPC handlers. On config save, hot-swap the pet if activePet changed.
  // pets:list lets the config UI enumerate available pets.
  registerIpc((cfg) => reloadPet(PROJECT_ROOT, cfg.activePet || undefined));
  ipcMain.handle('pets:list', () => listPets(PROJECT_ROOT));

  // 5. Config window + pet window (with the configured active pet).
  createWindow();
  createPetWindow(PROJECT_ROOT, loadConfig().activePet || undefined);

  // 6. System tray — keeps the app resident after the config window is closed.
  //    Double-click the tray icon to reopen config; right-click for the menu.
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // Clean shutdown. isQuitting lets the main window's close handler allow the
  // real close instead of hiding.
  app.on('before-quit', () => {
    isQuitting = true;
    poller?.stop();
    server.close();
  });
});

// Keep running with no windows (the pet window + tray keep the app alive).
// Only macOS conventionally stays active; here we stay on all platforms.
app.on('window-all-closed', () => {
  // Do nothing — don't quit. The tray menu's "退出" is the only exit.
});
