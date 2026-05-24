import { spawn } from 'node:child_process';
import type { ExecutionDeviceConfig, ExecutionDeviceSshConfig } from '../types';

export const DEFAULT_SSH_BINARY = 'ssh';

export type BuildOpenSshArgvInput = {
  sshBinary?: string;
  ssh: ExecutionDeviceSshConfig;
  /** When true, allocate a TTY on the client (`ssh -tt`). */
  forceTty?: boolean;
  /** Remote command argv after OpenSSH `--` (each entry is a discrete argument). */
  remoteCommand: string[];
};

/**
 * Wrap a shell script for OpenSSH remote execution.
 * OpenSSH joins argv after `--` with spaces; the remote login shell word-splits again,
 * so `sh -c mkdir -p foo` becomes `sh -c` + script `mkdir` only. Keep the full script
 * in one remote argument via single-quoted `sh -c '…'`.
 */
export function wrapRemoteShellScript(script: string): string {
  const escaped = script.replace(/'/g, `'\\''`);
  return `sh -c '${escaped}'`;
}

/**
 * Build an OpenSSH argv array without shell interpolation.
 * Shape: `ssh [options] [user@]host -- <remoteCommand...>`
 */
export function buildOpenSshArgv(input: BuildOpenSshArgvInput): string[] {
  const sshBinary = input.sshBinary?.trim() || DEFAULT_SSH_BINARY;
  const ssh = input.ssh;
  const host = ssh.host.trim();
  if (!host) {
    throw new Error('SSH host is required');
  }

  const argv: string[] = [sshBinary];
  if (ssh.connectTimeoutSeconds != null && Number.isFinite(ssh.connectTimeoutSeconds)) {
    const seconds = Math.max(1, Math.floor(ssh.connectTimeoutSeconds));
    argv.push('-o', `ConnectTimeout=${seconds}`);
  }
  if (ssh.port != null && Number.isFinite(ssh.port)) {
    argv.push('-p', String(Math.floor(ssh.port)));
  }
  if (ssh.forwardAgent === true) {
    argv.push('-o', 'ForwardAgent=yes');
  }
  if (input.forceTty === true) {
    argv.push('-tt');
  }
  if (ssh.extraArgs?.length) {
    for (const arg of ssh.extraArgs) {
      if (typeof arg === 'string' && arg.length > 0) {
        argv.push(arg);
      }
    }
  }

  const destination = ssh.user?.trim() ? `${ssh.user.trim()}@${host}` : host;
  argv.push(destination);
  argv.push('--');
  const remote = input.remoteCommand;
  if (
    remote.length === 3 &&
    remote[0] === 'sh' &&
    remote[1] === '-c' &&
    typeof remote[2] === 'string'
  ) {
    argv.push(wrapRemoteShellScript(remote[2]));
  } else {
    for (const part of remote) {
      if (typeof part !== 'string' || part.length === 0) {
        throw new Error('Remote command arguments must be non-empty strings');
      }
      argv.push(part);
    }
  }
  return argv;
}

export function sshDestinationLabel(ssh: ExecutionDeviceSshConfig): string {
  const host = ssh.host.trim();
  return ssh.user?.trim() ? `${ssh.user.trim()}@${host}` : host;
}

export function deviceProbeHostLabel(device: ExecutionDeviceConfig): string {
  if (device.kind !== 'ssh' || !device.ssh) return device.displayName;
  return `${device.displayName} (${sshDestinationLabel(device.ssh)})`;
}

export function buildRemoteHelperShellCommand(
  helperSubcommand: string,
  extraArgs: string[] = [],
): string[] {
  const parts = [
    '"$HOME/.fluxx/bin/fluxx-remote-helper"',
    helperSubcommand,
    ...extraArgs,
    '--json',
  ];
  return ['sh', '-c', parts.join(' ')];
}

/** Interactive attach bridge: no `--json`; runs remote tmux attach over SSH TTY. */
export function buildRemoteHelperAttachTerminalCommand(terminalId: string): string[] {
  const id = terminalId.trim();
  if (!id) {
    throw new Error('terminalId is required for attach-terminal');
  }
  return ['sh', '-c', `"$HOME/.fluxx/bin/fluxx-remote-helper" attach-terminal ${id}`];
}

export function buildOpenSshAttachArgv(
  ssh: ExecutionDeviceSshConfig,
  terminalId: string,
  opts?: { sshBinary?: string },
): string[] {
  return buildOpenSshArgv({
    sshBinary: opts?.sshBinary,
    ssh,
    forceTty: true,
    remoteCommand: buildRemoteHelperAttachTerminalCommand(terminalId),
  });
}

export type OpenSshRunResult = {
  argv: string[];
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  error?: Error;
};

export type OpenSshRunner = {
  run: (input: {
    argv: string[];
    stdin?: string;
    timeoutMs?: number;
    env?: NodeJS.ProcessEnv;
  }) => Promise<OpenSshRunResult>;
};

export function createOpenSshRunner(opts?: {
  spawnFn?: typeof spawn;
}): OpenSshRunner {
  const spawnFn = opts?.spawnFn ?? spawn;
  return {
    async run({ argv, stdin, timeoutMs = 60_000, env }) {
      return await new Promise<OpenSshRunResult>((resolve) => {
        let stdout = '';
        let stderr = '';
        let timedOut = false;
        const child = spawnFn(argv[0], argv.slice(1), {
          env: env ?? process.env,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        const timer =
          timeoutMs > 0
            ? setTimeout(() => {
                timedOut = true;
                child.kill('SIGTERM');
                setTimeout(() => child.kill('SIGKILL'), 2_000).unref();
              }, timeoutMs)
            : null;
        child.stdout?.on('data', (chunk: Buffer | string) => {
          stdout += chunk.toString();
        });
        child.stderr?.on('data', (chunk: Buffer | string) => {
          stderr += chunk.toString();
        });
        child.on('error', (error) => {
          if (timer) clearTimeout(timer);
          resolve({
            argv,
            exitCode: null,
            signal: null,
            stdout,
            stderr,
            timedOut,
            error,
          });
        });
        child.on('close', (exitCode, signal) => {
          if (timer) clearTimeout(timer);
          resolve({
            argv,
            exitCode,
            signal,
            stdout,
            stderr,
            timedOut,
          });
        });
        if (stdin != null) {
          child.stdin?.write(stdin);
        }
        child.stdin?.end();
      });
    },
  };
}

export function defaultProbeTimeoutMs(ssh?: ExecutionDeviceSshConfig): number {
  const connect = ssh?.connectTimeoutSeconds;
  const base = connect != null && Number.isFinite(connect) ? connect * 1000 : 15_000;
  return Math.max(base + 45_000, 60_000);
}
