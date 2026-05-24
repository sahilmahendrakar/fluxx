import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { vitePreloadExternals } from './vite/nodeExternals';

const repoRoot = path.dirname(fileURLToPath(import.meta.url));

// https://vitejs.dev/config
export default defineConfig({
  build: {
    copyPublicDir: false,
    outDir: path.join(repoRoot, '.vite/build'),
    emptyOutDir: false,
    rollupOptions: {
      external: vitePreloadExternals,
      input: path.join(repoRoot, 'src/preload.ts'),
      output: {
        format: 'cjs',
        inlineDynamicImports: true,
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name].[ext]',
      },
    },
  },
});
