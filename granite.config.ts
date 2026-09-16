import { defineConfig } from '@apps-in-toss/web-framework/config';

export default defineConfig({
  appName: 'mint',
  brand: {
    displayName: '민트',
    primaryColor: '#F2FCF8',
    icon: 'https://www.meetatmint.com/mint-launch-v2-512.png',
  },
  web: {
    host: 'localhost',
    port: 5173,
    commands: {
      dev: 'vite dev',
      build: 'vite build',
    },
  },
  permissions: [],
  outdir: 'dist',
});
