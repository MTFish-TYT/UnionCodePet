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
import { BrowserWindow, Menu, shell, app, screen, ipcMain } from 'electron';
import { join, dirname } from 'node:path';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { PomodoroPhase } from '../../src/pomodoro.js';

let petWindow: BrowserWindow | null = null;
let clickThrough = false;
// Latest session list, updated by broadcastSessionsToPet; read when the menu
// pops so it shows which CLIs are active and their current state.
let latestSessions: Array<{ source: string; sessionId: string; phase: string; lastSummary?: string; lastToolName?: string }> = [];
// Latest pomodoro phase, pushed to the pet so its animation/bubble can reflect
// the timer even when no CLI is active.
let latestPomodoroPhase: PomodoroPhase = 'idle';

interface PetInfo {
  id: string;
  /** Base64 data URL of the spritesheet — renderer can't use file:// (CSP). */
  spritesheetDataUrl: string;
  displayName: string;
}

/** A pet's metadata for the selection UI (no spritesheet bytes). */
export interface PetMeta {
  id: string;
  displayName: string;
}

/** Enumerate all pets under <projectRoot>/pets/ for the selection dropdown. */
export function listPets(projectRoot: string): PetMeta[] {
  const petsDir = join(projectRoot, 'pets');
  if (!existsSync(petsDir)) return [];
  const out: PetMeta[] = [];
  for (const name of readdirSync(petsDir, { withFileTypes: true })) {
    if (!name.isDirectory()) continue;
    const petJsonPath = join(petsDir, name.name, 'pet.json');
    if (!existsSync(petJsonPath)) continue;
    try {
      const meta = JSON.parse(readFileSync(petJsonPath, 'utf-8'));
      out.push({ id: meta.id ?? name.name, displayName: meta.displayName ?? name.name });
    } catch {
      // skip malformed pet
    }
  }
  return out;
}

/**
 * Load a pet's info (spritesheet as a base64 data URL).
 * @param petId if provided and matches a pet's id, use it; otherwise the first found.
 */
export function loadActivePet(projectRoot: string, petId?: string): PetInfo | null {
  const petsDir = join(projectRoot, 'pets');
  if (!existsSync(petsDir)) return null;
  let fallback: PetInfo | null = null;
  for (const name of readdirSync(petsDir, { withFileTypes: true })) {
    if (!name.isDirectory()) continue;
    const petJsonPath = join(petsDir, name.name, 'pet.json');
    if (!existsSync(petJsonPath)) continue;
    try {
      const meta = JSON.parse(readFileSync(petJsonPath, 'utf-8'));
      const id = meta.id ?? name.name;
      const spritesheetPath = join(petsDir, name.name, meta.spritesheetPath ?? 'spritesheet.webp');
      if (!existsSync(spritesheetPath)) continue;
      const buf = readFileSync(spritesheetPath);
      const ext = spritesheetPath.toLowerCase().endsWith('.png') ? 'png' : 'webp';
      const info: PetInfo = {
        id,
        spritesheetDataUrl: `data:image/${ext};base64,${buf.toString('base64')}`,
        displayName: meta.displayName ?? name.name,
      };
      if (petId && id === petId) return info; // exact match wins
      if (!fallback) fallback = info; // remember first as fallback
    } catch {
      // skip malformed pet
    }
  }
  return fallback;
}

/** Create the pet window and send it the active pet info on load. */
export function createPetWindow(projectRoot: string, petId?: string): void {
  // Place the pet at the bottom-right of the primary screen's work area, with a
  // Place the pet at the bottom-right of the primary screen's work area. The
  // window is taller than the sprite (300 vs 208) to leave room for the status
  // bubble above the pet; the extra area is transparent.
  const workArea = screen.getPrimaryDisplay().workArea;
  const winW = 340;
  const winH = 320;
  const margin = 24;
  const petX = workArea.x + workArea.width - winW - margin;
  const petY = workArea.y + workArea.height - winH - margin;

  petWindow = new BrowserWindow({
    width: winW,
    height: winH,
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

  // IPC from the pet renderer (menu-triggered actions).
  petWindow.webContents.ipc.on('pet:toggle-clickthrough', toggleClickThrough);
  petWindow.webContents.ipc.on('pet:hide', () => petWindow?.hide());
  petWindow.webContents.ipc.on('pet:open-config', () => showConfigWindow());
  petWindow.webContents.ipc.on('pet:quit', () => app.quit());
  // Double-click opens a dynamic menu (right-click is swallowed by the drag
  // region on Windows, so double-click is the trigger instead).
  petWindow.webContents.ipc.on('pet:show-menu', () => showPetMenu());

  // Load the pet renderer. On load, tell it which spritesheet to draw.
  petWindow.webContents.on('did-finish-load', () => {
    const pet = loadActivePet(projectRoot, petId);
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
  latestSessions = sessions as typeof latestSessions;
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send('sessions:update', sessions);
  }
}

/** Push the current pomodoro phase to the pet (independent of CLI sessions). */
export function broadcastPomodoroPhaseToPet(phase: PomodoroPhase): void {
  latestPomodoroPhase = phase;
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send('pomodoro:phase', phase);
  }
}

/**
 * Push a one-shot pet reaction when a pomodoro phase ends:
 *  - 'cheer' (focus done) → pet jumps once
 *  - 'wave'  (break done) → pet waves once
 */
export function broadcastPetReaction(reaction: 'cheer' | 'wave' | 'none'): void {
  if (petWindow && !petWindow.isDestroyed() && reaction !== 'none') {
    petWindow.webContents.send('pet:reaction', reaction);
  }
}

/**
 * Hot-swap the active pet without restarting. Called after config:save when the
 * user picks a different pet in the config UI.
 */
export function reloadPet(projectRoot: string, petId?: string): void {
  if (!petWindow || petWindow.isDestroyed()) return;
  const pet = loadActivePet(projectRoot, petId);
  if (pet) petWindow.webContents.send('pet:ready', pet);
}

const PHASE_CN: Record<string, string> = {
  idle: '空闲',
  working: '工作中',
  waiting: '等待确认',
  done: '完成',
  error: '出错',
};

/** Build + pop the pet menu (triggered by double-click). */
function showPetMenu(): void {
  const items: Electron.MenuItemConstructorOptions[] = [];

  if (latestSessions.length > 0) {
    items.push({ label: '运行中的 CLI', enabled: false });
    for (const s of latestSessions) {
      const src = s.source.charAt(0).toUpperCase() + s.source.slice(1);
      const phase = PHASE_CN[s.phase] ?? s.phase;
      const summary = s.lastSummary ? ` · ${s.lastSummary.slice(0, 30)}` : '';
      // enabled:false → display-only (we don't focus windows, per the decision).
      items.push({ label: `${src} · ${phase}${summary}`, enabled: false });
    }
    items.push({ type: 'separator' });
  }

  items.push(
    { label: clickThrough ? '取消点击穿透' : '点击穿透（鼠标可穿过桌宠）', click: toggleClickThrough },
    { label: '隐藏桌宠', click: () => petWindow?.hide() },
    { type: 'separator' },
    { label: '打开配置', click: () => showConfigWindow() },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  );

  const menu = Menu.buildFromTemplate(items);
  menu.popup();
}

/**
 * Register the pet:get-sessions handler so the pet renderer can PULL sessions
 * on demand (a backstop for the push subscription). Call once after the
 * ingester exists.
 */
export function registerPetIpc(allSessions: () => unknown[]): void {
  ipcMain.handle('pet:get-sessions', () => allSessions());
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
