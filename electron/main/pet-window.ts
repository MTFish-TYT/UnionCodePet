/**
 * Pet window — a transparent, always-on-top, frameless overlay showing the
 * animated desktop pet. Created by main; receives session updates from the
 * same ingest pipeline that feeds the config window.
 *
 * Window traits:
 *  - transparent + frameless + always-on-top → classic desktop pet look
 *  - draggable via CSS -webkit-app-region on the canvas
 *  - right-click context menu (toggle click-through / hide / config / quit)
 *  - click-through toggleable (default OFF so it's draggable)
 */
import { BrowserWindow, Menu, shell, app, screen } from 'electron';
import { join, dirname } from 'node:path';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let petWindow: BrowserWindow | null = null;
let clickThrough = false;

interface PetInfo {
  /** Base64 data URL of the spritesheet — renderer can't use file:// (CSP). */
  spritesheetDataUrl: string;
  displayName: string;
}

/** Find the first pet under <projectRoot>/pets/ and return its info. */
export function loadActivePet(projectRoot: string): PetInfo | null {
  const petsDir = join(projectRoot, 'pets');
  if (!existsSync(petsDir)) return null;
  for (const name of readdirSync(petsDir, { withFileTypes: true })) {
    if (!name.isDirectory()) continue;
    const petJsonPath = join(petsDir, name.name, 'pet.json');
    if (!existsSync(petJsonPath)) continue;
    try {
      const meta = JSON.parse(readFileSync(petJsonPath, 'utf-8'));
      const spritesheetPath = join(petsDir, name.name, meta.spritesheetPath ?? 'spritesheet.webp');
      if (existsSync(spritesheetPath)) {
        // Read as base64 data URL — the renderer's strict CSP blocks file://,
        // and a data URL needs no protocol registration.
        const buf = readFileSync(spritesheetPath);
        const ext = spritesheetPath.toLowerCase().endsWith('.png') ? 'png' : 'webp';
        const spritesheetDataUrl = `data:image/${ext};base64,${buf.toString('base64')}`;
        return { spritesheetDataUrl, displayName: meta.displayName ?? name.name };
      }
    } catch {
      // skip malformed pet
    }
  }
  return null;
}

/** Create the pet window and send it the active pet info on load. */
export function createPetWindow(projectRoot: string): void {
  // Place the pet at the bottom-right of the primary screen's work area, with a
  // small margin so it sits just inside the visible desktop (not under the
  // taskbar). Fixed position makes it easy to find on each launch.
  const workArea = screen.getPrimaryDisplay().workArea;
  const margin = 24;
  const petX = workArea.x + workArea.width - 192 - margin;
  const petY = workArea.y + workArea.height - 208 - margin;

  petWindow = new BrowserWindow({
    width: 192,
    height: 208,
    x: petX,
    y: petY,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, '../preload/pet-preload.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Right-click context menu.
  petWindow.webContents.on('context-menu', () => {
    const menu = Menu.buildFromTemplate([
      { label: clickThrough ? '取消点击穿透' : '点击穿透（鼠标可穿过桌宠）', click: toggleClickThrough },
      { label: '隐藏桌宠', click: () => petWindow?.hide() },
      { type: 'separator' },
      { label: '打开配置', click: () => petWindow?.webContents.send('pet:open-config') },
      { type: 'separator' },
      { label: '退出', click: () => app.quit() },
    ]);
    menu.popup();
  });

  // IPC from the pet renderer (menu-triggered actions).
  petWindow.webContents.ipc.on('pet:toggle-clickthrough', toggleClickThrough);
  petWindow.webContents.ipc.on('pet:hide', () => petWindow?.hide());
  petWindow.webContents.ipc.on('pet:open-config', () => showConfigWindow());
  petWindow.webContents.ipc.on('pet:quit', () => app.quit());

  // Load the pet renderer. On load, tell it which spritesheet to draw.
  petWindow.webContents.on('did-finish-load', () => {
    const pet = loadActivePet(projectRoot);
    if (pet) petWindow?.webContents.send('pet:ready', pet);
  });

  // Dev: same dev server as the config window, just a different HTML page.
  // Prod: the built pet.html next to the main index.html.
  if (process.env['ELECTRON_RENDERER_URL']) {
    void petWindow.loadURL(process.env['ELECTRON_RENDERER_URL'] + '/pet.html');
  } else {
    void petWindow.loadFile(join(__dirname, '../renderer/pet.html'));
  }
}

/** Push the current session list to the pet window (drives its animation). */
export function broadcastSessionsToPet(sessions: unknown[]): void {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send('sessions:update', sessions);
  }
}

function toggleClickThrough(): void {
  clickThrough = !clickThrough;
  petWindow?.setIgnoreMouseEvents(clickThrough, { forward: true });
}

/** Show/focus the config window (the main 900×640 window). */
function showConfigWindow(): void {
  const wins = BrowserWindow.getAllWindows().filter((w) => w !== petWindow);
  if (wins.length > 0) {
    wins[0].show();
    wins[0].focus();
  } else {
    void shell.openExternal('about:blank'); // fallback — shouldn't happen
  }
}
