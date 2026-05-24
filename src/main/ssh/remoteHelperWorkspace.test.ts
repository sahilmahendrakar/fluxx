import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const helperPath = path.join(process.cwd(), 'scripts', 'fluxx-remote-helper.js');

function runHelper(command: string, stdin: Record<string, unknown> = {}) {
  return spawnSync(process.execPath, [helperPath, command, '--json'], {
    input: `${JSON.stringify(stdin)}\n`,
    encoding: 'utf8',
    env: process.env,
  });
}

describe('fluxx-remote-helper workspace RPCs', () => {
  let tempRoot = '';

  afterEach(() => {
    if (tempRoot) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
      tempRoot = '';
    }
  });

  it('reports version 0.2.6 with worktree reclaim feature', () => {
    const result = spawnSync(process.execPath, [helperPath, 'version', '--json'], {
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    const envelope = JSON.parse(result.stdout.trim());
    expect(envelope.data.version).toBe('0.2.6');
    expect(envelope.data.features?.worktreeReclaim).toBe(true);
  });

  it('clones repo on demand when cache is missing', () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fluxx-helper-'));
    const remoteUrl = 'https://github.com/octocat/Hello-World.git';
    const result = runHelper('repo-ensure', {
      workspaceRoot: tempRoot,
      projectId: 'proj',
      repoId: 'hello',
      remoteUrl,
    });
    expect(result.status).toBe(0);
    const envelope = JSON.parse(result.stdout.trim());
    expect(envelope.ok).toBe(true);
    expect(envelope.data.action).toBe('cloned');
    expect(fs.existsSync(path.join(envelope.data.repoPath, '.git'))).toBe(true);
  });

  it('fetches when repo cache already exists', () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fluxx-helper-'));
    const remoteUrl = 'https://github.com/octocat/Hello-World.git';
    const first = runHelper('repo-ensure', {
      workspaceRoot: tempRoot,
      projectId: 'proj',
      repoId: 'hello',
      remoteUrl,
    });
    expect(first.status).toBe(0);
    const second = runHelper('repo-ensure', {
      workspaceRoot: tempRoot,
      projectId: 'proj',
      repoId: 'hello',
      remoteUrl,
    });
    expect(second.status).toBe(0);
    const envelope = JSON.parse(second.stdout.trim());
    expect(envelope.data.action).toBe('fetched');
  });

  it('rejects wrong-repo cache with mismatch error', () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fluxx-helper-'));
    const remoteUrl = 'https://github.com/octocat/Hello-World.git';
    const first = runHelper('repo-ensure', {
      workspaceRoot: tempRoot,
      projectId: 'proj',
      repoId: 'hello',
      remoteUrl,
    });
    expect(first.status).toBe(0);
    const second = runHelper('repo-ensure', {
      workspaceRoot: tempRoot,
      projectId: 'proj',
      repoId: 'hello',
      remoteUrl: 'https://github.com/octocat/Spoon-Knife.git',
    });
    expect(second.status).toBe(1);
    const envelope = JSON.parse(second.stdout.trim());
    expect(envelope.error.code).toBe('REMOTE_REPO_MISMATCH');
  });

  it('creates a worktree when the repo setup script exits non-zero', () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fluxx-helper-wt-setup-'));
    const remoteUrl = 'https://github.com/octocat/Hello-World.git';
    const ensured = runHelper('repo-ensure', {
      workspaceRoot: tempRoot,
      projectId: 'proj',
      repoId: 'hello',
      remoteUrl,
    });
    expect(ensured.status).toBe(0);
    const repoPath = JSON.parse(ensured.stdout.trim()).data.repoPath;
    const created = runHelper('worktree-create', {
      workspaceRoot: tempRoot,
      projectId: 'proj',
      repoId: 'hello',
      taskId: 'task-setup-warn',
      taskTitle: 'setup warn',
      repoPath,
      sourceBranchShort: 'master',
      setupScript: 'definitely-not-a-command-xyz',
    });
    expect(created.status).toBe(0);
    const envelope = JSON.parse(created.stdout.trim());
    expect(envelope.ok).toBe(true);
    expect(envelope.data.setupWarning).toMatch(/exited with code 127/);
    expect(fs.existsSync(envelope.data.worktreePath)).toBe(true);
  });

  it('probe-repo-path rejects missing directories', () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fluxx-helper-probe-'));
    const result = runHelper('probe-repo-path', {
      remotePath: path.join(tempRoot, 'missing'),
      remoteUrl: 'https://github.com/octocat/Hello-World.git',
    });
    expect(result.status).toBe(1);
    const envelope = JSON.parse(result.stdout.trim());
    expect(envelope.error.code).toBe('REMOTE_REPO_MISMATCH');
  });

  it('writes and lists terminal manifest rows', () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fluxx-helper-manifest-'));
    const manifestDir = path.join(tempRoot, '.fluxx', 'devices', 'device-1');
    fs.mkdirSync(manifestDir, { recursive: true });
    fs.writeFileSync(
      path.join(manifestDir, 'terminal-sessions.json'),
      `${JSON.stringify({
        version: 1,
        terminals: [
          {
            id: 'term-abc',
            kind: 'task',
            runtime: 'tmux',
            projectId: 'p1',
            repoId: 'repo-a',
            deviceId: 'device-1',
            deviceKind: 'ssh',
            hostLabel: 'Devbox',
            cwd: '/tmp/worktree',
            tmuxSessionName: 'fluxx-task-p1-termabc',
            command: 'agent',
            args: ['hi'],
            cols: 80,
            rows: 24,
            startedAt: '2026-05-23T12:00:00.000Z',
          },
        ],
      })}\n`,
      'utf8',
    );
    const priorHome = process.env.HOME;
    process.env.HOME = tempRoot;
    try {
      const list = runHelper('list-terminals', { deviceId: 'device-1' });
      expect(list.status).toBe(0);
      const envelope = JSON.parse(list.stdout.trim());
      expect(envelope.data.terminals).toHaveLength(1);
      expect(envelope.data.terminals[0]).toMatchObject({
        id: 'term-abc',
        runtime: 'tmux',
        deviceKind: 'ssh',
        tmuxSessionName: 'fluxx-task-p1-termabc',
      });
    } finally {
      if (priorHome === undefined) delete process.env.HOME;
      else process.env.HOME = priorHome;
    }
  });
});
