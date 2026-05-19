/**
 * Manual QA (planning resume UI):
 * 1. Start planning, interact until a resume id appears, hard-quit Fluxx, reopen — cold interrupted tab + Resume.
 * 2. Start planning, Ctrl+C or let the agent exit — warm stopped/error tab keeps terminal output + bottom Resume bar.
 * 3. Resume spawns a live session, focuses it, and removes the old row.
 * 4. Start new uses header agent/model prefs.
 * 5. Dismiss (×) archives the offer.
 */
import { describe, expect, it } from 'vitest';
import type { PlanningSession } from '../types';
import {
  isPlanningSessionResumable,
  planningAgentSupportsCliResume,
  planningResumeButtonTitle,
  planningResumeStateDetail,
  planningResumeStateHeading,
  planningSessionHasWarmTerminal,
  planningTabLabel,
} from './planningResumeUi';

const interrupted: PlanningSession = {
  id: 'plan-1',
  projectId: 'proj-1',
  agent: 'claude-code',
  planningDir: '/tmp/planning',
  status: 'interrupted',
  startedAt: '2026-01-01T00:00:00.000Z',
  stoppedAt: '2026-01-01T01:00:00.000Z',
};

const warmStopped: PlanningSession = {
  ...interrupted,
  status: 'stopped',
};

describe('planningResumeUi', () => {
  it('treats interrupted and warm stopped/error rows as resumable', () => {
    expect(isPlanningSessionResumable(interrupted)).toBe(true);
    expect(isPlanningSessionResumable(warmStopped)).toBe(true);
    expect(isPlanningSessionResumable({ ...interrupted, status: 'error' })).toBe(true);
    expect(isPlanningSessionResumable({ ...interrupted, status: 'running' })).toBe(false);
  });

  it('detects warm terminal attach for running and after exit', () => {
    expect(planningSessionHasWarmTerminal({ ...interrupted, status: 'running' })).toBe(
      true,
    );
    expect(planningSessionHasWarmTerminal(warmStopped)).toBe(true);
    expect(planningSessionHasWarmTerminal(interrupted)).toBe(false);
  });

  it('uses different copy for cold vs warm resume states', () => {
    expect(planningResumeStateHeading(interrupted)).toContain('interrupted');
    expect(planningResumeStateHeading(warmStopped)).toContain('ended');
    expect(planningResumeStateDetail(warmStopped)).toContain('exited');
  });

  it('explains captured resume id vs bare resume in tooltip copy', () => {
    expect(planningResumeButtonTitle('conv-abc')).toContain('--resume <id>');
    expect(planningResumeButtonTitle()).toContain('(--resume)');
  });

  it('labels tabs with plan index and agent name', () => {
    expect(planningTabLabel(interrupted, 0)).toBe('Plan 1 · Claude Code');
  });

  it('matches task resume agent support set', () => {
    expect(planningAgentSupportsCliResume('claude-code')).toBe(true);
    expect(planningAgentSupportsCliResume('cursor')).toBe(true);
    expect(planningAgentSupportsCliResume('codex')).toBe(true);
  });
});
