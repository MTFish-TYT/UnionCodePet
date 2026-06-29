// General settings — port, Codex poll interval, per-event rate limits.
import type { RuntimeConfig } from '@shared/config';
import { EVENT_LABEL, type EventKind } from '../labels';

const RATE_EVENTS: EventKind[] = [
  'task_complete',
  'permission_request',
  'plan_started',
  'tool_call',
  'error',
  'message',
];

export default function GeneralSettings({
  config,
  onSave,
}: {
  config: RuntimeConfig;
  onSave: (cfg: RuntimeConfig) => void;
}) {
  function setPort(port: number): void {
    onSave({ ...config, daemon: { ...config.daemon, port } });
  }
  function setPollMs(ms: number): void {
    onSave({ ...config, daemon: { ...config.daemon, codexPollIntervalMs: ms } });
  }
  function setRate(ev: EventKind, ms: number): void {
    onSave({ ...config, rateLimitsMs: { ...config.rateLimitsMs, [ev]: ms } });
  }

  return (
    <div className="settings-page">
      <div className="editor-header">
        <h2>通用设置</h2>
        <p className="muted">守护进程参数和事件限流。改动会自动保存并即时生效。</p>
      </div>

      <section className="settings-section">
        <h3>守护进程</h3>
        <div className="form-row">
          <label>HTTP 端口</label>
          <input
            type="number"
            min={1024}
            max={65535}
            value={config.daemon.port}
            onChange={(e) => setPort(Number(e.target.value))}
          />
          <span className="hint">dispatcher.ps1 POST 到此端口</span>
        </div>
        <div className="form-row">
          <label>Codex 轮询间隔 (ms)</label>
          <input
            type="number"
            min={250}
            step={250}
            value={config.daemon.codexPollIntervalMs}
            onChange={(e) => setPollMs(Number(e.target.value))}
          />
          <span className="hint">越小越实时，但 CPU 占用越高</span>
        </div>
      </section>

      <section className="settings-section">
        <h3>事件限流（冷却毫秒）</h3>
        <p className="muted">同一会话内，同一事件在冷却时间内不重复响声。</p>
        {RATE_EVENTS.map((ev) => (
          <div className="form-row" key={ev}>
            <label>{EVENT_LABEL[ev]}</label>
            <input
              type="number"
              min={0}
              step={1000}
              value={config.rateLimitsMs[ev]}
              onChange={(e) => setRate(ev, Number(e.target.value))}
            />
            <span className="hint">{msLabel(config.rateLimitsMs[ev])}</span>
          </div>
        ))}
      </section>

      <p className="muted config-path">
        ⚠️ 端口改动需要重启应用才生效（dispatcher.ps1 也要同步更新端口）。
      </p>
    </div>
  );
}

function msLabel(ms: number): string {
  if (ms <= 0) return '不限流';
  if (ms < 1000) return `${ms}ms`;
  return `${ms / 1000}s`;
}
