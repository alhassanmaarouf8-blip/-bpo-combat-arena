import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
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
    __WS_URL__: JSON.stringify(process.env.VITE_WS_URL ?? 'ws://localhost:3001'),
  },
});
