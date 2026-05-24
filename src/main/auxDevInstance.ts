/**
 * Secondary Electron dev instance (`pnpm run start:aux`). Uses a separate
 * user-data dir and Vite port; must not share the primary instance's tmux
 * server or reconcile its persisted tmux rows.
 */
export function isAuxDevInstance(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.FLUX_AUX_DEV_SERVER_PORT?.trim();
  if (!raw) return false;
  const port = Number(raw);
  return Number.isFinite(port) && port > 0;
}
