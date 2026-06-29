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

  // Subscribe to sessions + re-aggregate periodically (the 'done' cheer window
  // expires on a timer, not a new event).
  useEffect(() => {
    const unsub = window.pet.onSessionsUpdate((sessions) => {
      sessionsRef.current = sessions as SessionLike[];
      setPhase(aggregatePhase(sessionsRef.current));
    });
    const iv = setInterval(() => {
      setPhase(aggregatePhase(sessionsRef.current));
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
