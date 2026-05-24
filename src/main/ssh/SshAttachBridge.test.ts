import { describe, expect, it, vi } from 'vitest';
import { SshAttachBridge } from './SshAttachBridge';

type MockPty = {
  onData: (cb: (chunk: string) => void) => void;
  onExit: (cb: (payload: { exitCode: number; signal?: number }) => void) => void;
  write: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
  kill: ReturnType<typeof vi.fn>;
  emitData: (chunk: string) => void;
  emitExit: (payload: { exitCode: number; signal?: number }) => void;
};

function createMockPty(): MockPty {
  let dataCb: ((chunk: string) => void) | null = null;
  let exitCb: ((payload: { exitCode: number; signal?: number }) => void) | null = null;
  return {
    onData: (cb) => {
      dataCb = cb;
    },
    onExit: (cb) => {
      exitCb = cb;
    },
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    emitData: (chunk) => dataCb?.(chunk),
    emitExit: (payload) => exitCb?.(payload),
  };
}

describe('SshAttachBridge', () => {
  it('streams data with monotonic sequence numbers and converts to attach snapshots', async () => {
    const frames: Array<{ data: string; seq: number }> = [];
    const mockPty = createMockPty();
    const spawnPty = vi.fn(() => {
      setTimeout(() => mockPty.emitData('hello'), 0);
      return mockPty as never;
    });

    const bridge = SshAttachBridge.create(
      {
        ssh: { host: 'devbox' },
        terminalId: 'term-1',
        cwd: '/tmp',
        cols: 80,
        rows: 24,
      },
      {
        onData: (data, seq) => frames.push({ data, seq }),
      },
      { spawnPty },
    );

    await new Promise((r) => setTimeout(r, 5));
    expect(frames).toEqual([{ data: 'hello', seq: 1 }]);

    const attach = await bridge.snapshot();
    expect(attach.streamSeq).toBe(1);
    expect(attach.replay).toContain('hello');
    expect(attach.cols).toBe(80);
    expect(attach.rows).toBe(24);
  });

  it('forwards write and resize to the local ssh pty', () => {
    const mockPty = createMockPty();
    const spawnPty = vi.fn(() => mockPty as never);

    const bridge = SshAttachBridge.create(
      {
        ssh: { host: 'devbox' },
        terminalId: 'term-2',
        cwd: '/tmp',
        cols: 80,
        rows: 24,
      },
      { onData: () => undefined },
      { spawnPty },
    );

    bridge.write('ls\r');
    bridge.resize(120, 40);
    expect(mockPty.write).toHaveBeenCalledWith('ls\r');
    expect(mockPty.resize).toHaveBeenCalledWith(120, 40);
  });

  it('treats ssh bridge exit as detach without implying remote tmux exit', () => {
    const mockPty = createMockPty();
    const onBridgeDetach = vi.fn();
    const spawnPty = vi.fn(() => mockPty as never);

    SshAttachBridge.create(
      {
        ssh: { host: 'devbox' },
        terminalId: 'term-3',
        cwd: '/tmp',
        cols: 80,
        rows: 24,
      },
      {
        onData: () => undefined,
        onBridgeDetach,
      },
      { spawnPty },
    );

    mockPty.emitExit({ exitCode: 255 });
    expect(onBridgeDetach).toHaveBeenCalledWith({ exitCode: 255 });
  });
});
