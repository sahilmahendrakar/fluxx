import { describe, expect, it, vi } from 'vitest';

const ptyState = vi.hoisted(() => ({
  instances: [] as Array<{
    write: ReturnType<typeof vi.fn>;
    resize: ReturnType<typeof vi.fn>;
    kill: ReturnType<typeof vi.fn>;
    emitData: (data: string) => void;
    emitExit: (exitCode: number, signal?: number) => void;
  }>,
}));

vi.mock('node-pty', () => ({
  spawn: vi.fn(() => {
    let dataCb: ((data: string) => void) | undefined;
    let exitCb: ((info: { exitCode: number; signal?: number }) => void) | undefined;
    const fake = {
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      onData: (cb: (data: string) => void) => {
        dataCb = cb;
      },
      onExit: (cb: (info: { exitCode: number; signal?: number }) => void) => {
        exitCb = cb;
      },
      emitData: (data: string) => dataCb?.(data),
      emitExit: (exitCode: number, signal?: number) => exitCb?.({ exitCode, signal }),
    };
    ptyState.instances.push(fake);
    return fake;
  }),
}));

describe('TerminalSession', () => {
  it('returns a snapshot with a streamSeq boundary under live output', async () => {
    const { TerminalSession } = await import('./TerminalSession');
    const dataFrames: Array<{ data: string; seq: number }> = [];
    const session = new TerminalSession(
      {
        command: 'sh',
        args: [],
        cwd: '/tmp',
        cols: 20,
        rows: 5,
      },
      {
        onData: (data, seq) => dataFrames.push({ data, seq }),
        onExit: vi.fn(),
      },
    );
    const pty = ptyState.instances[ptyState.instances.length - 1];

    pty.emitData('before\n');
    const attachPromise = session.attach();
    pty.emitData('during\n');

    const attach = await attachPromise;
    expect(attach.snapshot?.snapshotAnsi).toContain('before');
    expect(attach.snapshot?.snapshotAnsi).toContain('during');
    expect(attach.streamSeq).toBe(2);
    expect(dataFrames).toEqual([
      { data: 'before\n', seq: 1 },
      { data: 'during\n', seq: 2 },
    ]);
    session.dispose();
  });

  it('resizes owner PTY and emulator but ignores invalid dimensions', async () => {
    const { TerminalSession } = await import('./TerminalSession');
    const session = new TerminalSession(
      {
        command: 'sh',
        args: [],
        cwd: '/tmp',
        cols: 20,
        rows: 5,
      },
      {
        onData: vi.fn(),
        onExit: vi.fn(),
      },
    );
    const pty = ptyState.instances[ptyState.instances.length - 1];

    session.resize(100, 30);
    session.resize(0, 30);

    expect(pty.resize).toHaveBeenCalledTimes(1);
    expect(pty.resize).toHaveBeenCalledWith(100, 30);
    expect((await session.attach()).snapshot).toMatchObject({ cols: 100, rows: 30 });
    session.dispose();
  });
});
