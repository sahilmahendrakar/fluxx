import type {
  ForgeConfig,
  ForgeMakeResult,
  ForgePackagerOptions,
} from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { PublisherGithub } from '@electron-forge/publisher-github';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { daemonRuntimeModules } from './runtime-dependencies';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const githubUpdatesOwner = 'sahilmahendrakar';
const githubUpdatesRepo = 'flux-web';

/** Zips produced by `@electron-forge/maker-zip` for Darwin (electron-updater needs these + `latest-mac.yml`). */
function isDarwinMakerZipArtifact(artifactPath: string): boolean {
  const n = artifactPath.split(path.sep).join('/');
  return n.endsWith('.zip') && n.includes('/zip/darwin/');
}

async function summarizeZipForUpdaterMacYaml(zipPath: string): Promise<{
  basename: string;
  sha512: string;
  size: number;
}> {
  const buf = await fsp.readFile(zipPath);
  const sha512 = createHash('sha512').update(buf).digest('base64');
  const stat = await fsp.stat(zipPath);
  return { basename: path.basename(zipPath), sha512, size: stat.size };
}

/**
 * `electron-updater` GitHub provider reads `latest-mac.yml` from the **latest** release assets (see
 * electron-updater `GitHubProvider`). Forge’s zip maker doesn’t emit it, so we add it next to the
 * Darwin zip(s) before publish uploads them.
 */
async function postMakeWriteLatestMacYml(
  makeResults: ForgeMakeResult[],
): Promise<ForgeMakeResult[]> {
  const darwinZips = Array.from(
    new Set(
      makeResults.flatMap((r) =>
        r.platform === 'darwin'
          ? r.artifacts.filter(isDarwinMakerZipArtifact)
          : [],
      ),
    ),
  );
  if (darwinZips.length === 0) {
    return makeResults;
  }

  const withVersion = makeResults.find(
    (r) =>
      typeof (r.packageJSON as { version?: unknown } | undefined)?.version ===
      'string',
  );
  const version =
    (withVersion?.packageJSON as { version?: string } | undefined)?.version;
  if (!version) return makeResults;

  const summaries = [];
  for (const z of darwinZips.sort((a, b) => path.basename(a).localeCompare(path.basename(b)))) {
    summaries.push(await summarizeZipForUpdaterMacYaml(z));
  }
  const primary =
    summaries.find((s) => s.basename.includes('arm64')) ?? summaries[0];
  const releaseDate = new Date().toISOString();

  let filesYaml = '';
  for (const s of summaries) {
    filesYaml += `  - url: ${s.basename}\n    sha512: ${s.sha512}\n    size: ${s.size}\n`;
  }

  const ymlBody =
    `version: ${version}\n` +
    `files:\n` +
    `${filesYaml}` +
    `path: ${primary.basename}\n` +
    `sha512: ${primary.sha512}\n` +
    `releaseDate: '${releaseDate}'\n`;

  const ymlPath = path.join(path.dirname(darwinZips[0]), 'latest-mac.yml');
  await fsp.writeFile(ymlPath, ymlBody, 'utf8');

  const attachTo = makeResults.find(
    (r) =>
      r.platform === 'darwin' && r.artifacts.some(isDarwinMakerZipArtifact),
  );
  if (attachTo && !attachTo.artifacts.includes(ymlPath)) {
    attachTo.artifacts.push(ymlPath);
  }

  return makeResults;
}

const dmgBackground = path.resolve(__dirname, 'assets', 'dmg_background3.png');
const dmgIcon = path.resolve(__dirname, 'assets', 'app-icon.icns');

function githubAppUpdateYml(): string {
  return [
    'provider: github',
    `owner: ${githubUpdatesOwner}`,
    `repo: ${githubUpdatesRepo}`,
    'updaterCacheDirName: flux-updater',
    '',
  ].join('\n');
}

/** DMG window matches background size (658×498). Icon coords are Finder layout units (tweak x/y after each build). */
const dmgContents = (opts: { appPath: string }) => [
  { x: 420, y: 260, type: 'link' as const, path: '/Applications' },
  { x: 230, y: 260, type: 'file' as const, path: opts.appPath },
];

/**
 * Phase A keeps the daemon and its external modules OUTSIDE `app.asar`
 * (`packageAfterCopy` stages them into `Resources/daemon/`), so the only
 * things the asar needs from the source tree are the Vite bundles and
 * `package.json`. Everything else (node_modules in particular) stays out.
 * See runtime-dependencies.ts and docs/daemon-packaging.md.
 */
function packagerIgnore(file: string): boolean {
  if (!file) return false;
  if (file === '/package.json') return false;
  if (file.startsWith('/.vite')) return false;
  return true;
}

/**
 * Stage `daemon.js` + every module declared in `runtime-dependencies.ts`
 * into `Contents/Resources/daemon/` (macOS) / `resources/daemon/` (Linux/Win),
 * outside `app.asar`. `DaemonClient.resolveDaemonScriptPath()` reads from
 * `process.resourcesPath + '/daemon/daemon.js'` in packaged builds.
 *
 * Runs after Forge copies the app into staging and BEFORE asar packing, so
 * the staged tree at `buildPath/../daemon/` survives as a sibling of
 * `app.asar` in the final bundle.
 */
async function stageDaemonResources(buildPath: string): Promise<void> {
  const resourcesDir = path.resolve(buildPath, '..');
  const daemonDir = path.join(resourcesDir, 'daemon');
  await fsp.mkdir(daemonDir, { recursive: true });
  await fsp.writeFile(
    path.join(resourcesDir, 'app-update.yml'),
    githubAppUpdateYml(),
    'utf8',
  );

  const daemonSrc = path.join(__dirname, '.vite', 'build', 'daemon.js');
  if (!fs.existsSync(daemonSrc)) {
    throw new Error(
      `[forge.config] expected daemon bundle at ${daemonSrc}; Vite must build it before packageAfterCopy runs`,
    );
  }
  await fsp.cp(daemonSrc, path.join(daemonDir, 'daemon.js'));
  const daemonMapSrc = `${daemonSrc}.map`;
  if (fs.existsSync(daemonMapSrc)) {
    await fsp.cp(daemonMapSrc, path.join(daemonDir, 'daemon.js.map'));
  }

  for (const mod of daemonRuntimeModules) {
    const src = path.join(__dirname, mod.copyFrom);
    if (!fs.existsSync(src)) {
      throw new Error(
        `[forge.config] expected module source at ${src} for daemon runtime dep ${mod.specifier}`,
      );
    }
    const dst = path.join(daemonDir, mod.copyTo);
    await fsp.mkdir(path.dirname(dst), { recursive: true });
    // `dereference: true` is important for pnpm: while this repo currently
    // uses a flat (non-symlinked) node_modules, the option keeps the copy
    // working if pnpm's layout changes later.
    await fsp.cp(src, dst, { recursive: true, dereference: true });
  }
}

/** Stage `flux-cli.js` + `flux` shim for planning PTYs in packaged builds. */
async function stageFluxCliResources(buildPath: string): Promise<void> {
  const resourcesDir = path.resolve(buildPath, '..');
  const cliDir = path.join(resourcesDir, 'flux-cli');
  await fsp.mkdir(cliDir, { recursive: true });

  const cliSrc = path.join(__dirname, '.vite', 'build', 'flux-cli.js');
  if (!fs.existsSync(cliSrc)) {
    throw new Error(
      `[forge.config] expected flux-cli bundle at ${cliSrc}; Vite must build it before packageAfterCopy runs`,
    );
  }
  await fsp.cp(cliSrc, path.join(cliDir, 'flux-cli.js'));
  const cliMapSrc = `${cliSrc}.map`;
  if (fs.existsSync(cliMapSrc)) {
    await fsp.cp(cliMapSrc, path.join(cliDir, 'flux-cli.js.map'));
  }

  const shimSrc = path.resolve(__dirname, 'scripts', 'flux-shim');
  if (!fs.existsSync(shimSrc)) {
    throw new Error(`[forge.config] expected flux shim at ${shimSrc}`);
  }
  const shimDst = path.join(cliDir, 'flux');
  await fsp.cp(shimSrc, shimDst);
  await fsp.chmod(shimDst, 0o755);
}

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    // The daemon's native deps no longer live in the staged app, so prune
    // has nothing to do. Left as `false` to avoid invoking pnpm-prune on
    // the staged tree (the renderer + main don't need it — Vite bundles
    // their runtime deps directly).
    prune: false,
    // Defense-in-depth only: with Phase A's hook, the daemon's `.node`
    // bindings already live outside the asar in `Resources/daemon/`. This
    // glob still matters for any future renderer/main native dep that
    // accidentally lands in the asar — see `AutoUnpackNativesPlugin` below.
    asarUnpack: ['**/*.node'],
    ignore: packagerIgnore,
    // Base path without extension; electron-packager picks .icns / .ico / .png per OS.
    icon: path.resolve(__dirname, 'assets', 'app-icon'),
    ...(process.env.APPLE_ID
      ? {
          osxSign: {},
          osxNotarize: {
            appleId: process.env.APPLE_ID,
            appleIdPassword: process.env.APPLE_PASSWORD,
            teamId: process.env.APPLE_TEAM_ID,
          },
        }
      : {}),
  } as ForgePackagerOptions,
  rebuildConfig: {},
  hooks: {
    packageAfterCopy: async (
      _forgeConfig,
      buildPath,
      _electronVersion,
      _platform,
      _arch,
    ) => {
      // `buildPath` is the staged app source dir (e.g. `Flux.app/Contents/Resources/app`).
      // We need to place files at its sibling `Resources/daemon/`, which is outside the
      // soon-to-be-built `app.asar`.
      await stageDaemonResources(buildPath);
      await stageFluxCliResources(buildPath);
    },
    postMake: async (_forgeConfig, makeResults) =>
      postMakeWriteLatestMacYml(makeResults),
  },
  makers: [
    new MakerSquirrel({}),
    new MakerZIP({}, ['darwin']),
    new MakerDMG(
      {
        // electron-installer-dmg resolves relative paths against process.cwd(); Forge often
        // runs makers from out/, so use absolute paths or the background silently won't apply.
        // appdmg: if `<basename>@2x.png` sits next to the background PNG, it runs tiffutil → TIFF;
        // some Finder builds show a white window. Keep hires art as `*.hires.png`, not `@2x`.
        icon: dmgIcon,
        background: dmgBackground,
        format: 'ULFO',
        contents: dmgContents,
      },
      ['darwin'],
    ),
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  plugins: [
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'src/main.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          // Detached PTY daemon; spawned via ELECTRON_RUN_AS_NODE=1 so it
          // outlives the Electron main process. In packaged builds the
          // daemon bundle is staged into Contents/Resources/daemon/ by the
          // packageAfterCopy hook above, outside app.asar. See
          // docs/daemon-packaging.md.
          entry: 'src/daemon/daemon.ts',
          config: 'vite.daemon.config.ts',
          target: 'main',
        },
        {
          entry: 'src/flux-cli/main.ts',
          config: 'vite.flux-cli.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
    // No-op for Phase A's daemon path (its `.node` files live outside the
    // asar already), but kept for any future main/renderer-side native dep.
    new AutoUnpackNativesPlugin({}),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      // Enabled so main can spawn the Flux daemon by re-invoking the
      // Electron binary with ELECTRON_RUN_AS_NODE=1. See docs/daemon-packaging.md.
      [FuseV1Options.RunAsNode]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
  publishers: [
    new PublisherGithub({
      repository: { owner: githubUpdatesOwner, name: githubUpdatesRepo },
    }),
  ],
};

export default config;
