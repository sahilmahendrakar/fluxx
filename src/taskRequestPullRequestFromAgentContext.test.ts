import { describe, expect, it } from 'vitest';
import {
  mergeTaskRowWithPullRequestAgentPayload,
  parseTaskRequestPullRequestFromAgentPayload,
} from './taskRequestPullRequestFromAgentContext';
import { resolveAgentPullRequestBranchContext } from './taskAgentPullRequestPrompt';
import type { Task } from './types';

describe('parseTaskRequestPullRequestFromAgentPayload', () => {
  it('requires taskId', () => {
    expect(parseTaskRequestPullRequestFromAgentPayload({}).ok).toBe(false);
    expect(parseTaskRequestPullRequestFromAgentPayload({ taskId: '  ' }).ok).toBe(false);
  });

  it('normalizes and accepts a valid sourceBranch', () => {
    const r = parseTaskRequestPullRequestFromAgentPayload({
      taskId: 't1',
      sourceBranch: 'origin/feature/foo',
    });
    expect(r).toEqual({
      ok: true,
      payload: { taskId: 't1', sourceBranch: 'feature/foo' },
    });
  });

  it('rejects an invalid sourceBranch', () => {
    const r = parseTaskRequestPullRequestFromAgentPayload({
      taskId: 't1',
      sourceBranch: 'bad name',
    });
    expect(r.ok).toBe(false);
  });
});

describe('mergeTaskRowWithPullRequestAgentPayload', () => {
  it('prefers local task row fields over payload', () => {
    const row = {
      sourceBranch: 'from-row',
      repoId: 'row-repo',
      createSourceBranchIfMissing: false,
    } as Task;
    const merged = mergeTaskRowWithPullRequestAgentPayload(row, {
      taskId: 'x',
      sourceBranch: 'from-payload',
      repoId: 'pay-repo',
      createSourceBranchIfMissing: true,
    });
    expect(merged).toEqual({
      sourceBranch: 'from-row',
      repoId: 'row-repo',
      createSourceBranchIfMissing: false,
    });
  });

  it('fills branch and repo from payload when no local row (cloud)', () => {
    const merged = mergeTaskRowWithPullRequestAgentPayload(undefined, {
      taskId: 'cloud-1',
      sourceBranch: 'feature/foo',
      repoId: 'service-b',
      createSourceBranchIfMissing: true,
    });
    expect(merged).toEqual({
      sourceBranch: 'feature/foo',
      repoId: 'service-b',
      createSourceBranchIfMissing: true,
    });
  });

  it('fills gaps when local row exists but omits cloud-only fields', () => {
    const row = { title: 'x', sourceBranch: '', repoId: '' } as unknown as Task;
    const merged = mergeTaskRowWithPullRequestAgentPayload(row, {
      taskId: 't',
      sourceBranch: 'develop',
      repoId: 'alt',
    });
    expect(merged.sourceBranch).toBe('develop');
    expect(merged.repoId).toBe('alt');
  });

  it('cloud + branch resolution uses payload source over project default', () => {
    const parsed = parseTaskRequestPullRequestFromAgentPayload({
      taskId: 'c1',
      title: 'T',
      sourceBranch: 'feature/foo',
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const merged = mergeTaskRowWithPullRequestAgentPayload(undefined, parsed.payload);
    expect(
      resolveAgentPullRequestBranchContext({
        task: merged,
        projectDefaultBranchShort: 'main',
        sessionBranch: 'fluxx/task-c1',
      }),
    ).toEqual({ baseBranch: 'feature/foo', headBranch: 'fluxx/task-c1' });
  });

  it('legacy: no row source and no payload source falls back to project default', () => {
    const merged = mergeTaskRowWithPullRequestAgentPayload(undefined, { taskId: 't' });
    expect(
      resolveAgentPullRequestBranchContext({
        task: merged,
        projectDefaultBranchShort: 'release',
        sessionBranch: 'fluxx/task-x',
      }),
    ).toEqual({ baseBranch: 'release', headBranch: 'fluxx/task-x' });
  });
});
