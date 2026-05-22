import { describe, expect, it } from 'vitest';
import { buildTmuxNewSessionDetachedArgs } from './tmuxSpawn';

describe('buildTmuxNewSessionDetachedArgs', () => {
  it('uses spawn wrapper with Run-as-Node env, not raw Electron in tmux argv', () => {
    const electronExe = '/Applications/Fluxx.app/Contents/MacOS/Fluxx';
    const args = buildTmuxNewSessionDetachedArgs({
      sessionName: 'fluxx-task-demo-abc123',
      cwd: '/tmp/work tree',
      cols: 80,
      rows: 24,
      spawnWrapperPath: '/opt/fluxx/fluxx-tmux-spawn.sh',
      specPath: '/tmp/fluxx-tmux-spawn/spec.json',
      electronExe,
    });
    expect(args).toEqual([
      '-s',
      'fluxx-task-demo-abc123',
      '-c',
      '/tmp/work tree',
      '-x',
      '80',
      '-y',
      '24',
      '-e',
      'ELECTRON_RUN_AS_NODE=1',
      '-e',
      `FLUXX_ELECTRON_EXE=${electronExe}`,
      '-e',
      `FLUX_ELECTRON_EXE=${electronExe}`,
      '--',
      '/opt/fluxx/fluxx-tmux-spawn.sh',
      '/tmp/fluxx-tmux-spawn/spec.json',
    ]);
  });

  it('quotes are not embedded in tmux argv (handled by spawn spec file)', () => {
    const args = buildTmuxNewSessionDetachedArgs({
      sessionName: 'fluxx-planning-p-xyz',
      cwd: '/tmp',
      cols: 10,
      rows: 5,
      spawnWrapperPath: '/launcher.sh',
      specPath: '/spec.json',
      electronExe: '/Electron',
    });
    const dashDash = args.indexOf('--');
    expect(dashDash).toBeGreaterThan(-1);
    expect(args.slice(dashDash + 1)).toEqual(['/launcher.sh', '/spec.json']);
  });
});
