import { describe, expect, it } from 'vitest';
import {
  buildLatestMacYmlBody,
  darwinDmgBasename,
  isDarwinMakerZipArtifact,
} from './macReleaseArtifacts';

describe('darwinDmgBasename', () => {
  it('maps known darwin arches to stable Fluxx DMG basenames', () => {
    expect(darwinDmgBasename('arm64')).toBe('Fluxx-arm64');
    expect(darwinDmgBasename('x64')).toBe('Fluxx-x64');
  });

  it('falls back for unexpected arch labels', () => {
    expect(darwinDmgBasename('universal')).toBe('Fluxx-universal');
  });
});

describe('isDarwinMakerZipArtifact', () => {
  it('matches Forge zip maker darwin output paths', () => {
    expect(
      isDarwinMakerZipArtifact(
        '/repo/out/make/zip/darwin/arm64/Fluxx-darwin-arm64-1.0.0.zip',
      ),
    ).toBe(true);
    expect(isDarwinMakerZipArtifact('/repo/out/make/dmg/Fluxx-arm64.dmg')).toBe(
      false,
    );
  });
});

describe('buildLatestMacYmlBody', () => {
  it('lists all zips and keeps arm64 as primary path', () => {
    const body = buildLatestMacYmlBody({
      version: '1.2.3',
      releaseDate: '2026-05-21T00:00:00.000Z',
      summaries: [
        {
          basename: 'Fluxx-darwin-x64-1.2.3.zip',
          sha512: 'x64hash',
          size: 100,
        },
        {
          basename: 'Fluxx-darwin-arm64-1.2.3.zip',
          sha512: 'armhash',
          size: 200,
        },
      ],
    });

    expect(body).toContain('version: 1.2.3\n');
    expect(body).toContain('url: Fluxx-darwin-x64-1.2.3.zip');
    expect(body).toContain('url: Fluxx-darwin-arm64-1.2.3.zip');
    expect(body).toContain('path: Fluxx-darwin-arm64-1.2.3.zip');
    expect(body).toContain('sha512: armhash');
    expect(body).toContain("releaseDate: '2026-05-21T00:00:00.000Z'");
  });

  it('uses the only zip as primary when arm64 is absent', () => {
    const body = buildLatestMacYmlBody({
      version: '0.1.0',
      summaries: [
        {
          basename: 'Fluxx-darwin-x64-0.1.0.zip',
          sha512: 'only',
          size: 50,
        },
      ],
    });

    expect(body).toContain('path: Fluxx-darwin-x64-0.1.0.zip');
  });
});
