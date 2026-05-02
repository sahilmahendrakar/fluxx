import { describe, it, expect, vi } from 'vitest';
import type { IpcRenderer, IpcRendererEvent } from 'electron';
import { ipcSubscribe } from './ipcSubscribe';

type Listener = Parameters<IpcRenderer['on']>[1];

function createMockIpc(): Pick<IpcRenderer, 'on' | 'removeListener'> & {
  emit(channel: string, ...args: unknown[]): void;
  listenerCount(channel: string): number;
} {
  const map = new Map<string, Set<Listener>>();
  return {
    on(channel: string, listener: Listener) {
      let set = map.get(channel);
      if (!set) {
        set = new Set();
        map.set(channel, set);
      }
      set.add(listener);
      return undefined as unknown as IpcRenderer;
    },
    removeListener(channel: string, listener: Listener) {
      map.get(channel)?.delete(listener);
      return undefined as unknown as IpcRenderer;
    },
    emit(channel: string, ...args: unknown[]) {
      const ev = {} as IpcRendererEvent;
      for (const fn of map.get(channel) ?? []) {
        fn(ev, ...args);
      }
    },
    listenerCount(channel: string) {
      return map.get(channel)?.size ?? 0;
    },
  };
}

describe('ipcSubscribe', () => {
  it('removes only its listener so co-subscribers keep receiving', () => {
    const ipc = createMockIpc();
    const h1 = vi.fn() as Listener;
    const h2 = vi.fn() as Listener;
    const unsub1 = ipcSubscribe(ipc, 'session:data:abc', h1);
    ipcSubscribe(ipc, 'session:data:abc', h2);
    expect(ipc.listenerCount('session:data:abc')).toBe(2);

    unsub1();
    expect(ipc.listenerCount('session:data:abc')).toBe(1);

    ipc.emit('session:data:abc', 'payload');
    expect(h1).not.toHaveBeenCalled();
    expect(h2).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledWith(expect.anything(), 'payload');
  });
});
