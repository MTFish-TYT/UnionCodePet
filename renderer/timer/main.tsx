// Pomodoro timer window — a minimal transparent overlay (Catime-style).
//
// Shows the remaining countdown + phase label + a slim progress bar, with
// start/pause · skip · reset · close controls. The window itself is
// transparent/frameless/always-on-top (created by main); this just fills it.
//
// Mirrors the pet window's push+pull pattern: subscribe to snapshot updates AND
// poll every 500ms so the countdown keeps ticking even if a push is missed.
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { formatRemaining, phaseLabel, type PomodoroPhase, type PomodoroSnapshot } from '@shared/pomodoro';

function phaseClass(phase: PomodoroPhase): string {
  return `phase-${phase}`;
}

function TimerApp() {
  const [snap, setSnap] = useState<PomodoroSnapshot | null>(null);

  useEffect(() => {
    // Seed with the current snapshot, then subscribe to pushes.
    void window.timer.getSnapshot().then(setSnap);
    const unsub = window.timer.onSnapshot((s) => setSnap(s));
    // Pull backstop — the engine broadcasts on tick, but polling guarantees the
    // display refreshes even if a broadcast races with window mount.
    const iv = setInterval(() => {
      void window.timer.getSnapshot().then(setSnap);
    }, 500);
    return () => {
      unsub();
      clearInterval(iv);
    };
  }, []);

  if (!snap) return null;

  const phase = snap.phase;
  const cls = phaseClass(phase);
  const progress = snap.totalMs > 0 ? Math.max(0, Math.min(1, 1 - snap.remainingMs / snap.totalMs)) : 0;
  // Idle shows a friendly prompt instead of a frozen 0:00.
  const timeText = phase === 'idle' ? '25:00' : formatRemaining(snap.remainingMs);
  const phaseText = phase === 'idle'
    ? '🍅 点击开始'
    : `🍅 ${phaseLabel(phase)} · ${snap.focusCountInSet}/${snap.cyclesPerSet}`;

  return (
    <div className="timer-root">
      <div className={`timer-phase ${cls}`}>{phaseText}</div>
      <div className={`timer-time ${cls}`}>{timeText}</div>
      <div className="timer-progress-track">
        <div
          className={`timer-progress-fill ${cls === 'phase-idle' ? '' : cls}`}
          style={{
            width: `${progress * 100}%`,
            background: phase === 'idle' ? 'rgba(255,255,255,0.2)' : undefined,
          }}
        />
      </div>
      <div className="timer-controls">
        {snap.running ? (
          <button className="timer-btn" title="暂停" onClick={() => window.timer.control('pause')}>⏸</button>
        ) : (
          <button className="timer-btn" title={phase === 'idle' ? '开始' : '继续'} onClick={() => window.timer.control(phase === 'idle' ? 'start' : 'resume')}>▶</button>
        )}
        <button className="timer-btn" title="跳过当前阶段" onClick={() => window.timer.control('skip')}>⏭</button>
        <button className="timer-btn" title="重置" onClick={() => window.timer.control('reset')}>⟲</button>
        <button className="timer-btn timer-close" title="关闭（仅隐藏）" onClick={() => window.timer.hide()}>✕</button>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<TimerApp />);
