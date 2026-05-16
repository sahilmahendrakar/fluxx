import { defineConfig } from 'vite';
import { daemonExternals } from './runtime-dependencies';

// The daemon is a detached Node process spawned by main with
// ELECTRON_RUN_AS_NODE=1. It must not import anything from `electron`.
// `node-pty` is a native module; `@xterm/headless` + `@xterm/addon-serialize`
// stay external because @xterm/headless@6 has a packaging bug (its `module`
// field points to a missing `lib/xterm.mjs`) and we'd rather Node resolve
// the real file at runtime from `Contents/Resources/daemon/node_modules/`
// in packaged builds — see runtime-dependencies.ts and docs/daemon-packaging.md.
export default defineConfig({
  build: {
    rollupOptions: {
      external: ['electron', ...daemonExternals],
    },
  },
  resolve: {
    conditions: ['node'],
    mainFields: ['module', 'main'],
    alias: {
      // Defense in depth against @xterm/headless@6.0.0's broken `module` field
      // (`lib/xterm.mjs` does not exist on disk). `@xterm/headless` is external
      // so this only matters if a transitive caller pulls it back into the
      // graph, but matching Superset's workaround keeps the failure mode
      // closed even if that changes. The CJS entry below exists in 6.0.0.
      '@xterm/headless': '@xterm/headless/lib-headless/xterm-headless.js',
    },
  },
});
