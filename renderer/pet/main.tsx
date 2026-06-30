// Pet window entry. Subscribes to the active pet info + live sessions, then
// renders the animated pet with a status bubble. The window itself is
// transparent/frameless (main), so this just fills 192×208 with the canvas.
//
// Two status sources are merged here:
//  - CLI sessions → aggregateStatus (waiting/error/working/done/idle)
//  - Pomodoro timer phase → layered bubble text + animation override when idle
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import PetCanvas from './PetCanvas';
import type { PetStatus, SessionLike, PomodoroPetStatus, PomodoroPhase } from './state-map';
import { aggregateStatus, mergeWithPomodoro, pomodoroPhaseToPetState } from './state-map';
import type { PetState } from './animation-rows';

interface PetInfo {
  spritesheetDataUrl: string;
  displayName: string;
}

function PetApp() {
  const [pet, setPet] = useState<PetInfo | null>(null);
  const sessionsRef = useRef<SessionLike[]>([]);
  const [status, setStatus] = useState<PetStatus>({ phase: 'idle', label: '' });
  const [pomodoroOverride, setPomodoroOverride] = useState<PetState | null>(null);
  const pomodoroRef = useRef<PomodoroPetStatus | null>(null);
  // A one-shot reaction token: bumping it makes PetCanvas play a buster anim.
  const [reaction, setReaction] = useState<{ kind: 'cheer' | 'wave'; n: number } | null>(null);

  // Receive the active pet (spritesheet as a data URL) on boot.
  useEffect(() => {
    return window.pet.onPetReady((info) => setPet(info));
  }, []);

  // Subscribe to sessions (push) + poll on a timer (pull backstop). The
  // 'done'/'waiting' windows also expire on the timer without a new event.
  useEffect(() => {
    const recompute = (sessions: SessionLike[]): void => {
      sessionsRef.current = sessions;
      const cli = aggregateStatus(sessions);
      setStatus(mergeWithPomodoro(cli, pomodoroRef.current));
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

  // Subscribe to pomodoro phase + one-shot reactions.
  useEffect(() => {
    const unsubPhase = window.pet.onPomodoroPhase((phase) => {
      const p = phase as PomodoroPhase;
      // Keep a lightweight status for the bubble (no live countdown here; the
      // bubble shows phase only — the exact time lives in the timer window).
      const ps: PomodoroPetStatus | null =
        p === 'idle' ? null : { phase: p, remainingMs: 0, focusCountInSet: 1, cyclesPerSet: 4 };
      pomodoroRef.current = ps;
      // Override the animation only when the CLI isn't mid-task. PetCanvas
      // respects the override when its base state would be 'idle'.
      setPomodoroOverride(pomodoroPhaseToPetState(p));
      // Recompute the merged bubble with the new pomodoro slice.
      const cli = aggregateStatus(sessionsRef.current);
      setStatus(mergeWithPomodoro(cli, ps));
    });
    const unsubReaction = window.pet.onPetReaction((r) => {
      if (r === 'cheer' || r === 'wave') {
        setReaction((prev) => ({ kind: r, n: (prev?.n ?? 0) + 1 }));
      }
    });
    return () => {
      unsubPhase();
      unsubReaction();
    };
  }, []);

  if (!pet) return null;
  return (
    <PetCanvas
      spritesheetDataUrl={pet.spritesheetDataUrl}
      status={status}
      pomodoroOverride={pomodoroOverride}
      reaction={reaction}
      onDoubleClick={() => window.pet.showMenu()}
    />
  );
}

createRoot(document.getElementById('root')!).render(<PetApp />);

