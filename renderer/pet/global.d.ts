// Pet window global types. `window.pet` is exposed by pet-preload.mjs.
// We re-declare the shape here (renderer-local) rather than importing from the
// preload, since electron/ is excluded from this tsconfig.

interface PetInfo {
  spritesheetDataUrl: string;
  displayName: string;
}

export interface PetApi {
  onPetReady: (cb: (info: PetInfo) => void) => () => void;
  onSessionsUpdate: (cb: (sessions: unknown[]) => void) => () => void;
  getSessions: () => Promise<unknown[]>;
  toggleClickThrough: () => void;
  hidePet: () => void;
  openConfig: () => void;
  quitApp: () => void;
  showMenu: () => void;
}

declare global {
  interface Window {
    pet: PetApi;
  }
}
