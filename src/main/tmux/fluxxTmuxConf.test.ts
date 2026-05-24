import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FLUXX_TMUX_CLIPBOARD_PIPE_COMMAND } from './fluxxTmuxClipboardPipe';

describe('fluxx-tmux.conf clipboard bindings', () => {
  it('keeps copy-pipe command aligned with fluxxTmuxClipboardPipe.ts', () => {
    const confPath = path.resolve(process.cwd(), 'resources', 'fluxx-tmux.conf');
    const conf = fs.readFileSync(confPath, 'utf8');
    expect(conf).toContain(`set -g @fluxx_clipboard_pipe "${FLUXX_TMUX_CLIPBOARD_PIPE_COMMAND}"`);
    expect(conf).toContain(
      'bind-key -T copy-mode-vi MouseDragEnd1Pane send-keys -X copy-pipe-and-cancel "#{@fluxx_clipboard_pipe}"',
    );
    expect(conf).toContain(
      'bind-key -T copy-mode MouseDragEnd1Pane send-keys -X copy-pipe-and-cancel "#{@fluxx_clipboard_pipe}"',
    );
    expect(conf).toContain('set -g mouse on');
    expect(conf).toContain('bind -n WheelUpPane');
  });
});
