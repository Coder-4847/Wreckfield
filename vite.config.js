import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the production build works from any static host path (e.g. GitHub Pages /repo/).
  base: './',
  server: { port: Number(process.env.PORT) || 5174, strictPort: false, open: false },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
  },
});
