/**
 * Codex session log poller.
 *
 * On Windows Codex disables hooks, so the only real-time signal is its session
 * rollout files at ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl. Each line is a
 * JSON event; we read them incrementally (remembering the byte offset per file)
 * and hand parsed lines to the normalizer.
 *
 * Design notes:
 * - We track files by absolute path with a per-file byte offset, so we only
 *   read newly-appended lines each tick. Reopened files (offset > size) reset.
 * - 1.5s interval matches Clawd's documented Codex latency.
 */
import { readdir, stat, open } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir, platform } from 'node:os';
import { CONFIG } from './config.js';
import { normalizeCodexJsonlLine } from './normalizer.js';
import type { UnifiedEvent } from './protocol.js';

interface FileCursor {
  path: string;
  /** Byte offset we've already read up to. */
  offset: number;
  /** sessionId mined from the rollout filename (uuid segment). */
  sessionId: string;
  /** Carried-over partial line (the writer may flush mid-line). */
  pending?: string;
}

export class CodexPoller {
  private cursors = new Map<string, FileCursor>();
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    private onEvent: (ev: UnifiedEvent) => void,
    private log: (msg: string) => void = () => {},
  ) {}

  /** Resolve the sessions root (~/.codex/sessions on every platform). */
  private get sessionRoot(): string {
    if (CONFIG.codexSessionRoot) return CONFIG.codexSessionRoot;
    return join(homedir(), '.codex', 'sessions');
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    // Fire once immediately so we don't wait a full interval on startup.
    void this.tick();
    this.timer = setInterval(() => void this.tick(), CONFIG.codexPollIntervalMs);
    this.log(`[codex-poller] started, root=${this.sessionRoot}`);
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private async tick(): Promise<void> {
    if (platform() !== 'win32' && platform() !== 'darwin' && platform() !== 'linux') return;
    let files: string[] = [];
    try {
      files = await this.collectJsonlFiles(this.sessionRoot);
    } catch {
      // sessions dir may not exist yet (fresh install). Silent.
      return;
    }
    for (const path of files) {
      await this.readNewLines(path).catch((e) =>
        this.log(`[codex-poller] read error ${path}: ${(e as Error).message}`),
      );
    }
  }

  /** Recursively collect *.jsonl under root. */
  private async collectJsonlFiles(dir: string): Promise<string[]> {
    const out: string[] = [];
    let entries: import('node:fs').Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true, encoding: 'utf8' });
    } catch {
      return out;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        out.push(...(await this.collectJsonlFiles(full)));
      } else if (e.isFile() && e.name.endsWith('.jsonl')) {
        out.push(full);
      }
    }
    return out;
  }

  /** Read bytes after our last offset, parse complete lines, emit events. */
  private async readNewLines(path: string): Promise<void> {
    const size = (await stat(path)).size;
    let cur = this.cursors.get(path);
    const isNew = !cur;
    if (!cur) {
      cur = { path, offset: 0, sessionId: sessionIdFromPath(path) };
      this.cursors.set(path, cur);
    }
    // First time we see a file: jump to the END, don't replay history.
    // On startup there may be dozens of old session files; replaying them would
    // flood the panel with stale state. We only want NEW appends going forward.
    if (isNew) {
      cur.offset = size;
      return;
    }
    // File truncated/rotated → start over.
    if (cur.offset > size) cur.offset = 0;
    if (cur.offset === size) return; // nothing new

    const remaining = size - cur.offset;
    const buf = Buffer.allocUnsafe(remaining);
    const fh = await open(path, 'r');
    try {
      await fh.read(buf, 0, remaining, cur.offset);
    } finally {
      await fh.close();
    }

    const text = buf.toString('utf8');
    // jsonl: each line is one JSON object. Buffer may end mid-line if the writer
    // is mid-flush; keep the partial tail and prepend it next read.
    let chunk = cur.pending ? cur.pending + text : text;
    const lines = chunk.split('\n');
    cur.pending = lines.pop() ?? ''; // last element is everything after final \n
    const now = Date.now();
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        continue; // malformed/partial line — skip harmlessly
      }
      const ev = normalizeCodexJsonlLine(parsed, cur.sessionId, now);
      if (ev) this.onEvent(ev);
    }
    cur.offset = size;
  }
}

/** Extract the session uuid from a rollout filename. */
function sessionIdFromPath(path: string): string {
  // rollout-2026-06-29T13-36-01-019f11e0-9e17-7e83-9246-8ddc49755dd6.jsonl
  const base = path.split(/[\\/]/).pop() ?? '';
  const m = base.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  return m ? m[1] : base;
}
