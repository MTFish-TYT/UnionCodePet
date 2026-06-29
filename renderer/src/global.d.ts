// Renderer-side global types.
// `window.ucp` is exposed by the preload via contextBridge. We re-declare the
// shape here (in renderer-local terms) rather than importing from the preload,
// because the preload is a CJS/node-context module excluded from this tsconfig.
import type { UcpApi } from './ipc';

declare global {
  interface Window {
    ucp: UcpApi;
  }
}
