import { defineConfig } from 'vite';

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(process.env.APP_VERSION || 'dev') },
  // host: true exposes the dev server on the LAN so a phone on the same Wi-Fi can load it.
  server: { host: true, port: 5173 },
  preview: { host: true },
});
