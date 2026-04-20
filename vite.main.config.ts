import { defineConfig, loadEnv } from 'vite';

// https://vitejs.dev/config
export default defineConfig(({ mode }) => {
  // Inline selected env vars into the main-process bundle at build time.
  // Only variables read here are available to main; nothing else leaks.
  const env = loadEnv(mode, process.cwd(), '');
  const inline = (name: string): [string, string] => [
    `process.env.${name}`,
    JSON.stringify(env[name] ?? ''),
  ];
  return {
    build: {
      rollupOptions: {
        external: ['electron', 'node-pty'],
      },
    },
    define: Object.fromEntries([
      inline('VITE_GOOGLE_DESKTOP_CLIENT_ID'),
      inline('VITE_GOOGLE_DESKTOP_CLIENT_SECRET'),
      inline('RESEND_API_KEY'),
      inline('RESEND_FROM_DOMAIN'),
      inline('RESEND_FROM_NAME'),
      inline('FLUX_APP_URL'),
    ]),
  };
});
