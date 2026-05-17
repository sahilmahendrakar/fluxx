import { describe, expect, it, vi, afterEach } from 'vitest';
import { EXIT_OK, runFluxCli } from './main';

describe('flux CLI --help', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints tasks create flags including dependencies', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const code = await runFluxCli(['tasks', 'create', '--help']);
    expect(code).toBe(EXIT_OK);
    const out = write.mock.calls.map((c) => String(c[0])).join('');
    expect(out).toContain('--depends-on-task-id');
    expect(out).toContain('--label');
    expect(out).toContain('--source-branch');
    expect(out).not.toContain('requires --title');
  });

  it('prints tasks update flags including clear-dependencies', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const code = await runFluxCli(['tasks', 'update', '--help']);
    expect(code).toBe(EXIT_OK);
    const out = write.mock.calls.map((c) => String(c[0])).join('');
    expect(out).toContain('--depends-on-task-id');
    expect(out).toContain('--clear-dependencies');
  });
});
