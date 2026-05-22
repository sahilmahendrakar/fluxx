import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

describe('fluxx-tmux-spawn launcher', () => {
  const wrapperPath = path.resolve(process.cwd(), 'scripts', 'fluxx-tmux-spawn.sh');

  it('execs command with spaces, quotes, and empty args via JSON spec', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fluxx-spawn-launcher-'));
    const specPath = path.join(dir, 'spec.json');
    const echoScript = path.join(dir, 'echo-args.cjs');
    await fs.writeFile(
      echoScript,
      [
        "'use strict';",
        'process.stdout.write(JSON.stringify({',
        '  args: process.argv.slice(2),',
        '  cwd: process.cwd(),',
        '  foo: process.env.FOO,',
        '}));',
      ].join('\n'),
      'utf8',
    );
    await fs.writeFile(
      specPath,
      JSON.stringify({
        command: process.execPath,
        args: [echoScript, 'hello world', '', 'say "hi"'],
        cwd: dir,
        env: { FOO: 'bar baz' },
      }),
      'utf8',
    );

    const { stdout } = await execFileAsync(wrapperPath, [specPath], {
      cwd: dir,
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        FLUXX_ELECTRON_EXE: process.execPath,
      },
    });
    const parsed = JSON.parse(stdout.trim()) as {
      args: string[];
      cwd: string;
      foo: string;
    };
    expect(parsed.args).toEqual(['hello world', '', 'say "hi"']);
    expect(fsSync.realpathSync(parsed.cwd)).toBe(fsSync.realpathSync(dir));
    expect(parsed.foo).toBe('bar baz');
  });
});
