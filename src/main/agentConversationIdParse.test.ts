import { describe, expect, it } from 'vitest';
import {
  appendConversationParseBuffer,
  parseAgentConversationId,
  parseClaudeConversationId,
  parseCodexConversationId,
  parseCursorConversationId,
  stripTerminalControlSequences,
} from './agentConversationIdParse';
import codexExitHintTail from './fixtures/codex-exit-hint-pty-tail.txt?raw';
import codexJsonlTail from './fixtures/codex-jsonl-session-id-pty-tail.txt?raw';
import codexThreadRenameTail from './fixtures/codex-thread-rename-pty-tail.txt?raw';

describe('parseCursorConversationId', () => {
  it('parses resume hint line', () => {
    const text =
      'Some banner\nTo resume this session: agent --resume=17bbdd09-92ba-4bdb-9870-5ccec471226c\n';
    expect(parseCursorConversationId(text)).toBe('17bbdd09-92ba-4bdb-9870-5ccec471226c');
  });

  it('parses spaced argv form', () => {
    expect(parseCursorConversationId('Run: agent --resume 2a3f4b5c-6d7e-8901-bcde-f123456789ab')).toBe(
      '2a3f4b5c-6d7e-8901-bcde-f123456789ab',
    );
  });

  it('parses json session_id', () => {
    const line = '{"type":"result","session_id":"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"}\n';
    expect(parseCursorConversationId(line)).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  });

  it('returns undefined for unrelated text', () => {
    expect(parseCursorConversationId('hello world')).toBeUndefined();
    expect(parseCursorConversationId('agent --resume')).toBeUndefined();
  });
});

describe('parseClaudeConversationId', () => {
  it('parses claude --resume uuid', () => {
    expect(
      parseClaudeConversationId('Tip: claude --resume ffffffff-1111-2222-3333-444444444444'),
    ).toBe('ffffffff-1111-2222-3333-444444444444');
  });

  it('parses labeled session id', () => {
    expect(parseClaudeConversationId('Session ID: aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')).toBe(
      'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    );
  });

  it('returns undefined when no id', () => {
    expect(parseClaudeConversationId('Starting Claude Code…')).toBeUndefined();
  });
});

describe('parseCodexConversationId', () => {
  it('parses exit hint from recorded PTY tail fixture', () => {
    expect(parseCodexConversationId(codexExitHintTail)).toBe(
      '019c2f73-78db-72a1-b16e-bb7527184391',
    );
  });

  it('parses JSON session_id from recorded PTY tail fixture', () => {
    expect(parseCodexConversationId(codexJsonlTail)).toBe(
      '17bbdd09-92ba-4bdb-9870-5ccec471226c',
    );
  });

  it('parses thread rename resume hint from recorded PTY tail fixture', () => {
    expect(parseCodexConversationId(codexThreadRenameTail)).toBe(
      'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    );
  });

  it('parses spaced codex resume argv form', () => {
    expect(parseCodexConversationId('Run: codex resume 2a3f4b5c-6d7e-8901-bcde-f123456789ab')).toBe(
      '2a3f4b5c-6d7e-8901-bcde-f123456789ab',
    );
  });

  it('parses labeled Reviewed Codex session id line', () => {
    expect(
      parseCodexConversationId('Reviewed Codex session id: ffffffff-1111-2222-3333-444444444444'),
    ).toBe('ffffffff-1111-2222-3333-444444444444');
  });

  it('strips OSC/CSI before matching exit hints', () => {
    const wrapped = `\x1b]0;codex\x07To continue this session, run codex resume ${'bbbbbbbb-cccc-dddd-eeee-ffffffffffff'}`;
    expect(parseCodexConversationId(wrapped)).toBe('bbbbbbbb-cccc-dddd-eeee-ffffffffffff');
    expect(stripTerminalControlSequences(wrapped)).toContain('To continue this session');
  });

  it('returns undefined for generic resume hint without uuid', () => {
    expect(
      parseCodexConversationId('You can resume a previous conversation by running `codex resume`'),
    ).toBeUndefined();
    expect(parseCodexConversationId('codex resume')).toBeUndefined();
  });
});

describe('parseAgentConversationId', () => {
  it('routes codex agent type to parseCodexConversationId', () => {
    expect(
      parseAgentConversationId(
        'codex',
        'To continue this session, run codex resume 019c2f73-78db-72a1-b16e-bb7527184391',
      ),
    ).toBe('019c2f73-78db-72a1-b16e-bb7527184391');
  });
});

describe('appendConversationParseBuffer', () => {
  it('caps length', () => {
    const a = 'x'.repeat(10);
    const b = appendConversationParseBuffer(a, 'y'.repeat(100), 50);
    expect(b.length).toBe(50);
  });
});
