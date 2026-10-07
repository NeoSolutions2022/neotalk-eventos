import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'app.neotalk.offline',
  appName: 'NeoTalk Offline',
  webDir: 'dist',
  server: { hostname: 'localhost', androidScheme: 'https', iosScheme: 'capacitor' },
  // No server.url: the application must use the bundled files, never the website.
  android: { allowMixedContent: false },
};
export default config;
