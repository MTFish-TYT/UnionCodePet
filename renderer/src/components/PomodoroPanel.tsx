// Pomodoro settings page — preset selection, live timer controls, and the 4
// knobs (focus / short break / cycles-per-set / long break).
//
// State flow:
//  - The live countdown subscribes to pomodoro:snapshot (main pushes every tick).
//  - Picking a preset calls applyPomodoroPreset (writes config + resets engine).
//  - Editing the 4 knobs updates the ACTIVE preset's copy in config and saves;
//    builtins are cloned-to-custom on first edit (builtins are read-only).
import { useEffect, useState } from 'react';
import type { RuntimeConfig, PomodoroPreset } from '@shared/config';
import { ucp } from '../ipc';
import { formatRemaining, phaseLabel, type PomodoroSnapshot } from '@shared/pomodoro';

const PHASE_COLOR: Record<string, string> = {
  idle: '#565f89',
  focusing: '#f7768e',
  'short-break': '#9ece6a',
  'long-break': '#7aa2f7',
};

export default function PomodoroPanel({
  config,
  onSave,
}: {
  config: RuntimeConfig;
  onSave: (cfg: RuntimeConfig) => void;
}) {
  const [snap, setSnap] = useState<PomodoroSnapshot | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  // Seed + subscribe to the live snapshot so the countdown card updates in real
  // time even while sitting on this page.
  useEffect(() => {
    void ucp.getPomodoroSnapshot().then(setSnap);
    return ucp.onPomodoroSnapshot(setSnap);
  }, []);

  const activeId = config.pomodoro.activePresetId;
  const activePreset = config.pomodoro.presets.find((p) => p.id === activeId) ?? config.pomodoro.presets[0];

  // Editing a builtin clones it into a custom preset (builtins are read-only).
  function cloneBuiltinToCustom(p: PomodoroPreset): PomodoroPreset {
    const id = `custom-${Date.now().toString(36)}`;
    return { ...p, id, name: `${p.name} 副本`, builtin: false };
  }

  function patchActive(patch: Partial<PomodoroPreset>): void {
    if (!activePreset) return;
    let target = activePreset;
    if (activePreset.builtin) target = cloneBuiltinToCustom(activePreset);
    const updated: PomodoroPreset = { ...target, ...patch };
    const presets = activePreset.builtin
      ? [...config.pomodoro.presets, updated]
      : config.pomodoro.presets.map((p) => (p.id === target.id ? updated : p));
    onSave({ ...config, pomodoro: { ...config.pomodoro, presets, activePresetId: updated.id } });
    flash();
  }

  function flash(): void {
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 800);
  }

  async function selectPreset(id: string): Promise<void> {
    onSave({ ...config, pomodoro: { ...config.pomodoro, activePresetId: id } });
    // Tell the engine to adopt this preset now (resets the run).
    await ucp.applyPomodoroPreset(id);
    flash();
  }

  async function control(action: 'start' | 'pause' | 'resume' | 'reset' | 'skip'): Promise<void> {
    const fresh = await ucp.pomodoroControl(action);
    setSnap(fresh);
  }

  async function browseSound(field: 'soundOnFocusEnd' | 'soundOnBreakEnd'): Promise<void> {
    const path = await ucp.browseSoundFile();
    if (!path) return;
    onSave({ ...config, pomodoro: { ...config.pomodoro, [field]: path } });
    flash();
  }

  const phase = snap?.phase ?? 'idle';
  const running = snap?.running ?? false;
  const timeText = snap ? formatRemaining(snap.remainingMs) : '--:--';
  const progress = snap && snap.totalMs > 0 ? Math.max(0, Math.min(1, 1 - snap.remainingMs / snap.totalMs)) : 0;

  return (
    <div className="settings-page">
      <div className="editor-header">
        <h2>番茄钟</h2>
        <p className="muted">
          番茄钟计时跑在后台，关掉配置窗口也继续。专注/休息阶段结束时桌宠会欢呼/招手并播放提示音。
        </p>
      </div>

      {/* ---- live status card ---- */}
      <section className="settings-section pomodoro-status">
        <div className="pomodoro-time" style={{ color: PHASE_COLOR[phase] }}>{timeText}</div>
        <div className="pomodoro-phase-row">
          <span className="pomodoro-phase-tag" style={{ background: `${PHASE_COLOR[phase]}22`, color: PHASE_COLOR[phase] }}>
            {phaseLabel(phase)}
          </span>
          {phase !== 'idle' && snap && (
            <span className="muted">
              第 {snap.focusCountInSet}/{snap.cyclesPerSet} 轮 · 已完成 {snap.completedFocus} 个专注
            </span>
          )}
        </div>
        <div className="pomodoro-progress-track">
          <div className="pomodoro-progress-fill" style={{ width: `${progress * 100}%`, background: PHASE_COLOR[phase] }} />
        </div>
        <div className="pomodoro-controls">
          {running ? (
            <button className="pomodoro-btn" onClick={() => control('pause')}>⏸ 暂停</button>
          ) : (
            <button className="pomodoro-btn pomodoro-btn-primary" onClick={() => control(phase === 'idle' ? 'start' : 'resume')}>
              {phase === 'idle' ? '▶ 开始专注' : '▶ 继续'}
            </button>
          )}
          <button className="pomodoro-btn" onClick={() => control('skip')}>⏭ 跳过</button>
          <button className="pomodoro-btn" onClick={() => control('reset')}>⟲ 重置</button>
        </div>
      </section>

      {/* ---- presets ---- */}
      <section className="settings-section">
        <h3>预设方案</h3>
        <p className="muted">点选即应用（会重置当前计时）。内置预设不可删除，编辑内置预设会自动复制为自定义。</p>
        <div className="pomodoro-preset-list">
          {config.pomodoro.presets.map((p) => {
            const active = p.id === activeId;
            return (
              <button
                key={p.id}
                className={`pet-card ${active ? 'pet-card-active' : ''}`}
                onClick={() => selectPreset(p.id)}
              >
                <span className="pet-card-name">
                  {p.name}
                  {p.builtin && <span className="muted" style={{ fontSize: 11, marginLeft: 6 }}>内置</span>}
                </span>
                <span className="muted" style={{ fontSize: 12 }}>
                  {p.focusMin}/{p.shortBreakMin} · {p.cyclesPerSet}轮 · 长休{p.longBreakMin}分
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* ---- knobs for the active preset ---- */}
      {activePreset && (
        <section className="settings-section">
          <h3>参数{activePreset.builtin ? '（编辑内置预设会复制为自定义）' : ''}</h3>
          <div className="form-row">
            <label>专注时长（分钟）</label>
            <input
              type="number"
              min={1}
              max={180}
              value={activePreset.focusMin}
              onChange={(e) => patchActive({ focusMin: clamp(Number(e.target.value), 1, 180) })}
            />
            <span className="hint">单轮专注时间</span>
          </div>
          <div className="form-row">
            <label>短休息（分钟）</label>
            <input
              type="number"
              min={1}
              max={60}
              value={activePreset.shortBreakMin}
              onChange={(e) => patchActive({ shortBreakMin: clamp(Number(e.target.value), 1, 60) })}
            />
            <span className="hint">每轮专注之间的休息</span>
          </div>
          <div className="form-row">
            <label>多少轮为一组</label>
            <input
              type="number"
              min={1}
              max={10}
              value={activePreset.cyclesPerSet}
              onChange={(e) => patchActive({ cyclesPerSet: clamp(Number(e.target.value), 1, 10) })}
            />
            <span className="hint">完成这么多轮专注后进入长休息</span>
          </div>
          <div className="form-row">
            <label>长休息（分钟）</label>
            <input
              type="number"
              min={1}
              max={60}
              value={activePreset.longBreakMin}
              onChange={(e) => patchActive({ longBreakMin: clamp(Number(e.target.value), 1, 60) })}
            />
            <span className="hint">每组之间的休息</span>
          </div>
          {savedFlash && <span className="saved-tag">已保存</span>}
        </section>
      )}

      {/* ---- reminder sounds ---- */}
      <section className="settings-section">
        <h3>阶段提醒音效</h3>
        <div className="form-row">
          <label>专注结束</label>
          <input type="text" readOnly value={config.pomodoro.soundOnFocusEnd ?? ''} placeholder="（未设置）" className="row-path" />
          <button className="btn-icon" title="选择文件" onClick={() => browseSound('soundOnFocusEnd')}>📁</button>
        </div>
        <div className="form-row">
          <label>休息结束</label>
          <input type="text" readOnly value={config.pomodoro.soundOnBreakEnd ?? ''} placeholder="（未设置）" className="row-path" />
          <button className="btn-icon" title="选择文件" onClick={() => browseSound('soundOnBreakEnd')}>📁</button>
        </div>
        <p className="muted">未设置时阶段切换静默（仍有桌宠动画反应）。</p>
      </section>
    </div>
  );
}

function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, n));
}
