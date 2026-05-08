import type { ForgeConfig, ForgePackagerOptions } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const dmgBackground = path.resolve(__dirname, 'assets', 'dmg_background3.png');
const dmgIcon = path.resolve(__dirname, 'assets', 'app-icon.icns');

/** DMG window matches background size (658×498). Icon coords are Finder layout units (tweak x/y after each build). */
const dmgContents = (opts: { appPath: string }) => [
  { x: 420, y: 260, type: 'link' as const, path: '/Applications' },
  { x: 230, y: 260, type: 'file' as const, path: opts.appPath },
];

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    asarUnpack: ['**/*.node', '**/node_modules/node-pty/**'],
    // Base path without extension; electron-packager picks .icns / .ico / .png per OS.
    icon: path.resolve(__dirname, 'assets', 'app-icon'),
    osxSign: {},
    osxNotarize: {
      appleId: process.env.APPLE_ID,
      appleIdPassword: process.env.APPLE_PASSWORD,
      teamId: process.env.APPLE_TEAM_ID,
    },
  } as ForgePackagerOptions,
  rebuildConfig: {},
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
          // outlives the Electron main process. See 0001-session-daemon.md.
          entry: 'src/daemon/daemon.ts',
          config: 'vite.daemon.config.ts',
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
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      // Enabled so main can spawn the Flux daemon by re-invoking the
      // Electron binary with ELECTRON_RUN_AS_NODE=1. See 0001-session-daemon.md.
      [FuseV1Options.RunAsNode]: true,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
