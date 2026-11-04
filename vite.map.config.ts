import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The public map: its own page and design language (pixel art), built to dist/map as a static site.
// Relative paths, so it runs under /map on the local server and at the root of any static host.
export default defineConfig({
  root: 'src/map',
  base: './',
  plugins: [react()],
  build: { outDir: '../../dist/map', emptyOutDir: true, chunkSizeWarningLimit: 900 },
  server: { port: 5174, proxy: { '/data.json': { target: 'http://127.0.0.1:4310', rewrite: () => '/map/data.json' } } },
});
