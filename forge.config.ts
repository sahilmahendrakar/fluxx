import type { ForgeConfig, ForgePackagerOptions } from '@electron-forge/shared-types';
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
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  darwinDmgBasename,
  postMakeWriteLatestMacYml,
} from './src/build/macReleaseArtifacts';
import { assertPackagedFluxCliContract } from './src/main/packagedFluxCliContract';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const githubUpdatesOwner = 'sahilmahendrakar';
const githubUpdatesRepo = 'fluxx';
const appleAppSpecificPassword =
  process.env.APPLE_APP_SPECIFIC_PASSWORD || process.env.APPLE_PASSWORD;
const shouldSignAndNotarize = Boolean(
  process.env.APPLE_ID && appleAppSpecificPassword && process.env.APPLE_TEAM_ID,
);

const dmgBackground = path.resolve(__dirname, 'assets', 'dmg_background3.png');
const dmgIcon = path.resolve(__dirname, 'assets', 'app-icon.icns');

/** DMG window matches background size (658×498). Icon coords are Finder layout units (tweak x/y after each build). */
const dmgContents = (opts: { appPath: string }) => [
  { x: 420, y: 260, type: 'link' as const, path: '/Applications' },
  { x: 230, y: 260, type: 'file' as const, path: opts.appPath },
];

export const packagedFluxCliFuseOptions = {
  version: FuseVersion.V1,
  [FuseV1Options.RunAsNode]: true,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
} as const;

/**
 * Keep the packaged app lean: only Vite output and `package.json` enter the
 * asar; devDependencies and most of the repo `node_modules` tree are omitted.
 * `node-pty` stays external to the Vite bundle because it ships a native
 * addon, so its runtime package must still be copied into the app.
 */
function packagerIgnore(file: string): boolean {
  if (!file) return false;
  if (file === '/package.json') return false;
  if (file.startsWith('/.vite')) return false;
  if (file === '/node_modules') return false;
  if (file.startsWith('/node_modules/node-pty')) return false;
  // node-pty's binding.gyp requires node-addon-api at electron-packager rebuild time (x64 cross-build).
  if (file.startsWith('/node_modules/node-addon-api')) return false;
  return true;
}

/** Stage `fluxx-cli.js` + `fluxx` shim (and legacy `flux` alias) for planning PTYs in packaged builds. */
async function stageFluxCliResources(buildPath: string): Promise<void> {
  const resourcesDir = path.resolve(buildPath, '..');
  const cliDir = path.join(resourcesDir, 'fluxx-cli');
  await fsp.mkdir(cliDir, { recursive: true });

  const cliSrc = path.join(__dirname, '.vite', 'build', 'fluxx-cli.js');
  const legacyCliSrc = path.join(__dirname, '.vite', 'build', 'flux-cli.js');
  const bundleSrc = fs.existsSync(cliSrc) ? cliSrc : legacyCliSrc;
  if (!fs.existsSync(bundleSrc)) {
    throw new Error(
      `[forge.config] expected fluxx-cli bundle at ${cliSrc}; Vite must build it before packageAfterCopy runs`,
    );
  }
  await fsp.cp(bundleSrc, path.join(cliDir, 'fluxx-cli.js'));
  await fsp.cp(bundleSrc, path.join(cliDir, 'flux-cli.js'));
  const cliMapSrc = `${bundleSrc}.map`;
  if (fs.existsSync(cliMapSrc)) {
    await fsp.cp(cliMapSrc, path.join(cliDir, 'fluxx-cli.js.map'));
    await fsp.cp(cliMapSrc, path.join(cliDir, 'flux-cli.js.map'));
  }

  for (const name of ['fluxx-tmux-spawn.cjs', 'fluxx-tmux-spawn.sh'] as const) {
    const src = path.resolve(__dirname, 'scripts', name);
    if (!fs.existsSync(src)) {
      throw new Error(`[forge.config] expected tmux spawn launcher at ${src}`);
    }
    const dst = path.join(cliDir, name);
    await fsp.cp(src, dst);
    if (name.endsWith('.sh')) {
      await fsp.chmod(dst, 0o755);
    }
  }

  const tmuxConfSrc = path.resolve(__dirname, 'resources', 'fluxx-tmux.conf');
  if (!fs.existsSync(tmuxConfSrc)) {
    throw new Error(`[forge.config] expected fluxx tmux config at ${tmuxConfSrc}`);
  }
  await fsp.cp(tmuxConfSrc, path.join(cliDir, 'fluxx-tmux.conf'));

  const validationPacksSrc = path.resolve(__dirname, 'validation-packs');
  if (!fs.existsSync(validationPacksSrc)) {
    throw new Error(`[forge.config] expected validation packs at ${validationPacksSrc}`);
  }
  await fsp.cp(validationPacksSrc, path.join(cliDir, 'validation-packs'), { recursive: true });

  for (const [shimName, dstName] of [
    ['fluxx-shim', 'fluxx'],
    ['flux-shim', 'flux'],
  ] as const) {
    const shimSrc = path.resolve(__dirname, 'scripts', shimName);
    if (!fs.existsSync(shimSrc)) {
      throw new Error(`[forge.config] expected ${dstName} shim at ${shimSrc}`);
    }
    const shimDst = path.join(cliDir, dstName);
    await fsp.cp(shimSrc, shimDst);
    await fsp.chmod(shimDst, 0o755);
  }

  const fluxxShim = await fsp.readFile(path.join(cliDir, 'fluxx'), 'utf8');
  const fluxShim = await fsp.readFile(path.join(cliDir, 'flux'), 'utf8');
  if (
    !fluxxShim.includes('FLUXX_ELECTRON_EXE') ||
    !fluxxShim.includes('FLUX_ELECTRON_EXE') ||
    !fluxxShim.includes('ELECTRON_RUN_AS_NODE=1')
  ) {
    throw new Error(
      '[forge.config] packaged fluxx shim must run the bundled CLI through Electron RunAsNode',
    );
  }
  if (!fluxShim.includes('exec "$DIR/fluxx" "$@"')) {
    throw new Error('[forge.config] packaged legacy flux shim must delegate to fluxx');
  }
}
const config: ForgeConfig = {
  packagerConfig: {
    protocols: [
      {
        name: 'Fluxx',
        schemes: ['fluxx'],
      },
    ],
    asar: {
      unpack: '**/node_modules/node-pty/build/Release/**',
    },
    // Left `false` so Forge does not run pnpm-prune on the staged tree; Vite
    // bundles JS for main/renderer and native deps use the asar unpack rule above.
    prune: false,
    ignore: packagerIgnore,
    // Base path without extension; electron-packager picks .icns / .ico / .png per OS.
    icon: path.resolve(__dirname, 'assets', 'app-icon'),
    ...(shouldSignAndNotarize
      ? {
          osxSign: {},
          osxNotarize: {
            appleId: process.env.APPLE_ID,
            appleIdPassword: appleAppSpecificPassword,
            teamId: process.env.APPLE_TEAM_ID,
          },
        }
      : {}),
  } as ForgePackagerOptions,
  rebuildConfig: {},
  hooks: {
    packageAfterCopy: async (_forgeConfig, buildPath) => {
      assertPackagedFluxCliContract({
        runAsNodeFuseEnabled: packagedFluxCliFuseOptions[FuseV1Options.RunAsNode],
      });
      await stageFluxCliResources(buildPath);
    },
    postMake: async (_forgeConfig, makeResults) =>
      postMakeWriteLatestMacYml(makeResults),
  },
  makers: [
    new MakerSquirrel({}),
    new MakerZIP({}, ['darwin']),
    new MakerDMG(
      (targetArch) => ({
        // Stable per-arch basenames (no version): Fluxx-arm64.dmg, Fluxx-x64.dmg
        name: darwinDmgBasename(targetArch),
        // electron-installer-dmg resolves relative paths against process.cwd(); Forge often
        // runs makers from out/, so use absolute paths or the background silently won't apply.
        // appdmg: if `<basename>@2x.png` sits next to the background PNG, it runs tiffutil → TIFF;
        // some Finder builds show a white window. Keep hires art as `*.hires.png`, not `@2x`.
        icon: dmgIcon,
        background: dmgBackground,
        format: 'ULFO',
        contents: dmgContents,
      }),
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
    new AutoUnpackNativesPlugin({}),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin(packagedFluxCliFuseOptions),
  ],
  publishers: [
    new PublisherGithub({
      repository: { owner: githubUpdatesOwner, name: githubUpdatesRepo },
      draft: false,
      prerelease: false,
    }),
  ],
};

export default config;
