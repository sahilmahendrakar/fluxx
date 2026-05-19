import { describe, expect, it } from 'vitest';
import {
  MAX_TASK_HANDOFF_JSON_UTF8_BYTES,
  parseTaskOverseerReviewInput,
  parseTaskWorkerHandoffForCoordination,
  parseTaskWorkerHandoffFromJsonString,
} from './taskAgentHandoff';

describe('parseTaskWorkerHandoffForCoordination', () => {
  it('accepts a minimal valid handoff', () => {
    const r = parseTaskWorkerHandoffForCoordination({
      outcome: 'complete',
      summary: 'Done',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.handoff.outcome).toBe('complete');
      expect(r.handoff.summary).toBe('Done');
      expect(r.handoff.submittedAt).toBeTruthy();
    }
  });

  it('rejects missing summary', () => {
    expect(parseTaskWorkerHandoffForCoordination({ outcome: 'complete' }).ok).toBe(false);
  });

  it('rejects invalid outcome', () => {
    expect(
      parseTaskWorkerHandoffForCoordination({ outcome: 'nope', summary: 'x' }).ok,
    ).toBe(false);
  });

  it('rejects oversized JSON', () => {
    const big = JSON.stringify({
      outcome: 'complete',
      summary: 'x'.repeat(MAX_TASK_HANDOFF_JSON_UTF8_BYTES),
    });
    expect(parseTaskWorkerHandoffFromJsonString(big).ok).toBe(false);
  });
});

describe('parseTaskOverseerReviewInput', () => {
  it('requires rework instructions for rework', () => {
    expect(parseTaskOverseerReviewInput({ decision: 'rework' }).ok).toBe(false);
    const ok = parseTaskOverseerReviewInput({
      decision: 'rework',
      reworkInstructions: 'Fix tests',
    });
    expect(ok.ok).toBe(true);
  });

  it('accepts approve without rework instructions', () => {
    const r = parseTaskOverseerReviewInput({ decision: 'approved', notes: 'LGTM' });
    expect(r.ok).toBe(true);
  });
});
