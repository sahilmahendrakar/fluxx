import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { Session } from '../types';
import {
  openWorkspacePath,
  pickSessionForTaskWorktree,
  resolveTaskWorktreePath,
} from './openWorkspacePath';

const { mockSpawn, mockExecFile, mockDiscoverMacEditor } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
  mockExecFile: vi.fn(),
  mockDiscoverMacEditor: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  spawn: mockSpawn,
  execFile: mockExecFile,
}));

vi.mock('electron', () => ({
  shell: { openPath: vi.fn(async () => '') },
}));

vi.mock('./discoverMacEditor', () => ({
  discoverMacEditor: mockDiscoverMacEditor,
}));

function mockSpawnSuccess() {
  mockSpawn.mockImplementationOnce(() => {
    const child = new EventEmitter() as EventEmitter & { unref: () => void };
    child.unref = vi.fn();
    queueMicrotask(() => child.emit('spawn'));
    return child;
  });
}

function mockSpawnQuickFailure() {
  mockSpawn.mockImplementationOnce(() => {
    const child = new EventEmitter() as EventEmitter & { unref: () => void };
    child.unref = vi.fn();
    queueMicrotask(() => {
      child.emit('spawn');
      child.emit('exit', 1);
    });
    return child;
  });
}

describe('openWorkspacePath editors', () => {
  let tmpDir = '';
  const platform = process.platform;

  beforeEach(async () => {
    mockSpawn.mockReset();
    mockExecFile.mockReset();
    mockDiscoverMacEditor.mockReset();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-open-wt-'));
  });

  afterEach(async () => {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
    Object.defineProperty(process, 'platform', { value: platform });
    vi.restoreAllMocks();
  });

  it('uses legacy PATH cursor on macOS without calling discovery', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    vi.spyOn(fs, 'access').mockRejectedValue(new Error('missing'));
    mockSpawnSuccess();

    const r = await openWorkspacePath(tmpDir, 'cursor');
    expect(r).toEqual({ ok: true });
    expect(mockSpawn).toHaveBeenCalledWith(
      'cursor',
      [path.resolve(tmpDir)],
      expect.objectContaining({ detached: true }),
    );
    expect(mockDiscoverMacEditor).not.toHaveBeenCalled();
  });

  it('falls back to discovery when legacy PATH shim exits immediately', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    vi.spyOn(fs, 'access').mockRejectedValue(new Error('missing'));
    const cliPath = '/Applications/Cursor 2.app/Contents/Resources/app/bin/cursor';
    mockDiscoverMacEditor.mockResolvedValue({
      openAppName: 'Cursor 2',
      cliPath,
    });
    mockSpawnQuickFailure();
    mockSpawnSuccess();
    mockExecFile.mockImplementation((_cmd, _args, cb) => {
      (cb as (err: Error) => void)(new Error("Unable to find application named 'Cursor'"));
    });

    const r = await openWorkspacePath(tmpDir, 'cursor');
    expect(r).toEqual({ ok: true });
    expect(mockDiscoverMacEditor).toHaveBeenCalledWith('cursor');
    expect(mockSpawn).toHaveBeenLastCalledWith(
      cliPath,
      [path.resolve(tmpDir)],
      expect.objectContaining({ detached: true }),
    );
  });

  it('falls back to discovery when legacy open -a also fails', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    vi.spyOn(fs, 'access').mockRejectedValue(new Error('missing'));
    mockDiscoverMacEditor.mockResolvedValue({
      openAppName: 'Cursor 2',
      cliPath: '/Applications/Cursor 2.app/Contents/Resources/app/bin/cursor',
    });
    mockSpawnQuickFailure();
    mockSpawnSuccess();
    mockExecFile.mockImplementation((_cmd, _args, cb) => {
      (cb as (err: Error) => void)(new Error("Unable to find application named 'Cursor'"));
    });

    const r = await openWorkspacePath(tmpDir, 'cursor');
    expect(r).toEqual({ ok: true });
    expect(mockDiscoverMacEditor).toHaveBeenCalledWith('cursor');
    expect(mockExecFile).toHaveBeenCalledWith(
      'open',
      ['-a', 'Cursor', path.resolve(tmpDir)],
      expect.any(Function),
    );
  });

  it('returns a short message when legacy and discovery both fail for VS Code', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    vi.spyOn(fs, 'access').mockRejectedValue(new Error('missing'));
    mockSpawn.mockImplementation(() => {
      const child = new EventEmitter() as EventEmitter & { unref: () => void };
      child.unref = vi.fn();
      queueMicrotask(() =>
        child.emit('error', Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
      );
      return child;
    });
    mockExecFile.mockImplementation((_cmd, _args, cb) => {
      (cb as (err: Error) => void)(new Error("Unable to find application named 'Visual Studio Code'"));
    });
    mockDiscoverMacEditor.mockResolvedValue(null);

    const r = await openWorkspacePath(tmpDir, 'vscode');
    expect(r).toEqual({ error: "VS Code isn't installed." });
    expect(mockDiscoverMacEditor).toHaveBeenCalledWith('vscode');
  });
});

describe('pickSessionForTaskWorktree', () => {
  const mk = (id: string, taskId: string, repoId?: string): Session => ({
    id,
    taskId,
    projectId: 'p',
    repoId,
    worktreePath: `/wt/${taskId}`,
    branch: 'fluxx/task-x',
    status: 'running',
    startedAt: '',
  });

  it('prefers a session whose repoId matches when requested', () => {
    const sessions = [
      mk('s1', 't1', 'repo-a'),
      mk('s2', 't1', 'repo-b'),
    ];
    expect(pickSessionForTaskWorktree(sessions, 't1', 'repo-b')?.id).toBe('s2');
  });

  it('falls back to a legacy session without repoId when no exact match', () => {
    const sessions = [mk('s1', 't1', 'repo-a'), mk('s2', 't1')];
    expect(pickSessionForTaskWorktree(sessions, 't1', 'repo-z')?.id).toBe('s2');
  });
});

describe('resolveTaskWorktreePath lookup order', () => {
  async function tmpProject(): Promise<string> {
    return fs.mkdtemp(path.join(os.tmpdir(), 'flux-wt-'));
  }

  it('prefers daemon session path when present', async () => {
    const projectDir = await tmpProject();
    try {
      const sessPath = path.join(projectDir, 'session-wt');
      await fs.mkdir(sessPath, { recursive: true });
      const diskOther = path.join(projectDir, 'worktrees', 'rid', 'tid');
      await fs.mkdir(diskOther, { recursive: true });

      const r = await resolveTaskWorktreePath(
        'tid',
        async (): Promise<Session[]> => [
          {
            id: 's',
            taskId: 'tid',
            projectId: 'p',
            repoId: 'rid',
            worktreePath: sessPath,
            branch: 'b',
            status: 'running',
            startedAt: '',
          },
        ],
        projectDir,
        'rid',
      );
      expect(r).toBe(sessPath);
    } finally {
      await fs.rm(projectDir, { recursive: true, force: true });
    }
  });

  it('uses worktrees/<repoId>/<taskId> before legacy flat when repoId is set', async () => {
    const projectDir = await tmpProject();
    try {
      const repoScoped = path.join(projectDir, 'worktrees', 'r1', 'tid');
      const legacyFlat = path.join(projectDir, 'worktrees', 'tid');
      await fs.mkdir(repoScoped, { recursive: true });
      await fs.mkdir(legacyFlat, { recursive: true });

      const r = await resolveTaskWorktreePath(
        'tid',
        async () => [],
        projectDir,
        'r1',
      );
      expect(r).toBe(repoScoped);
    } finally {
      await fs.rm(projectDir, { recursive: true, force: true });
    }
  });

  it('falls back to legacy flat after repo-scoped when repoId is set', async () => {
    const projectDir = await tmpProject();
    try {
      const legacyFlat = path.join(projectDir, 'worktrees', 'tid');
      await fs.mkdir(legacyFlat, { recursive: true });

      const r = await resolveTaskWorktreePath(
        'tid',
        async () => [],
        projectDir,
        'missing-repo',
      );
      expect(r).toBe(legacyFlat);
    } finally {
      await fs.rm(projectDir, { recursive: true, force: true });
    }
  });

  it('scans nested worktrees/*/<taskId> only when repoId is unset', async () => {
    const projectDir = await tmpProject();
    try {
      const nested = path.join(projectDir, 'worktrees', 'any-repo-id', 'tid');
      await fs.mkdir(nested, { recursive: true });

      const rUnset = await resolveTaskWorktreePath('tid', async () => [], projectDir);
      expect(rUnset).toBe(nested);

      const rSet = await resolveTaskWorktreePath(
        'tid',
        async () => [],
        projectDir,
        'other-repo',
      );
      expect(rSet).toBeNull();
    } finally {
      await fs.rm(projectDir, { recursive: true, force: true });
    }
  });
});
