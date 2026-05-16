/**
 * Single source of truth for the Flux daemon's external runtime modules.
 *
 * The daemon (src/daemon/daemon.ts) is bundled by Vite into
 * `.vite/build/daemon.js`. A few modules are deliberately left external
 * because:
 *   - `node-pty` ships a native `.node` binding plus a `spawn-helper`
 *     Mach-O binary that posix_spawnp must be able to execute — neither
 *     survives bundling.
 *   - `@xterm/headless` has internal dynamic resolution we don't want to
 *     re-implement and its 6.0.0 `module` field points to a non-existent
 *     `lib/xterm.mjs`; bundling it has historically broken silently.
 *   - `@xterm/addon-serialize` is a peer of `@xterm/headless` and stays
 *     paired with it.
 *
 * Three consumers must agree on this list, hence the single manifest:
 *
 *   1. `vite.daemon.config.ts` — Rollup `external` for the daemon bundle.
 *   2. `forge.config.ts` `packageAfterCopy` hook — copies each module's
 *      `node_modules/<name>` tree into `Contents/Resources/daemon/`
 *      alongside the bundled `daemon.js`, OUTSIDE `app.asar`. The daemon
 *      then resolves these modules via plain Node resolution from a real
 *      `node_modules` directory on disk.
 *   3. `forge.config.ts` `packagerIgnore` — no longer needs a per-module
 *      allowlist (the daemon's deps live outside the asar entirely), so
 *      it ignores everything except `.vite/` and `package.json`.
 *
 * Mirrors Superset's `apps/desktop/runtime-dependencies.ts`. See
 * `docs/daemon-packaging.md` for the why + the migration roadmap toward
 * fd-handoff for daemon-binary upgrades.
 */

export interface DaemonRuntimeModule {
  /** npm specifier; matches what Vite externalizes and what the daemon requires at runtime. */
  specifier: string;
  /** Source path under the repo root. Forge copies from here. */
  copyFrom: string;
  /** Destination path inside `Contents/Resources/daemon/`. Should be `node_modules/<specifier>`. */
  copyTo: string;
  /** Documentation flag — true means there is a `.node` binding or companion binary to preserve. */
  hasNativeArtifacts: boolean;
}

export const daemonRuntimeModules: readonly DaemonRuntimeModule[] = [
  {
    specifier: 'node-pty',
    copyFrom: 'node_modules/node-pty',
    copyTo: 'node_modules/node-pty',
    // node-pty/build/Release/pty.node + spawn-helper companion binary on macOS.
    // The spawn-helper was the proximate cause of "sessions don't start" in
    // pre-Phase-A packaged builds — see docs/daemon-packaging.md section 2.
    hasNativeArtifacts: true,
  },
  {
    specifier: '@xterm/headless',
    copyFrom: 'node_modules/@xterm/headless',
    copyTo: 'node_modules/@xterm/headless',
    hasNativeArtifacts: false,
  },
  {
    specifier: '@xterm/addon-serialize',
    copyFrom: 'node_modules/@xterm/addon-serialize',
    copyTo: 'node_modules/@xterm/addon-serialize',
    hasNativeArtifacts: false,
  },
];

export const daemonExternals: readonly string[] = daemonRuntimeModules.map(
  (m) => m.specifier,
);
