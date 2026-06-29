// Pet window entry. Subscribes to the active pet info + live sessions, then
// renders the animated pet. The window itself is transparent/frameless (main),
// so this just fills 192×208 with the canvas.
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import PetCanvas from './PetCanvas';
import type { GlobalPhase } from './state-map';
import { aggregatePhase } from './state-map';

interface PetInfo {
  spritesheetDataUrl: string;
  displayName: string;
}

interface SessionLike {
  phase: string;
  updatedAt: number;
}

function PetApp() {
  const [pet, setPet] = useState<PetInfo | null>(null);
  const sessionsRef = useRef<SessionLike[]>([]);
  const [phase, setPhase] = useState<GlobalPhase>('idle');

  // Receive the active pet (spritesheet path) on boot.
  useEffect(() => {
    return window.pet.onPetReady((info) => setPet(info));
  }, []);

  // Subscribe to sessions (push) + poll on a timer (pull, as a backstop in
  // case the push subscription drops). The 'done' cheer window also expires on
  // the timer without a new event.
  useEffect(() => {
    const recompute = (sessions: SessionLike[]): void => {
      sessionsRef.current = sessions;
      setPhase(aggregatePhase(sessions));
    };
    const unsub = window.pet.onSessionsUpdate((sessions) => recompute(sessions as SessionLike[]));
    // Poll every 500ms — catches both the 'done' timeout AND any missed pushes.
    const iv = setInterval(() => {
      void window.pet.getSessions().then((s) => recompute(s as SessionLike[]));
    }, 500);
    return () => {
      unsub();
      clearInterval(iv);
    };
  }, []);

  if (!pet) return null;
  return <PetCanvas spritesheetDataUrl={pet.spritesheetDataUrl} phase={phase} />;
}

createRoot(document.getElementById('root')!).render(<PetApp />);
