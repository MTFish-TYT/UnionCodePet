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
  // Two preloads: the config window's and the pet window's.
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/preload/index.ts'),
          'pet-preload': resolve(__dirname, 'electron/preload/pet-preload.ts'),
        },
      },
    },
  },
  // ---- renderer (React config UI + pet window, two HTML entries) ----
  // root stays 'renderer' so the main window's loadURL is unchanged. The pet
  // window uses a second HTML entry (renderer/pet.html) on the same dev server,
  // loaded as <devURL>/pet.html in dev or dist/renderer/pet.html in production.
  renderer: {
    root: 'renderer',
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src'),
        '@renderer': resolve(__dirname, 'renderer/src'),
        '@pet': resolve(__dirname, 'renderer-pet/src'),
      },
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'renderer/index.html'),
          pet: resolve(__dirname, 'renderer/pet.html'),
        },
      },
    },
    plugins: [react()],
  },
});
