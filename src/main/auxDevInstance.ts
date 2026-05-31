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

/**
 * Aux dev must run alongside the primary `electron-forge start` instance.
 * Skip Electron's single-instance lock so the second process is not rejected
 * when launched from a shell inside the primary app.
 */
export function shouldRequestSingleInstanceLock(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return !isAuxDevInstance(env);
}
