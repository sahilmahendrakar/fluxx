import { createRequire } from 'node:module';
import net from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const {
  DEFAULT_START_PORT,
  findAvailablePort,
  parsePositiveInt,
} = require('../../scripts/start-aux.cjs') as {
  DEFAULT_START_PORT: number;
  findAvailablePort: (startPort: number, maxAttempts: number) => Promise<number>;
  parsePositiveInt: (raw: string | undefined, fallback: number) => number;
};

describe('start-aux port selection', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('parsePositiveInt', () => {
    it('returns fallback for missing or invalid values', () => {
      expect(parsePositiveInt(undefined, DEFAULT_START_PORT)).toBe(5180);
      expect(parsePositiveInt('not-a-number', DEFAULT_START_PORT)).toBe(5180);
      expect(parsePositiveInt('0', DEFAULT_START_PORT)).toBe(5180);
      expect(parsePositiveInt('-1', DEFAULT_START_PORT)).toBe(5180);
      expect(parsePositiveInt('5180.5', DEFAULT_START_PORT)).toBe(5180);
    });

    it('returns parsed positive integers', () => {
      expect(parsePositiveInt('5181', DEFAULT_START_PORT)).toBe(5181);
      expect(parsePositiveInt('9000', DEFAULT_START_PORT)).toBe(9000);
    });
  });

  describe('findAvailablePort', () => {
    it('returns the start port when it is free', async () => {
      vi.spyOn(net, 'createServer').mockImplementation(() => {
        const server = {
          unref: vi.fn(),
          once: vi.fn(),
          listen: vi.fn((_opts: unknown, cb?: () => void) => {
            cb?.();
          }),
          close: vi.fn((cb?: () => void) => {
            cb?.();
          }),
        };
        return server as unknown as net.Server;
      });

      await expect(findAvailablePort(5180, 32)).resolves.toBe(5180);
    });

    it('scans forward when the start port is occupied', async () => {
      vi.spyOn(net, 'createServer').mockImplementation(() => {
        let listenPort = 0;
        const server = {
          unref: vi.fn(),
          once: vi.fn((_event: string, handler: () => void) => {
            server._onError = handler;
          }),
          listen: vi.fn((opts: { port: number }, cb?: () => void) => {
            listenPort = opts.port;
            if (listenPort === 5180) {
              server._onError?.();
              return;
            }
            cb?.();
          }),
          close: vi.fn((cb?: () => void) => {
            cb?.();
          }),
          _onError: undefined as (() => void) | undefined,
        };
        return server as unknown as net.Server;
      });

      await expect(findAvailablePort(5180, 32)).resolves.toBe(5181);
    });

    it('throws when no port is free within the attempt range', async () => {
      vi.spyOn(net, 'createServer').mockImplementation(() => {
        const server = {
          unref: vi.fn(),
          once: vi.fn((_event: string, handler: () => void) => {
            server._onError = handler;
          }),
          listen: vi.fn((_opts: unknown) => {
            server._onError?.();
          }),
          close: vi.fn((cb?: () => void) => {
            cb?.();
          }),
          _onError: undefined as (() => void) | undefined,
        };
        return server as unknown as net.Server;
      });

      await expect(findAvailablePort(5180, 3)).rejects.toThrow(
        'No free port in range 5180–5182.',
      );
    });
  });
});
