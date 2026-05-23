#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const VERSION = '0.1.0';

function emit(payload) {
  process.stdout.write(`${JSON.stringify({ version: VERSION, ...payload })}\n`);
}

function fail(code, message) {
  emit({ ok: false, error: { code, message } });
  process.exit(1);
}

function readStdinJson() {
  try {
    const text = fs.readFileSync(0, 'utf8').trim();
    if (!text) return {};
    return JSON.parse(text);
  } catch (err) {
    fail('INTERNAL', err instanceof Error ? err.message : String(err));
  }
}

function runCapture(command, args, opts = {}) {
  try {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    env: process.env,
    timeout: opts.timeoutMs ?? 30_000,
  });
    if (result.error) {
      return { ok: false, error: result.error.message };
    }
    if (result.status !== 0) {
      const stderr = (result.stderr || '').trim();
      return { ok: false, error: stderr || `${command} exited ${result.status}` };
    }
    return { ok: true, stdout: (result.stdout || '').trim() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function which(command) {
  const result = runCapture('command', ['-v', command]);
  if (!result.ok || !result.stdout) return null;
  return result.stdout.split('\n')[0].trim() || null;
}

function expandHome(inputPath) {
  if (!inputPath || typeof inputPath !== 'string') return inputPath;
  if (inputPath === '~') return os.homedir();
  if (inputPath.startsWith('~/')) {
    return path.join(os.homedir(), inputPath.slice(2));
  }
  return inputPath;
}

function probeTool(command, versionArgs = ['--version']) {
  const binPath = which(command);
  if (!binPath) {
    return { found: false };
  }
  const versionResult = runCapture(binPath, versionArgs);
  return {
    found: true,
    path: binPath,
    version: versionResult.ok ? versionResult.stdout.split('\n')[0] : undefined,
  };
}

function probeWorkspaceRoot(workspaceRoot) {
  const resolved = expandHome(workspaceRoot);
  try {
    fs.mkdirSync(resolved, { recursive: true });
    const probeFile = path.join(resolved, `.fluxx-write-probe-${process.pid}`);
    fs.writeFileSync(probeFile, 'ok', 'utf8');
    fs.unlinkSync(probeFile);
    return { path: resolved, writable: true };
  } catch (err) {
    return {
      path: resolved,
      writable: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function sshHostFromGitRemoteUrl(remoteUrl) {
  const scpStyle = /^[^@]+@([^:/]+):/.exec(remoteUrl);
  if (scpStyle) return scpStyle[1];
  try {
    const parsed = new URL(remoteUrl);
    if (parsed.protocol === 'ssh:') return parsed.hostname || null;
  } catch {
    // not a URL
  }
  return null;
}

function sshHostKeyKnown(host) {
  const result = runCapture('ssh-keygen', ['-F', host]);
  return result.ok && Boolean(result.stdout && result.stdout.trim());
}

function ensureSshHostKnown(host) {
  if (!host) return { ok: true };
  if (sshHostKeyKnown(host)) return { ok: true };
  const sshDir = path.join(os.homedir(), '.ssh');
  try {
    fs.mkdirSync(sshDir, { recursive: true, mode: 0o700 });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  const scan = runCapture('ssh-keyscan', ['-H', host], { timeoutMs: 30_000 });
  if (!scan.ok || !scan.stdout) {
    return {
      ok: false,
      error: scan.error || `ssh-keyscan failed for ${host}`,
    };
  }
  const knownHostsPath = path.join(sshDir, 'known_hosts');
  fs.appendFileSync(knownHostsPath, `${scan.stdout.trim()}\n`, { mode: 0o644 });
  return { ok: true };
}

function probeRepoAccess(repo) {
  const remoteUrl = typeof repo.remoteUrl === 'string' ? repo.remoteUrl.trim() : '';
  if (!remoteUrl) {
    return { accessible: false, error: 'Missing remote URL' };
  }
  const sshHost = sshHostFromGitRemoteUrl(remoteUrl);
  if (sshHost) {
    const known = ensureSshHostKnown(sshHost);
    if (!known.ok) {
      return { accessible: false, error: known.error || `Could not trust SSH host ${sshHost}` };
    }
  }
  const result = runCapture('git', ['ls-remote', '--heads', remoteUrl, 'HEAD'], {
    timeoutMs: 60_000,
  });
  if (!result.ok) {
    return { accessible: false, error: result.error || 'git ls-remote failed' };
  }
  return { accessible: true };
}

function runProbe(params) {
  const workspaceRoot =
    typeof params.workspaceRoot === 'string' && params.workspaceRoot.trim()
      ? params.workspaceRoot.trim()
      : '~/.fluxx/workspaces';
  const requireTmux = params.requireTmux === true;
  const shellPreference =
    typeof params.shell === 'string' && params.shell.trim() ? params.shell.trim() : undefined;
  const agentCommands = Array.isArray(params.agentCommands)
    ? params.agentCommands.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim())
    : ['claude', 'agent', 'codex'];
  const repos = Array.isArray(params.repos) ? params.repos : [];

  const platform = `${os.type()} ${os.release()}`;
  const arch = os.arch();
  const shellPath = shellPreference || process.env.SHELL || which('bash') || which('sh') || undefined;
  const git = probeTool('git');
  const tmux = probeTool('tmux', ['-V']);
  const workspace = probeWorkspaceRoot(workspaceRoot);
  const agents = agentCommands.map((command) => ({
    command,
    ...probeTool(command),
  }));
  const repoResults = repos.map((repo) => {
    const repoId = typeof repo.repoId === 'string' ? repo.repoId : 'unknown';
    const label = typeof repo.label === 'string' ? repo.label : undefined;
    const remoteUrl = typeof repo.remoteUrl === 'string' ? repo.remoteUrl : undefined;
    const access = probeRepoAccess(repo);
    return {
      repoId,
      label,
      remoteUrl,
      accessible: access.accessible,
      ...(access.error ? { error: access.error } : {}),
    };
  });

  const capabilities = {
    os: platform,
    arch,
    shell: shellPath,
    git,
    tmux,
    workspaceRoot: {
      path: workspace.path,
      writable: workspace.writable,
    },
    agents,
    repos: repoResults,
  };

  if (!git.found) {
    emit({
      ok: false,
      error: {
        code: 'REMOTE_GIT_MISSING',
        message: 'git was not found on PATH',
      },
      data: capabilities,
    });
    process.exit(1);
  }
  if (requireTmux && !tmux.found) {
    emit({
      ok: false,
      error: {
        code: 'REMOTE_TMUX_MISSING',
        message: 'tmux was not found on PATH',
      },
      data: capabilities,
    });
    process.exit(1);
  }
  if (!workspace.writable) {
    emit({
      ok: false,
      error: {
        code: 'REMOTE_WORKSPACE_UNWRITABLE',
        message: workspace.error || `Cannot write to workspace root ${workspace.path}`,
      },
      data: capabilities,
    });
    process.exit(1);
  }
  const failedRepo = repoResults.find((r) => !r.accessible);
  if (failedRepo) {
    emit({
      ok: false,
      error: {
        code: 'REMOTE_REPO_ACCESS_FAILED',
        message: failedRepo.error
          ? `Repo ${failedRepo.label || failedRepo.repoId}: ${failedRepo.error}`
          : `Repo ${failedRepo.label || failedRepo.repoId} is not accessible from this host`,
      },
      data: capabilities,
    });
    process.exit(1);
  }

  emit({ ok: true, data: capabilities });
}

function main() {
  if (!process.argv.includes('--json')) {
    fail('INTERNAL', '--json is required');
  }
  const command = process.argv[2];
  if (!command) {
    fail('INTERNAL', 'Missing helper command');
  }
  switch (command) {
    case 'version':
      emit({ ok: true, data: { version: VERSION } });
      break;
    case 'probe':
      runProbe(readStdinJson());
      break;
    default:
      fail('INTERNAL', `Unknown helper command: ${command}`);
  }
}

main();
