// Main app shell — sidebar nav + content area. Loads config on boot and
// persists changes via the preload bridge.
import { useEffect, useState } from 'react';
import type { RuntimeConfig } from '@shared/config';
import { ucp, type SessionSnapshot } from './ipc';
import SoundMapEditor from './components/SoundMapEditor';
import GeneralSettings from './components/GeneralSettings';
import SessionPanel from './components/SessionPanel';
import PetSettings from './components/PetSettings';
import PomodoroPanel from './components/PomodoroPanel';

type Page = 'sound' | 'general' | 'sessions' | 'pet' | 'pomodoro';

const NAV: Array<{ id: Page; icon: string; label: string }> = [
  { id: 'sound', icon: '🔊', label: '音效' },
  { id: 'general', icon: '⚙️', label: '通用' },
  { id: 'sessions', icon: '📊', label: '会话' },
  { id: 'pet', icon: '🐾', label: '桌宠' },
  { id: 'pomodoro', icon: '🍅', label: '番茄钟' },
];

export default function App() {
  const [config, setConfig] = useState<RuntimeConfig | null>(null);
  const [page, setPage] = useState<Page>('sound');
  const [err, setErr] = useState<string | null>(null);
  const [missingSounds, setMissingSounds] = useState<string[]>([]);

  // Sessions are subscribed at the TOP LEVEL (not inside SessionPanel) so they
  // keep updating regardless of which page is shown — otherwise events that
  // fire while you're on the sound page would be lost. SessionPanel just reads
  // this prop.
  const [sessions, setSessions] = useState<SessionSnapshot[]>([]);
  useEffect(() => ucp.onSessionsUpdate(setSessions), []);

  useEffect(() => {
    ucp
      .getConfig()
      .then((c) => {
        setConfig(c);
        // Check for broken sound paths (e.g. after packaging/moving). Show a
        // banner prompting the user to re-pick them on the sound page.
        return ucp.validateSounds();
      })
      .then(setMissingSounds)
      .catch((e) => setErr(String(e)));
  }, []);

  async function handleSave(cfg: RuntimeConfig): Promise<void> {
    try {
      const saved = await ucp.saveConfig(cfg);
      setConfig(saved);
    } catch (e) {
      setErr(String(e));
    }
  }

  async function handleReset(): Promise<void> {
    const cfg = await ucp.resetConfig();
    setConfig(cfg);
  }

  if (err) {
    return (
      <div className="app">
        <div className="error-box">配置加载失败：{err}</div>
      </div>
    );
  }
  if (!config) {
    return (
      <div className="app">
        <div className="loading">加载中…</div>
      </div>
    );
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-title">🐾 UnionCodePet</div>
        <nav>
          {NAV.map((n) => (
            <button
              key={n.id}
              className={`nav-item ${page === n.id ? 'active' : ''}`}
              onClick={() => setPage(n.id)}
            >
              <span className="nav-icon">{n.icon}</span>
              <span>{n.label}</span>
            </button>
          ))}
        </nav>
        {page === 'sound' && (
          <button className="btn-link nav-reset" onClick={handleReset}>
            恢复默认
          </button>
        )}
      </aside>

      <main className="content">
        {missingSounds.length > 0 && (
          <div className="warn-banner" onClick={() => setPage('sound')}>
            ⚠️ {missingSounds.length} 个音效文件路径无效（可能已移动或打包后失效），
           点击前往音效页重新选择。
          </div>
        )}
        {page === 'sound' && <SoundMapEditor config={config} onSave={handleSave} />}
        {page === 'general' && <GeneralSettings config={config} onSave={handleSave} />}
        {page === 'sessions' && <SessionPanel sessions={sessions} />}
        {page === 'pet' && <PetSettings config={config} onSave={handleSave} />}
        {page === 'pomodoro' && <PomodoroPanel config={config} onSave={handleSave} />}
      </main>
    </div>
  );
}
