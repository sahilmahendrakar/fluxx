import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { tmuxNewDetachedSession } from './tmuxCommands';

export interface FluxxTmuxSpawnSpec {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string | undefined>;
}

/**
 * argv for `tmux new-session -d … -- <spawn-wrapper> <spec.json>` (safe passthrough).
 * Uses {@link scripts/fluxx-tmux-spawn.sh} with ELECTRON_RUN_AS_NODE so spawning the
 * Electron binary does not create extra Dock icons on macOS.
 */
export function buildTmuxNewSessionDetachedArgs(input: {
  sessionName: string;
  cwd: string;
  cols: number;
  rows: number;
  /** Path to `fluxx-tmux-spawn.sh` (not the raw Electron exe). */
  spawnWrapperPath: string;
  specPath: string;
  /** Packaged or dev Electron executable for Run-as-Node (passed via tmux -e). */
  electronExe: string;
}): string[] {
  const { sessionName, cwd, cols, rows, spawnWrapperPath, specPath, electronExe } = input;
  return [
    '-s',
    sessionName,
    '-c',
    cwd,
    '-x',
    String(Math.max(1, cols)),
    '-y',
    String(Math.max(1, rows)),
    '-e',
    'ELECTRON_RUN_AS_NODE=1',
    '-e',
    `FLUXX_ELECTRON_EXE=${electronExe}`,
    '-e',
    `FLUX_ELECTRON_EXE=${electronExe}`,
    '--',
    spawnWrapperPath,
    specPath,
  ];
}

export async function writeFluxxTmuxSpawnSpec(
  spec: FluxxTmuxSpawnSpec,
  terminalId: string,
): Promise<string> {
  const dir = path.join(os.tmpdir(), 'fluxx-tmux-spawn');
  await fs.mkdir(dir, { recursive: true });
  const specPath = path.join(dir, `${terminalId}.json`);
  await fs.writeFile(specPath, `${JSON.stringify(spec)}\n`, 'utf8');
  return specPath;
}

export async function spawnFluxxTmuxSession(input: {
  sessionName: string;
  spec: FluxxTmuxSpawnSpec;
  terminalId: string;
  cols: number;
  rows: number;
  spawnWrapperPath: string;
  electronExe: string;
}): Promise<void> {
  const specPath = await writeFluxxTmuxSpawnSpec(input.spec, input.terminalId);
  const args = buildTmuxNewSessionDetachedArgs({
    sessionName: input.sessionName,
    cwd: input.spec.cwd,
    cols: input.cols,
    rows: input.rows,
    spawnWrapperPath: input.spawnWrapperPath,
    specPath,
    electronExe: input.electronExe,
  });
  await tmuxNewDetachedSession(args);
}
