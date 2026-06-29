// Pet window entry. Subscribes to the active pet info + live sessions, then
// renders the animated pet with a status bubble. The window itself is
// transparent/frameless (main), so this just fills 192×208 with the canvas.
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import PetCanvas from './PetCanvas';
import type { PetStatus, SessionLike } from './state-map';
import { aggregateStatus } from './state-map';

interface PetInfo {
  spritesheetDataUrl: string;
  displayName: string;
}

function PetApp() {
  const [pet, setPet] = useState<PetInfo | null>(null);
  const sessionsRef = useRef<SessionLike[]>([]);
  const [status, setStatus] = useState<PetStatus>({ phase: 'idle', label: '' });

  // Receive the active pet (spritesheet as a data URL) on boot.
  useEffect(() => {
    return window.pet.onPetReady((info) => setPet(info));
  }, []);

  // Subscribe to sessions (push) + poll on a timer (pull backstop). The
  // 'done'/'waiting' windows also expire on the timer without a new event.
  useEffect(() => {
    const recompute = (sessions: SessionLike[]): void => {
      sessionsRef.current = sessions;
      setStatus(aggregateStatus(sessions));
    };
    const unsub = window.pet.onSessionsUpdate((sessions) => recompute(sessions as SessionLike[]));
    const iv = setInterval(() => {
      void window.pet.getSessions().then((s) => recompute(s as SessionLike[]));
    }, 500);
    return () => {
      unsub();
      clearInterval(iv);
    };
  }, []);

  if (!pet) return null;
  return (
    <PetCanvas
      spritesheetDataUrl={pet.spritesheetDataUrl}
      status={status}
      onDoubleClick={() => window.pet.showMenu()}
    />
  );
}

createRoot(document.getElementById('root')!).render(<PetApp />);
