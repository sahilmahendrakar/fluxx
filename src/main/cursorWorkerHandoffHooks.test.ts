import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  FLUXX_WORKER_HANDOFF_HOOK_COMMAND,
  FLUXX_WORKER_HANDOFF_SESSION_REL,
  buildFluxxWorkerHandoffStopHookScript,
  defaultCursorHooksForWorkerHandoff,
  materializeCursorWorkerHandoffHooks,
} from './cursorWorkerHandoffHooks';
import { FLUXX_WORKER_HANDOFF_JSON_REL } from '../taskAgentWorkerHandoffPrompt';

async function runHookScript(
  hookScriptPath: string,
  worktree: string,
  stdin: string,
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn('bash', [hookScriptPath], { cwd: worktree });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ stdout, stderr, code }));
    child.stdin.write(stdin);
    child.stdin.end();
  });
}

describe('cursorWorkerHandoffHooks', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'flux-cursor-handoff-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('materializes hooks.json, script, session manifest, and git exclude', async () => {
    const worktree = path.join(dir, 'worktree');
    const projectDir = path.join(dir, 'project');
    await fs.mkdir(worktree, { recursive: true });
    await fs.mkdir(path.join(projectDir, '.fluxx'), { recursive: true });
    await fs.writeFile(
      path.join(projectDir, '.fluxx', 'cli-bridge.json'),
      JSON.stringify({
        url: 'http://127.0.0.1:9',
        token: 't',
        expectedActiveKey: { kind: 'local', id: 'p1' },
      }),
      'utf8',
    );
    await fs.mkdir(path.join(worktree, '.git', 'info'), { recursive: true });

    const result = await materializeCursorWorkerHandoffHooks({
      worktreePath: worktree,
      taskId: 'task-1',
      projectDir,
      fluxCliBinDir: '/tmp/fluxx-cli',
    });

    expect(result.hookScriptPath).toContain('fluxx-submit-worker-handoff.sh');
    const hooksJson = JSON.parse(await fs.readFile(result.hooksJsonPath, 'utf8')) as {
      hooks: { stop: Array<{ command: string }> };
    };
    expect(hooksJson.hooks.stop.some((h) => h.command === FLUXX_WORKER_HANDOFF_HOOK_COMMAND)).toBe(
      true,
    );
    const manifest = JSON.parse(await fs.readFile(result.sessionManifestPath, 'utf8')) as {
      taskId: string;
    };
    expect(manifest.taskId).toBe('task-1');

    const exclude = await fs.readFile(path.join(worktree, '.git', 'info', 'exclude'), 'utf8');
    expect(exclude).toContain('.cursor/');

    const stat = await fs.stat(result.hookScriptPath);
    expect(stat.mode & 0o111).not.toBe(0);
  });

  it('merges stop hook into existing hooks.json without duplicating', async () => {
    const worktree = path.join(dir, 'worktree');
    const projectDir = path.join(dir, 'project');
    await fs.mkdir(path.join(worktree, '.cursor'), { recursive: true });
    await fs.mkdir(path.join(worktree, '.git', 'info'), { recursive: true });
    await fs.mkdir(path.join(projectDir, '.fluxx'), { recursive: true });
    await fs.writeFile(
      path.join(worktree, '.cursor', 'hooks.json'),
      JSON.stringify({
        version: 1,
        hooks: {
          stop: [{ command: 'hooks/other.sh' }],
        },
      }),
      'utf8',
    );

    await materializeCursorWorkerHandoffHooks({
      worktreePath: worktree,
      taskId: 't2',
      projectDir,
    });
    await materializeCursorWorkerHandoffHooks({
      worktreePath: worktree,
      taskId: 't2',
      projectDir,
    });

    const hooksJson = JSON.parse(
      await fs.readFile(path.join(worktree, '.cursor', 'hooks.json'), 'utf8'),
    ) as { hooks: { stop: Array<{ command: string }> } };
    const flux = hooksJson.hooks.stop.filter((h) => h.command === FLUXX_WORKER_HANDOFF_HOOK_COMMAND);
    expect(flux).toHaveLength(1);
    expect(hooksJson.hooks.stop.some((h) => h.command === 'hooks/other.sh')).toBe(true);
  });

  it('stop hook exits 0 when handoff file is missing (fail-safe)', async () => {
    const worktree = path.join(dir, 'worktree');
    const projectDir = path.join(dir, 'project');
    await fs.mkdir(path.join(worktree, '.git', 'info'), { recursive: true });
    await fs.mkdir(path.join(projectDir, '.fluxx'), { recursive: true });
    await fs.writeFile(
      path.join(projectDir, '.fluxx', 'cli-bridge.json'),
      JSON.stringify({
        url: 'http://127.0.0.1:9',
        token: 't',
        expectedActiveKey: { kind: 'local', id: 'p1' },
      }),
      'utf8',
    );

    const { hookScriptPath } = await materializeCursorWorkerHandoffHooks({
      worktreePath: worktree,
      taskId: 'task-missing',
      projectDir,
    });

    const stdin = JSON.stringify({
      status: 'completed',
      hook_event_name: 'stop',
    });
    const { stdout, stderr, code } = await runHookScript(hookScriptPath, worktree, stdin);
    expect(code).toBe(0);
    expect(stdout).toBe('');
    expect(stderr).toContain(FLUXX_WORKER_HANDOFF_JSON_REL);
  });

  it('default hooks file matches expected shape', () => {
    expect(defaultCursorHooksForWorkerHandoff()).toEqual({
      version: 1,
      hooks: {
        stop: [{ command: FLUXX_WORKER_HANDOFF_HOOK_COMMAND, timeout: 30 }],
      },
    });
  });

  it('generated hook script is non-empty bash', () => {
    const script = buildFluxxWorkerHandoffStopHookScript();
    expect(script.startsWith('#!/usr/bin/env bash')).toBe(true);
    expect(script).toContain(FLUXX_WORKER_HANDOFF_SESSION_REL);
  });
});
