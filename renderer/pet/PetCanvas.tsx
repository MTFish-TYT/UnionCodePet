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

export default function PetCanvas({
  spritesheetDataUrl,
  status,
  onDoubleClick,
}: {
  spritesheetDataUrl: string;
  status: PetStatus;
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

  const petState: PetState = phaseToPetState(status.phase);
  const row = ANIMATION_ROWS[petState];

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
      frameIdxRef.current = (fi + 1) % row.frames.length;
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

  return (
    <div className="pet-root">
      {showBubble && (
        <div
          className={`pet-bubble ${expanded ? 'pet-bubble-expanded' : ''}`}
          title={expanded ? '点击折叠' : label}
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          onClick={() => setExpanded((v) => !v)}
        >
          <span className="pet-bubble-text">{label}</span>
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
