import { chmodSync, copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const repoRoot = path.dirname(fileURLToPath(import.meta.url));

function copyFluxShim(): Plugin {
  return {
    name: 'copy-flux-shim',
    writeBundle(outputOptions) {
      const outDir = outputOptions.dir ?? path.join(repoRoot, '.vite/build');
      const shimSrc = path.join(repoRoot, 'scripts', 'flux-shim');
      const shimDst = path.join(outDir, 'flux');
      if (!existsSync(shimSrc)) return;
      copyFileSync(shimSrc, shimDst);
      try {
        chmodSync(shimDst, 0o755);
      } catch {
        // ignore chmod failures on Windows
      }
    },
  };
}

export default defineConfig({
  plugins: [copyFluxShim()],
  build: {
    lib: {
      entry: path.join(repoRoot, 'src/flux-cli/main.ts'),
      formats: ['cjs'],
      fileName: () => 'flux-cli.js',
    },
    outDir: path.join(repoRoot, '.vite/build'),
    emptyOutDir: false,
    rollupOptions: {
      external: [],
    },
  },
});
