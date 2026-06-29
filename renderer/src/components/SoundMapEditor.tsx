// Sound map editor — the core of the config UI.
// Lists every source×event combo as a row; each row lets you pick a wav file,
// preview it, or mark it silent. Changes save immediately.
import { useEffect, useState } from 'react';
import type { RuntimeConfig } from '@shared/config';
import type { SoundKey } from '@shared/protocol';
import { SOURCE_LABEL, EVENT_LABEL, type EventKind } from '../labels';
import { ucp } from '../ipc';

const SOURCES: Array<keyof typeof SOURCE_LABEL> = ['claude', 'zcode', 'codex'];
const EVENTS: EventKind[] = [
  'task_complete',
  'permission_request',
  'plan_started',
  'error',
  'task_started',
  'tool_call',
  'tool_result',
  'message',
];

// Which combos get shown by default vs. tucked under "more". Only the meaningful
// ones (complete/permission/plan/error) appear upfront; the noisy ones collapse.
const PRIMARY_EVENTS: EventKind[] = ['task_complete', 'permission_request', 'plan_started', 'error'];

export default function SoundMapEditor({
  config,
  onSave,
}: {
  config: RuntimeConfig;
  onSave: (cfg: RuntimeConfig) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState<string | null>(null);

  const eventsToShow = showAll ? EVENTS : PRIMARY_EVENTS;

  function update(key: SoundKey, value: string | null): void {
    const next: RuntimeConfig = {
      ...config,
      soundMap: { ...config.soundMap, [key]: value },
    };
    onSave(next);
    flashSaved(key);
  }

  function flashSaved(key: string): void {
    setSavedFlash(key);
    setTimeout(() => setSavedFlash((k) => (k === key ? null : k)), 800);
  }

  async function handleBrowse(key: SoundKey): Promise<void> {
    const path = await ucp.browseSoundFile();
    if (path) update(key, path);
  }

  async function handlePreview(path: string, key: string): Promise<void> {
    if (!path) return;
    setPreviewing(key);
    await ucp.previewSound(path);
    setTimeout(() => setPreviewing((k) => (k === key ? null : k)), 600);
  }

  return (
    <div className="sound-editor">
      <div className="editor-header">
        <h2>音效映射</h2>
        <p className="muted">为每个 CLI 的事件配置提示音。改动会自动保存。</p>
      </div>

      <div className="sound-grid">
        {SOURCES.map((src) =>
          eventsToShow.map((ev) => {
            const key = `${src}:${ev}` as SoundKey;
            const value = config.soundMap[key];
            const silent = value === null || value === undefined;
            const fileName = value ? value.split(/[\\/]/).pop() : '';
            const justSaved = savedFlash === key;
            return (
              <div key={key} className={`sound-row ${justSaved ? 'flash' : ''}`}>
                <div className="row-label">
                  <span className="src-badge" data-src={src}>
                    {SOURCE_LABEL[src]}
                  </span>
                  <span className="ev-name">{EVENT_LABEL[ev]}</span>
                </div>
                <div className="row-path" title={value ?? ''}>
                  {silent ? (
                    <span className="silent">（静默）</span>
                  ) : (
                    <span className="filename">{fileName}</span>
                  )}
                </div>
                <div className="row-actions">
                  <button
                    className="btn-icon"
                    title="选择文件"
                    onClick={() => handleBrowse(key)}
                  >
                    📁
                  </button>
                  <button
                    className="btn-icon"
                    title="试听"
                    disabled={silent}
                    onClick={() => value && handlePreview(value, key)}
                  >
                    {previewing === key ? '🔊' : '▶'}
                  </button>
                  <button
                    className="btn-icon"
                    title={silent ? '取消静默' : '设为静默'}
                    onClick={() => update(key, silent ? '' : null)}
                  >
                    {silent ? '🔇' : '🔈'}
                  </button>
                  {justSaved && <span className="saved-tag">已保存</span>}
                </div>
              </div>
            );
          }),
        )}
      </div>

      <button className="btn-link" onClick={() => setShowAll((v) => !v)}>
        {showAll ? '收起次要事件 ▲' : '显示全部事件（含工具调用等高频项） ▼'}
      </button>
    </div>
  );
}
