import { spawn } from 'node:child_process';
import {
  type GlobalOnboardingCliId,
  type GlobalOnboardingCliProbeResult,
  type CliProbeStatus,
} from '../globalOnboarding/types';

export const GLOBAL_ONBOARDING_CLI_COMMANDS = [
  'claude',
  'agent',
  'codex',
  'gh',
] as const satisfies readonly GlobalOnboardingCliId[];

export const GLOBAL_ONBOARDING_CLI_PROBE_TIMEOUT_MS = 2_000;

export type CliProbeRunner = (
  command: GlobalOnboardingCliId,
  timeoutMs: number,
) => Promise<GlobalOnboardingCliProbeResult>;

function shellProbeArgv(command: GlobalOnboardingCliId): {
  file: string;
  args: string[];
} {
  if (process.platform === 'win32') {
    return { file: 'where', args: [command] };
  }
  const shell = process.env.SHELL || '/bin/sh';
  return {
    file: shell,
    args: ['-lc', `command -v ${command}`],
  };
}

function mapSpawnError(err: NodeJS.ErrnoException): CliProbeStatus {
  if (err.code === 'ENOENT') return 'missing';
  return 'error';
}

/**
 * Probes whether a CLI binary is on PATH. Never throws for missing binaries;
 * returns stable `found` / `missing` / `error` / `timeout` results.
 */
export function probeGlobalOnboardingCli(
  command: GlobalOnboardingCliId,
  timeoutMs: number = GLOBAL_ONBOARDING_CLI_PROBE_TIMEOUT_MS,
  run: CliProbeRunner = defaultCliProbeRunner,
): Promise<GlobalOnboardingCliProbeResult> {
  return run(command, timeoutMs);
}

export async function probeAllGlobalOnboardingClis(
  timeoutMs: number = GLOBAL_ONBOARDING_CLI_PROBE_TIMEOUT_MS,
  run: CliProbeRunner = defaultCliProbeRunner,
): Promise<GlobalOnboardingCliProbeResult[]> {
  const results: GlobalOnboardingCliProbeResult[] = [];
  for (const command of GLOBAL_ONBOARDING_CLI_COMMANDS) {
    results.push(await probeGlobalOnboardingCli(command, timeoutMs, run));
  }
  return results;
}

function defaultCliProbeRunner(
  command: GlobalOnboardingCliId,
  timeoutMs: number,
): Promise<GlobalOnboardingCliProbeResult> {
  return new Promise((resolve) => {
    const { file, args } = shellProbeArgv(command);
    let settled = false;
    const finish = (result: GlobalOnboardingCliProbeResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const child = spawn(file, args, {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
    });

    const timer = setTimeout(() => {
      try {
        child.kill('SIGTERM');
      } catch {
        /* ignore */
      }
      finish({ command, status: 'timeout', message: `Timed out after ${timeoutMs}ms` });
    }, timeoutMs);

    child.on('error', (err: NodeJS.ErrnoException) => {
      const status = mapSpawnError(err);
      finish({
        command,
        status,
        message: err.message || String(err),
      });
    });

    child.on('close', (code) => {
      const path = stdout.trim().split('\n')[0]?.trim();
      if (code === 0 && path) {
        finish({ command, status: 'found', path });
        return;
      }
      if (code === 0 && !path) {
        finish({ command, status: 'missing' });
        return;
      }
      if (code === 1 && !path) {
        finish({ command, status: 'missing' });
        return;
      }
      const message = (stderr.trim() || stdout.trim() || `exit ${code ?? '?'}`).slice(
        0,
        400,
      );
      finish({
        command,
        status: 'error',
        ...(message ? { message } : {}),
      });
    });
  });
}
