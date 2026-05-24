import { copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { processEnvDefine } from './vite/inlineViteEnv';
import { viteMainExternals } from './vite/nodeExternals';

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
      lib: {
        entry: path.join(repoRoot, 'src/main.ts'),
        formats: ['cjs'],
        fileName: () => 'main.js',
      },
      outDir: path.join(repoRoot, '.vite/build'),
      emptyOutDir: false,
      copyPublicDir: false,
      rollupOptions: {
        external: viteMainExternals,
      },
    },
    define: {
      ...processEnvDefine(mode, [
        'VITE_GOOGLE_DESKTOP_CLIENT_ID',
        'VITE_GOOGLE_DESKTOP_CLIENT_SECRET',
        'RESEND_API_KEY',
        'RESEND_FROM_DOMAIN',
        'RESEND_FROM_NAME',
        'FLUXX_APP_URL',
        'FLUX_APP_URL',
      ]),
      MAIN_WINDOW_VITE_DEV_SERVER_URL: undefined,
      MAIN_WINDOW_VITE_NAME: JSON.stringify('main_window'),
    },
  };
});
