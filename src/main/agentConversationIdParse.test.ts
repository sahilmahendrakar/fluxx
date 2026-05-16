import { describe, expect, it } from 'vitest';
import {
  appendConversationParseBuffer,
  parseClaudeConversationId,
  parseCursorConversationId,
} from './agentConversationIdParse';

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

describe('appendConversationParseBuffer', () => {
  it('caps length', () => {
    const a = 'x'.repeat(10);
    const b = appendConversationParseBuffer(a, 'y'.repeat(100), 50);
    expect(b.length).toBe(50);
  });
});
