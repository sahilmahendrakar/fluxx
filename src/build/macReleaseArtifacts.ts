import type { ForgeMakeResult } from '@electron-forge/shared-types';
import { createHash } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';

/** Stable DMG basename per darwin arch (no version suffix), e.g. `Fluxx-arm64.dmg`. */
export function darwinDmgBasename(arch: string): string {
  if (arch === 'arm64') return 'Fluxx-arm64';
  if (arch === 'x64') return 'Fluxx-x64';
  return `Fluxx-${arch}`;
}

/** Zips produced by `@electron-forge/maker-zip` for Darwin (electron-updater needs these + `latest-mac.yml`). */
export function isDarwinMakerZipArtifact(artifactPath: string): boolean {
  const n = artifactPath.split(path.sep).join('/');
  return n.endsWith('.zip') && n.includes('/zip/darwin/');
}

export async function summarizeZipForUpdaterMacYaml(zipPath: string): Promise<{
  basename: string;
  sha512: string;
  size: number;
}> {
  const buf = await fsp.readFile(zipPath);
  const sha512 = createHash('sha512').update(buf).digest('base64');
  const stat = await fsp.stat(zipPath);
  return { basename: path.basename(zipPath), sha512, size: stat.size };
}

export function buildLatestMacYmlBody(opts: {
  version: string;
  summaries: Array<{ basename: string; sha512: string; size: number }>;
  releaseDate?: string;
}): string {
  const { version, summaries } = opts;
  const primary =
    summaries.find((s) => s.basename.includes('arm64')) ?? summaries[0];
  const releaseDate = opts.releaseDate ?? new Date().toISOString();

  let filesYaml = '';
  for (const s of summaries) {
    filesYaml += `  - url: ${s.basename}\n    sha512: ${s.sha512}\n    size: ${s.size}\n`;
  }

  return (
    `version: ${version}\n` +
    `files:\n` +
    `${filesYaml}` +
    `path: ${primary.basename}\n` +
    `sha512: ${primary.sha512}\n` +
    `releaseDate: '${releaseDate}'\n`
  );
}

/**
 * `electron-updater` GitHub provider reads `latest-mac.yml` from the **latest** release assets (see
 * electron-updater `GitHubProvider`). Forge’s zip maker doesn’t emit it, so we add it next to the
 * Darwin zip(s) before publish uploads them.
 */
export async function postMakeWriteLatestMacYml(
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

  const ymlBody = buildLatestMacYmlBody({ version, summaries });
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
