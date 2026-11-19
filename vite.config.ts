import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { brandTileSvg } from './src/shared/brand.js';
export default defineConfig({
  root: 'web',
  plugins: [
    react(),
    {
      name: 'rheo-brand-assets',
      configureServer(server) {
        server.middlewares.use('/rheo.svg', (_request, response) => {
          response.setHeader('Content-Type', 'image/svg+xml');
          response.end(brandTileSvg());
        });
      },
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'rheo.svg', source: brandTileSvg() });
      },
    },
  ],
  build: { outDir: '../dist/public', emptyOutDir: false },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': { target: 'http://127.0.0.1:4310', changeOrigin: true, rewrite: (p) => p } },
  },
});
