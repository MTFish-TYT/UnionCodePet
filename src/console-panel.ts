/**
 * Console status panel.
 *
 * The MVP "UI": prints a compact, redrawn view of every active session so you
 * can see at a glance what each CLI is doing. Replaces itself each tick rather
 * than scrolling, to behave like a dashboard. This is the layer a future
 * Electron renderer will replace — the data it reads is already normalized.
 */
import type { SessionState, SessionPhase } from './session-state.js';

const PHASE_LABEL: Record<SessionPhase, string> = {
  idle: '空闲',
  working: '工作中',
  waiting: '等待',
  done: '完成',
  error: '出错',
};

const SOURCE_LABEL: Record<string, string> = {
  claude: 'Claude',
  zcode: 'Zcode',
  codex: 'Codex',
};

export class ConsolePanel {
  private lastRender = '';
  private timer?: ReturnType<typeof setInterval>;

  /** Start redrawing every `intervalMs`. */
  start(tracker: { all(): SessionState[] }, intervalMs = 1000): void {
    this.stop();
    this.timer = setInterval(() => this.render(tracker.all()), intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Render the session list as one block. Idempotent if nothing changed. */
  render(sessions: SessionState[]): void {
    const lines: string[] = [];
    lines.push('┌─ UnionCodePet · 多 CLI 状态面板 ─────────────────────');
    if (sessions.length === 0) {
      lines.push('│  （暂无活动会话）');
    } else {
      for (const s of sessions) {
        lines.push('│ ' + this.formatSession(s));
      }
    }
    lines.push('└──────────────────────────────────────────────────────');

    const out = lines.join('\n');
    if (out === this.lastRender) return; // no change → no flicker
    this.lastRender = out;
    // Move cursor up by previous height so we overwrite in place.
    if (this.lastRender) {
      const prevHeight = this.lastRender.split('\n').length;
      process.stdout.write(`\x1b[${prevHeight}A\x1b[J`);
    }
    process.stdout.write(out + '\n');
  }

  private formatSession(s: SessionState): string {
    const src = SOURCE_LABEL[s.source] ?? s.source;
    const phase = PHASE_LABEL[s.phase] ?? s.phase;
    const summary = s.lastSummary ?? '—';
    const tool = s.lastToolName ? ` [${s.lastToolName}]` : '';
    const age = this.ageLabel(s.updatedAt);
    // Keep each row to a stable-ish width so redraw stays tidy.
    return `${src.padEnd(7)} ${phase}  ${summary}${tool}  ${age}`;
  }

  private ageLabel(updatedAt: number): string {
    const sec = Math.max(0, Math.round((Date.now() - updatedAt) / 1000));
    if (sec < 60) return `${sec}s 前`;
    const min = Math.round(sec / 60);
    if (min < 60) return `${min}m 前`;
    return `${Math.round(min / 60)}h 前`;
  }
}
