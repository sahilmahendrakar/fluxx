import { describe, expect, it } from 'vitest';
import type { PlanningSession } from './types';
import {
  buildPlanningResumePayload,
  buildPlanningStartPayload,
} from './planningSessionStartPayload';

const modelIds = {
  cursor: 'auto',
  'claude-code': 'claude-sonnet-4-6',
  codex: 'gpt-5.4',
};

describe('buildPlanningStartPayload', () => {
  it('passes codex agentModel and YOLO', () => {
    expect(
      buildPlanningStartPayload({
        agent: 'codex',
        modelIds,
        planningYolo: true,
      }),
    ).toEqual({
      agent: 'codex',
      agentModel: 'gpt-5.4',
      agentYolo: true,
    });
  });

  it('passes empty codex agentModel when unset', () => {
    expect(
      buildPlanningStartPayload({
        agent: 'codex',
        modelIds: { ...modelIds, codex: '' },
        planningYolo: false,
      }),
    ).toEqual({
      agent: 'codex',
      agentModel: '',
      agentYolo: false,
    });
  });

  it('preserves cursor and claude payloads', () => {
    expect(
      buildPlanningStartPayload({
        agent: 'cursor',
        modelIds,
        planningYolo: false,
      }),
    ).toEqual({
      agent: 'cursor',
      agentModel: 'auto',
      agentYolo: false,
    });
  });
});

describe('buildPlanningResumePayload', () => {
  const session = {
    id: 'sess-1',
    agent: 'codex',
  } as PlanningSession;

  it('includes codex agentModel on resume', () => {
    expect(
      buildPlanningResumePayload(session, {
        modelIds,
        planningYolo: true,
      }),
    ).toEqual({
      agent: 'codex',
      agentModel: 'gpt-5.4',
      agentYolo: true,
      resume: true,
      sessionId: 'sess-1',
    });
  });
});
