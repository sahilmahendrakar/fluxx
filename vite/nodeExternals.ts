import { builtinModules } from 'node:module';

/** Node + Electron builtins externalized for main/preload Vite builds (matches @electron-forge/plugin-vite). */
export const viteNodeExternals = [
  'electron',
  'electron/common',
  ...builtinModules.flatMap((m) => [m, `node:${m}`]),
];

export const viteMainExternals = [...viteNodeExternals, 'electron/main', 'node-pty'];

export const vitePreloadExternals = [...viteNodeExternals, 'electron/renderer'];
