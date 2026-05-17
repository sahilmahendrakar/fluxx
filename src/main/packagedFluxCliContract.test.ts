import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { assertPackagedFluxCliContract } from './packagedFluxCliContract';

const execFileAsync = promisify(execFile);

async function writeExecutable(filePath: string, contents: string): Promise<void> {
  await fs.writeFile(filePath, contents, 'utf8');
  await fs.chmod(filePath, 0o755);
}

describe('packaged Flux CLI contract', () => {
  it('keeps Electron RunAsNode enabled for packaged shims', () => {
    expect(() => assertPackagedFluxCliContract({ runAsNodeFuseEnabled: true })).not.toThrow();
    expect(() =>
      assertPackagedFluxCliContract({ runAsNodeFuseEnabled: false }),
    ).toThrow(/RunAsNode fuse must stay enabled/);
  });

  it('wires the Forge package step to the RunAsNode fuse assertion', async () => {
    const forgeConfig = await fs.readFile(path.join(process.cwd(), 'forge.config.ts'), 'utf8');

    expect(forgeConfig).toMatch(/\[FuseV1Options\.RunAsNode\]: true/);
    expect(forgeConfig).toMatch(/new FusesPlugin\(packagedFluxCliFuseOptions\)/);
    expect(forgeConfig).toMatch(/assertPackagedFluxCliContract\(\{\s*runAsNodeFuseEnabled:/s);
  });

  it.each([
    ['fluxx', 'FLUXX_ELECTRON_EXE'],
    ['flux', 'FLUX_ELECTRON_EXE'],
  ] as const)('runs %s through the packaged Electron Node runtime', async (shimName, envName) => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'fluxx-cli-shim-'));
    const repoRoot = process.cwd();
    const fluxxShim = path.join(tmp, 'fluxx');
    const fluxShim = path.join(tmp, 'flux');
    const fakeElectron = path.join(tmp, 'fake-electron');
    const logPath = path.join(tmp, 'electron-run.log');
    const bundlePath = path.join(tmp, 'fluxx-cli.js');

    await fs.copyFile(path.join(repoRoot, 'scripts', 'fluxx-shim'), fluxxShim);
    await fs.copyFile(path.join(repoRoot, 'scripts', 'flux-shim'), fluxShim);
    await fs.chmod(fluxxShim, 0o755);
    await fs.chmod(fluxShim, 0o755);
    await fs.writeFile(bundlePath, 'throw new Error("bundle should be passed to Electron");\n');
    await writeExecutable(
      fakeElectron,
      `#!/usr/bin/env bash
printf '%s\\n' "$ELECTRON_RUN_AS_NODE" > "$LOG_PATH"
printf '%s\\n' "$1" >> "$LOG_PATH"
shift
printf '%s\\n' "$*" >> "$LOG_PATH"
`,
    );

    const env = {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      LOG_PATH: logPath,
      [envName]: fakeElectron,
    };

    await execFileAsync(path.join(tmp, shimName), ['project', 'info', '--json'], { env });

    await expect(fs.readFile(logPath, 'utf8')).resolves.toBe(
      `1\n${bundlePath}\nproject info --json\n`,
    );
  });
});
