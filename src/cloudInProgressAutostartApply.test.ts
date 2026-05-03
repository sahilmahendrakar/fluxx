import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Task } from './types';
import {
  cloudInProgressAutostartAllowedByAssignee,
  maybeCloudAutoStartSessionOnInProgressTransition,
} from './cloudInProgressAutostartApply';

const base = (t: Partial<Task> & Pick<Task, 'id' | 'title' | 'status'>): Task => ({
  agent: 'cursor',
  createdAt: '2020-01-01',
  projectId: 'p',
  ...t,
});

describe('cloudInProgressAutostartAllowedByAssignee', () => {
  const me = 'user-a';
  const other = 'user-b';

  it('is false without actor', () => {
    expect(
      cloudInProgressAutostartAllowedByAssignee(
        base({ id: '1', title: '', status: 'backlog' }),
        base({ id: '1', title: '', status: 'in-progress', assigneeId: me }),
        null,
      ),
    ).toBe(false);
  });

  it('is false when task was assigned to someone else', () => {
    expect(
      cloudInProgressAutostartAllowedByAssignee(
        base({ id: '1', title: '', status: 'backlog', assigneeId: other }),
        base({ id: '1', title: '', status: 'in-progress', assigneeId: other }),
        me,
      ),
    ).toBe(false);
  });

  it('is true when task was already assigned to the actor', () => {
    expect(
      cloudInProgressAutostartAllowedByAssignee(
        base({ id: '1', title: '', status: 'backlog', assigneeId: me }),
        base({ id: '1', title: '', status: 'in-progress', assigneeId: me }),
        me,
      ),
    ).toBe(true);
  });

  it('is true when unclaimed and fresh task is assigned to the actor', () => {
    expect(
      cloudInProgressAutostartAllowedByAssignee(
        base({ id: '1', title: '', status: 'backlog' }),
        base({ id: '1', title: '', status: 'in-progress', assigneeId: me }),
        me,
      ),
    ).toBe(true);
  });

  it('is false when unclaimed but fresh task still has no assignee', () => {
    expect(
      cloudInProgressAutostartAllowedByAssignee(
        base({ id: '1', title: '', status: 'backlog' }),
        base({ id: '1', title: '', status: 'in-progress' }),
        me,
      ),
    ).toBe(false);
  });
});

describe('maybeCloudAutoStartSessionOnInProgressTransition', () => {
  const me = 'user-a';
  const getAutoStart = vi.fn();
  const startSession = vi.fn();

  const autostartCtx = () => ({
    source: 'test',
    inFlight: new Set<string>(),
    logError: vi.fn(),
    actorUid: me,
  });

  beforeEach(() => {
    getAutoStart.mockResolvedValue(true);
    startSession.mockResolvedValue({});
    vi.stubGlobal('window', {
      electronAPI: {
        project: { getAutoStartSessionOnInProgress: getAutoStart },
        sessions: { start: startSession },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('calls sessions.start on backlog → in-progress when project setting is on', async () => {
    const prev = base({ id: '1', title: '', status: 'backlog', assigneeId: me });
    const next = base({ id: '1', title: '', status: 'in-progress', assigneeId: me });
    await maybeCloudAutoStartSessionOnInProgressTransition(prev, next, [next], autostartCtx());
    expect(getAutoStart).toHaveBeenCalled();
    expect(startSession).toHaveBeenCalled();
  });

  it('does not read setting or start session for needs-input → in-progress', async () => {
    const prev = base({ id: '1', title: '', status: 'needs-input', assigneeId: me });
    const next = base({ id: '1', title: '', status: 'in-progress', assigneeId: me });
    await maybeCloudAutoStartSessionOnInProgressTransition(prev, next, [next], autostartCtx());
    expect(getAutoStart).not.toHaveBeenCalled();
    expect(startSession).not.toHaveBeenCalled();
  });

  it('does not read setting or start session for review → in-progress', async () => {
    const prev = base({ id: '1', title: '', status: 'review', assigneeId: me });
    const next = base({ id: '1', title: '', status: 'in-progress', assigneeId: me });
    await maybeCloudAutoStartSessionOnInProgressTransition(prev, next, [next], autostartCtx());
    expect(getAutoStart).not.toHaveBeenCalled();
    expect(startSession).not.toHaveBeenCalled();
  });

  it('does not read setting or start session for done → in-progress', async () => {
    const prev = base({ id: '1', title: '', status: 'done', assigneeId: me });
    const next = base({ id: '1', title: '', status: 'in-progress', assigneeId: me });
    await maybeCloudAutoStartSessionOnInProgressTransition(prev, next, [next], autostartCtx());
    expect(getAutoStart).not.toHaveBeenCalled();
    expect(startSession).not.toHaveBeenCalled();
  });
});
