import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
const client = fileURLToPath(new URL('./src/offlineClient.ts', import.meta.url));
export default defineConfig({
  resolve: { dedupe: ['react', 'react-dom'] },
  plugins: [{ name: 'offline-live-client', enforce: 'pre', resolveId(source, importer) {
    if (source === './apiClient' && importer?.replaceAll('\\', '/').endsWith('/app/LiveRoom.tsx')) return client;
  } }, react()],
  define: { 'process.env.NEXT_PUBLIC_AVATAR_WIDGET_URL': 'globalThis.location.href.replace(/[^/]*$/, "widget.html")' },
  server: { fs: { allow: ['..'] } },
  build: { target: 'es2022' },
});
