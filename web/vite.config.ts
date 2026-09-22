import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/samsung-motion-photo-converter/',
  plugins: [react()],
  resolve: { alias: { '@': import.meta.dirname } },
  server: { host: '127.0.0.1' },
});
