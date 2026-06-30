// PetCanvas — the sprite-sheet animation player + status bubble.
//
// Renders the pet sprite (animated per the hatch-pet contract) and, above it,
// a speech bubble showing the current status label (e.g. "Claude：等待确认").
// The whole pet is draggable via CSS app-region; double-click opens the menu.
import { useEffect, useRef, useState } from 'react';
import {
  ANIMATION_ROWS,
  CELL_W,
  CELL_H,
  type PetState,
} from './animation-rows';
import type { PetStatus } from './state-map';
import { phaseToPetState } from './state-map';
import type { HistoryEntry } from './global';

export default function PetCanvas({
  spritesheetDataUrl,
  status,
  pomodoroOverride,
  reaction,
  onDoubleClick,
}: {
  spritesheetDataUrl: string;
  status: PetStatus;
  /** Animation state to use when the CLI is idle (pomodoro focusing→running). */
  pomodoroOverride?: PetState | null;
  /** One-shot reaction token: bumping `n` plays cheer/wave once. */
  reaction?: { kind: 'cheer' | 'wave'; n: number } | null;
  onDoubleClick: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const frameIdxRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Incremented each time a new atlas finishes loading. Using a counter instead
  // of a boolean so that hot-swapping the pet (a second load) actually re-runs
  // the animation effect — setImgLoaded(true) twice is a no-op and the loop
  // would keep drawing the OLD image from its closure.
  const [imgVersion, setImgVersion] = useState(0);

  // The pet's "real" state from status. When idle, we spice things up by
  // occasionally playing a random idle-buster animation (waving/jumping/review)
  // so the pet feels alive instead of just breathing forever. The pomodoro
  // timer can override the idle pose (e.g. show 'running' while focusing).
  const cliState: PetState = phaseToPetState(status.phase);
  const baseState: PetState = cliState === 'idle' ? (pomodoroOverride ?? 'idle') : cliState;
  const [activeState, setActiveState] = useState<PetState>('idle');
  const idleLoopsRef = useRef(0); // idle loops counted before maybe doing a buster
  const busterLoopsRef = useRef(0); // loops of the current buster played
  const lastReactionNRef = useRef(0);

  // Whenever the base state changes, sync the active state (non-idle states
  // always follow status; idle resets the idle-loop counter).
  useEffect(() => {
    setActiveState(baseState);
    idleLoopsRef.current = 0;
    busterLoopsRef.current = 0;
  }, [baseState]);

  // One-shot reaction from the pomodoro engine: focus-end → cheer (jumping),
  // break-end → wave (waving). Plays one loop then returns to the base state.
  useEffect(() => {
    if (!reaction || reaction.n === lastReactionNRef.current) return;
    lastReactionNRef.current = reaction.n;
    setActiveState(reaction.kind === 'cheer' ? 'jumping' : 'waving');
    busterLoopsRef.current = 0;
  }, [reaction]);

  const row = ANIMATION_ROWS[activeState];

  // Pick a random "idle buster" animation to break up the monotony.
  const IDLE_BUSTERS: PetState[] = ['waving', 'jumping', 'review'];
  function pickBuster(): PetState {
    return IDLE_BUSTERS[Math.floor(Math.random() * IDLE_BUSTERS.length)];
  }

  // Load the atlas image whenever the data URL changes (boot + pet swap).
  useEffect(() => {
    const img = new Image();
    img.src = spritesheetDataUrl;
    img.onload = () => {
      imgRef.current = img;
      setImgVersion((v) => v + 1);
    };
  }, [spritesheetDataUrl]);

  // Animation loop: draw current frame, schedule next per its duration.
  // Re-runs when imgVersion changes (new pet loaded) or the animation row changes.
  useEffect(() => {
    if (imgVersion === 0) return;
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    frameIdxRef.current = 0; // restart from frame 0 on state change

    const drawFrame = (): void => {
      const fi = frameIdxRef.current;
      const col = row.frames[fi] ?? 0;
      const sx = col * CELL_W;
      const sy = row.row * CELL_H;
      ctx.clearRect(0, 0, CELL_W, CELL_H);
      ctx.drawImage(img, sx, sy, CELL_W, CELL_H, 0, 0, CELL_W, CELL_H);
      const next = (fi + 1) % row.frames.length;
      frameIdxRef.current = next;

      // End of a full loop: decide whether to keep looping or switch state.
      if (next === 0) {
        // If we're playing a transient animation that isn't the base state
        // (an idle buster OR a pomodoro reaction), return to base after a
        // couple of loops. This handles both idle→buster→idle and
        // running→jumping(reaction)→running uniformly.
        if (activeState !== baseState) {
          busterLoopsRef.current += 1;
          if (busterLoopsRef.current >= 2) {
            setActiveState(baseState);
            idleLoopsRef.current = 0;
            return; // effect cleanup restarts with the base row
          }
        } else if (baseState === 'idle') {
          // Truly idle: occasionally play a random buster for liveliness.
          idleLoopsRef.current += 1;
          if (idleLoopsRef.current >= 2 && Math.random() < 0.25) {
            setActiveState(pickBuster());
            busterLoopsRef.current = 0;
            return;
          }
        }
      }

      const dur = row.durations[fi] ?? 150;
      timerRef.current = setTimeout(drawFrame, dur);
    };

    drawFrame();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [imgVersion, row]);

  // Bubble is always shown so the ☰ menu button is reachable at all times
  // (even when idle). The label falls back to "空闲" when there's nothing else.
  const [expanded, setExpanded] = useState(false);
  const label = status.label || (status.phase === 'idle' ? '空闲' : '空闲');
  const showBubble = true;

  // History panel (toggled by the 📜 button on the bubble).
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  async function toggleHistory(): Promise<void> {
    if (showHistory) {
      setShowHistory(false);
      return;
    }
    const h = await window.pet.getHistory();
    setHistory(h);
    setShowHistory(true);
  }

  return (
    <div className="pet-root">
      {showHistory && (
        <div className="pet-history" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <div className="pet-history-header">
            <span>事件历史（{history.length}）</span>
            <span className="pet-history-close" onClick={() => setShowHistory(false)}>✕</span>
          </div>
          <div className="pet-history-list">
            {history.length === 0 && <div className="pet-history-empty">暂无事件</div>}
            {history.map((h, i) => (
              <div key={i} className="pet-history-row">
                <span className="pet-history-time">{new Date(h.ts).toLocaleTimeString('zh-CN', { hour12: false })}</span>
                <span className={`pet-history-src src-badge-${h.source}`}>{h.source}</span>
                <span className="pet-history-text">{h.summary || h.event}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {showBubble && (
        <div
          className={`pet-bubble ${expanded ? 'pet-bubble-expanded' : ''}`}
          title={expanded ? '点击折叠' : label}
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          onClick={() => setExpanded((v) => !v)}
        >
          <span className="pet-bubble-text">{label}</span>
          {/* History panel toggle. */}
          <span
            className="pet-bubble-menu"
            title="历史"
            onClick={(e) => {
              e.stopPropagation();
              void toggleHistory();
            }}
          >
            📜
          </span>
          {/* Explicit menu button — avoids the click/dblclick conflict that
              made double-click unreliable. */}
          <span
            className="pet-bubble-menu"
            title="打开菜单"
            onClick={(e) => {
              e.stopPropagation();
              onDoubleClick();
            }}
          >
            ☰
          </span>
        </div>
      )}
      <canvas
        ref={canvasRef}
        width={CELL_W}
        height={CELL_H}
        style={{ display: 'block', WebkitAppRegion: 'drag' } as React.CSSProperties}
      />
    </div>
  );
}
