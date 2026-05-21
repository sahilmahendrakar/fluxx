import { describe, expect, it } from 'vitest';
import type { PlanningSession } from '../types';
import {
  mergePlanningSessionsWithColdResume,
  parsePlanningStartPayload,
} from './planningColdRestore';

describe('parsePlanningStartPayload', () => {
  it('accepts legacy agent-only payload', () => {
    expect(parsePlanningStartPayload('cursor')).toEqual({ agent: 'cursor' });
  });

  it('accepts structured start payload', () => {
    expect(
      parsePlanningStartPayload({
        agent: 'claude-code',
        agentModel: 'sonnet',
        agentYolo: true,
      }),
    ).toEqual({
      agent: 'claude-code',
      agentModel: 'sonnet',
      agentYolo: true,
    });
  });

  it('accepts initial prompt on structured start payload', () => {
    expect(
      parsePlanningStartPayload({
        agent: 'cursor',
        initialPrompt: 'Plan the onboarding flow',
      }),
    ).toEqual({
      agent: 'cursor',
      initialPrompt: 'Plan the onboarding flow',
    });
  });

  it('accepts resume payload with session id only', () => {
    expect(
      parsePlanningStartPayload({ resume: true, sessionId: 'plan-old' }),
    ).toEqual({ resume: true, sessionId: 'plan-old' });
  });

  it('accepts resume payload with agent override', () => {
    expect(
      parsePlanningStartPayload({
        resume: true,
        sessionId: 'plan-old',
        agent: 'cursor',
      }),
    ).toEqual({ agent: 'cursor', resume: true, sessionId: 'plan-old' });
  });

  it('rejects resume without session id or agent', () => {
    expect(parsePlanningStartPayload({ resume: true })).toBeNull();
  });
});

describe('mergePlanningSessionsWithColdResume', () => {
  const live: PlanningSession = {
    id: 'live-1',
    projectId: 'p1',
    agent: 'cursor',
    planningDir: '/proj/planning',
    status: 'running',
    startedAt: '2026-01-01T00:00:00.000Z',
  };

  const cold: PlanningSession = {
    id: 'cold-1',
    projectId: 'p1',
    agent: 'claude-code',
    planningDir: '/proj/planning',
    status: 'interrupted',
    startedAt: '2025-12-01T00:00:00.000Z',
    stoppedAt: '2025-12-01T01:00:00.000Z',
  };

  it('appends cold rows not present in live list', () => {
    expect(mergePlanningSessionsWithColdResume([live], [cold])).toEqual([live, cold]);
  });

  it('drops duplicate cold row when live session shares id', () => {
    const coldDup = { ...cold, id: 'live-1', status: 'interrupted' as const };
    expect(mergePlanningSessionsWithColdResume([live], [coldDup])).toEqual([live]);
  });
});
