import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('./dashboard-client', import.meta.url)),
  publicDir: false,
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  define: { 'process.env.NEXT_PUBLIC_LOCAL_DOMAIN_MOCK': '"false"' },
  worker: { format: 'es' },
  plugins: [
    react(),
    {
      name: 'browser-only-dashboard',
      resolveId(id) {
        if (/^(?:next\/|cloudflare:|node:|vinext)/.test(id))
          throw new Error(`Server dependency in static dashboard: ${id}`);
        return null;
      },
    },
  ],
  build: {
    outDir: '../dist/dashboard',
    emptyOutDir: true,
    assetsDir: '_app/assets',
    manifest: true,
  },
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true,
    proxy: Object.fromEntries(
      [
        '/api',
        '/signin-with-chatgpt',
        '/signout-with-chatgpt',
        '/assets',
        '/fonts',
        '/favicon.svg',
      ].map((path) => [path, { target: 'http://127.0.0.1:5173', changeOrigin: false }]),
    ),
  },
});
