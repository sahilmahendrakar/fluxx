import { describe, expect, it } from 'vitest';
import { buildFluxxTmuxSessionName, isFluxxTmuxSessionName } from './tmuxSessionName';

describe('buildFluxxTmuxSessionName', () => {
  it('prefixes fluxx, kind, project slug, and terminal id fragment', () => {
    const name = buildFluxxTmuxSessionName({
      kind: 'task',
      projectSlugSource: 'My Cool Project!',
      terminalId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(name.startsWith('fluxx-task-')).toBe(true);
    expect(name).toContain('my-cool-project');
    expect(name.endsWith('550e8400e29b')).toBe(true);
    expect(isFluxxTmuxSessionName(name)).toBe(true);
  });

  it('handles spaces and shell metacharacters in project slug source safely', () => {
    const name = buildFluxxTmuxSessionName({
      kind: 'shell',
      projectSlugSource: 'a;b|c$d`e',
      terminalId: 'abc',
    });
    expect(name).toMatch(/^fluxx-shell-[a-z0-9-]+-[a-z0-9]+$/);
    expect(name).not.toContain(';');
    expect(name).not.toContain('|');
  });
});
