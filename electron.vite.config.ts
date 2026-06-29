import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // ---- main process (Node): HTTP server, poller, ingest, sound engine ----
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src'),
      },
    },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'electron/main/index.ts') },
      },
    },
  },
  // ---- preload (sandboxed bridge, must be CJS) ----
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'electron/preload/index.ts') },
      },
    },
  },
  // ---- renderer (React config UI) ----
  renderer: {
    root: 'renderer',
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src'),
        '@renderer': resolve(__dirname, 'renderer/src'),
      },
    },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'renderer/index.html') },
      },
    },
    plugins: [react()],
  },
});
