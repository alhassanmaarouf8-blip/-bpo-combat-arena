import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Backend addresses are injected at build time.
//  - Locally (dev), they default to localhost.
//  - In a production build (what Vercel runs), they default to the LIVE Render backend,
//    so the public site works even if the env vars are not set.
//  - You can still override either one with a Vercel env var (VITE_WS_URL / VITE_API_URL)
//    if the backend ever moves.
const PROD_WS  = 'wss://bpo-combat-arena.onrender.com';
const PROD_API = 'https://bpo-combat-arena.onrender.com';

export default defineConfig(({ mode }) => {
  const isProd = mode === 'production';
  const WS_URL  = process.env.VITE_WS_URL  ?? (isProd ? PROD_WS  : 'ws://localhost:3001');
  const API_URL = process.env.VITE_API_URL ?? (isProd ? PROD_API : 'http://localhost:3001');

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/ws': {
          target:    'ws://localhost:3001',
          ws:        true,
          rewriteWsOrigin: true,
        },
      },
    },
    build: {
      outDir:          'dist',
      sourcemap:       true,
      target:          'es2020',
      rollupOptions: {
        output: {
          manualChunks: {
            react: ['react', 'react-dom'],
          },
        },
      },
    },
    define: {
      __WS_URL__:  JSON.stringify(WS_URL),
      __API_URL__: JSON.stringify(API_URL),
    },
  };
});
