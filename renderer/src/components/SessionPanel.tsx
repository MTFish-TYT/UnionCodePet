// Live session panel — the React replacement for the old console-panel.
// Subscribes to `sessions:update` pushed from the main process.
import { useEffect, useState } from 'react';
import { ucp, type SessionSnapshot } from '../ipc';
import { SOURCE_LABEL, PHASE_LABEL, PHASE_COLOR, ageLabel } from '../labels';

export default function SessionPanel() {
  const [sessions, setSessions] = useState<SessionSnapshot[]>([]);

  useEffect(() => {
    const unsubscribe = ucp.onSessionsUpdate(setSessions);
    return unsubscribe;
  }, []);

  return (
    <div className="settings-page">
      <div className="editor-header">
        <h2>会话状态</h2>
        <p className="muted">实时显示各 CLI 会话的当前状态。</p>
      </div>

      {sessions.length === 0 ? (
        <p className="muted">（暂无活动会话）</p>
      ) : (
        <div className="session-list">
          {sessions.map((s) => (
            <div className="session-row" key={`${s.source}:${s.sessionId}`}>
              <span className="src-badge" data-src={s.source}>
                {SOURCE_LABEL[s.source]}
              </span>
              <span
                className="phase-tag"
                style={{ color: PHASE_COLOR[s.phase] ?? '#565f89' }}
              >
                {PHASE_LABEL[s.phase] ?? s.phase}
              </span>
              <span className="session-summary">{s.lastSummary || '—'}</span>
              {s.lastToolName && <span className="session-tool">[{s.lastToolName}]</span>}
              <span className="session-age">{ageLabel(s.updatedAt)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
