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

  const BUILD_ID = (process.env.VERCEL_GIT_COMMIT_SHA || 'dev').slice(0, 7);

  return {
    plugins: [
      react(),
      {
        // Stamp the live commit into index.html as <meta name="build"> so the Vercel
        // deploy is verifiable by fetching the page (mirrors the server /health build).
        name: 'build-stamp',
        transformIndexHtml(html) {
          const withoutOwnerDebug = isProd
            ? html.replace(/\s*<!-- ON-SCREEN DEBUG RECORDER[\s\S]*?<\/script>\s*/i, '\n')
            : html;
          return withoutOwnerDebug.replace('</head>', `  <meta name="build" content="${BUILD_ID}">\n  </head>`);
        },
      },
    ],
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
      sourcemap:       !isProd,
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
      __BUILD_ID__: JSON.stringify(BUILD_ID),
    },
  };
});
