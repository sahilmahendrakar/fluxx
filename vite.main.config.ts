import { copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv, type Plugin } from 'vite';

const repoRoot = path.dirname(fileURLToPath(import.meta.url));

function copyAppIconPngToMainOut(): Plugin {
  return {
    name: 'copy-app-icon-png',
    writeBundle(outputOptions) {
      const outDir = outputOptions.dir ?? path.join(repoRoot, '.vite/build');
      const src = path.join(repoRoot, 'assets', 'app-icon.png');
      if (!existsSync(src)) return;
      copyFileSync(src, path.join(outDir, 'app-icon.png'));
    },
  };
}

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
    plugins: [copyAppIconPngToMainOut()],
    resolve: {
      conditions: ['node'],
      mainFields: ['module', 'main'],
      alias: {
        // Some @xterm/headless releases pointed `module` at a missing `lib/xterm.mjs`;
        // force the known-good CJS headless build for the main bundle.
        '@xterm/headless': '@xterm/headless/lib-headless/xterm-headless.js',
      },
    },
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
