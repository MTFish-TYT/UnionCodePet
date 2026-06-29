// Renderer-side wrapper around the preload bridge (`window.ucp`).
// Provides typed access so components don't touch the global directly.
import type { RuntimeConfig } from '@shared/config';

export interface UcpApi {
  getConfig: () => Promise<RuntimeConfig>;
  saveConfig: (cfg: RuntimeConfig) => Promise<RuntimeConfig>;
  resetConfig: () => Promise<RuntimeConfig>;
  previewSound: (path: string) => Promise<boolean>;
  browseSoundFile: () => Promise<string | null>;
  onSessionsUpdate: (cb: (sessions: SessionSnapshot[]) => void) => () => void;
}

// Session shape pushed from main (mirrors src/session-state SessionState, but
// kept loose here to avoid pulling node-typed modules into the renderer).
export interface SessionSnapshot {
  source: 'claude' | 'zcode' | 'codex';
  sessionId: string;
  phase: 'idle' | 'working' | 'waiting' | 'done' | 'error';
  lastSummary?: string;
  lastEventKind?: string;
  lastToolName?: string;
  cwd?: string;
  updatedAt: number;
}

export const ucp: UcpApi = window.ucp;
