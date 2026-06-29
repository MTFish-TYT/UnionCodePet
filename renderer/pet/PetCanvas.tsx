// PetCanvas — the sprite-sheet animation player.
//
// Loads the 1536×1872 atlas, slices it into 192×208 cells per the animation-rows
// contract, and plays the row for the current pet state. Frame timing follows
// each row's `durations` array (the contract is NOT in pet.json).
//
// The whole window is draggable via CSS -webkit-app-region on the canvas.
import { useEffect, useRef, useState } from 'react';
import {
  ANIMATION_ROWS,
  CELL_W,
  CELL_H,
  type PetState,
} from './animation-rows';
import type { GlobalPhase } from './state-map';
import { phaseToPetState } from './state-map';

export default function PetCanvas({
  spritesheetDataUrl,
  phase,
}: {
  spritesheetDataUrl: string;
  phase: GlobalPhase;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const frameIdxRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [imgLoaded, setImgLoaded] = useState(false);

  const petState: PetState = phaseToPetState(phase);
  const row = ANIMATION_ROWS[petState];

  // Load the atlas image once. The src is a base64 data URL (main reads the
  // webp and encodes it, because the renderer's CSP blocks file:// access).
  useEffect(() => {
    const img = new Image();
    img.src = spritesheetDataUrl;
    img.onload = () => {
      imgRef.current = img;
      setImgLoaded(true);
    };
  }, [spritesheetDataUrl]);

  // Animation loop: draw current frame, schedule next per its duration.
  useEffect(() => {
    if (!imgLoaded) return;
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
      // Advance + schedule next frame after this frame's duration.
      frameIdxRef.current = (fi + 1) % row.frames.length;
      const dur = row.durations[fi] ?? 150;
      timerRef.current = setTimeout(drawFrame, dur);
    };

    drawFrame();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [imgLoaded, row]);

  return (
    <canvas
      ref={canvasRef}
      width={CELL_W}
      height={CELL_H}
      style={
        {
          display: 'block',
          // Transparent canvas: only the pet sprite shows, the rest of the
          // window is see-through. Whole pet is draggable via app-region.
          WebkitAppRegion: 'drag',
        } as React.CSSProperties
      }
    />
  );
}
