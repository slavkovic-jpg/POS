import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // Bind IPv4 explicitly. Left to itself Vite listens on ::1 only, so
    // anything that resolves 127.0.0.1 first — curl, browser automation, some
    // corporate proxies — hangs until it falls back, which reads as "vite is
    // slow to start". Same reason the proxy target is 127.0.0.1, not localhost.
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:5185',
    },
  },
});
