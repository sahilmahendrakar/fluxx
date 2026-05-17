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
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const githubUpdatesOwner = 'sahilmahendrakar';
const githubUpdatesRepo = 'fluxx-web';
const appleAppSpecificPassword =
  process.env.APPLE_APP_SPECIFIC_PASSWORD || process.env.APPLE_PASSWORD;
const shouldSignAndNotarize = Boolean(
  process.env.APPLE_ID && appleAppSpecificPassword && process.env.APPLE_TEAM_ID,
);

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

/** DMG window matches background size (658×498). Icon coords are Finder layout units (tweak x/y after each build). */
const dmgContents = (opts: { appPath: string }) => [
  { x: 420, y: 260, type: 'link' as const, path: '/Applications' },
  { x: 230, y: 260, type: 'file' as const, path: opts.appPath },
];

/**
 * Keep the packaged app lean: only Vite output and `package.json` enter the
 * asar; devDependencies and the repo `node_modules` tree are omitted.
 */
function packagerIgnore(file: string): boolean {
  if (!file) return false;
  if (file === '/package.json') return false;
  if (file.startsWith('/.vite')) return false;
  return true;
}

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    // Left `false` so Forge does not run pnpm-prune on the staged tree; Vite
    // bundles JS for main/renderer and native deps use `asarUnpack` below.
    prune: false,
    // Unpack `.node` bindings from the asar so `node-pty` and similar native
    // modules load at runtime — see `AutoUnpackNativesPlugin` below.
    asarUnpack: ['**/*.node'],
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
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
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
