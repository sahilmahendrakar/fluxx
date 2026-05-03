import { describe, expect, it } from 'vitest';
import {
  buildCreatePrInstructionsMarkdown,
  buildTaskAgentPullRequestPrompt,
  buildTaskAgentPullRequestPromptCursorCompact,
  resolveAgentPullRequestBranchContext,
} from './taskAgentPullRequestPrompt';
import type { Task } from './types';

describe('resolveAgentPullRequestBranchContext', () => {
  it('uses task sourceBranch when set, else project default', () => {
    expect(
      resolveAgentPullRequestBranchContext({
        task: {} as Pick<Task, 'sourceBranch'>,
        projectDefaultBranchShort: 'main',
        sessionBranch: 'flux/task-abc',
      }),
    ).toEqual({ baseBranch: 'main', headBranch: 'flux/task-abc' });

    expect(
      resolveAgentPullRequestBranchContext({
        task: { sourceBranch: 'develop' } as Pick<Task, 'sourceBranch'>,
        projectDefaultBranchShort: 'main',
        sessionBranch: 'flux/task-xyz',
      }),
    ).toEqual({ baseBranch: 'develop', headBranch: 'flux/task-xyz' });
  });

  it('maps origin/foo style source to short base', () => {
    expect(
      resolveAgentPullRequestBranchContext({
        task: { sourceBranch: 'origin/feature/x' } as Pick<Task, 'sourceBranch'>,
        projectDefaultBranchShort: 'main',
        sessionBranch: 'flux/task-1',
      }),
    ).toEqual({ baseBranch: 'feature/x', headBranch: 'flux/task-1' });
  });
});

describe('buildCreatePrInstructionsMarkdown', () => {
  it('includes workflow steps and constraints', () => {
    const text = buildCreatePrInstructionsMarkdown();
    expect(text).toContain('git status');
    expect(text).toContain('gh pr create');
    expect(text).toContain('force-push');
    expect(text).toContain('secrets');
  });
});

describe('buildTaskAgentPullRequestPrompt', () => {
  it('includes task id, title, branches, body, instructions path, and cursor needle', () => {
    const instructionsPath = '/tmp/flux-project/agent-instructions/create-pr.md';
    const text = buildTaskAgentPullRequestPrompt({
      taskId: 'task-42',
      taskTitle: 'Fix login bug',
      headBranch: 'flux/task-42',
      baseBranch: 'main',
      prTitle: 'Fix login bug',
      prBody: '_Task_: Fix login bug',
      instructionsAbsolutePath: instructionsPath,
    });
    expect(text).toContain('`task-42`');
    expect(text).toContain('Fix login bug');
    expect(text).toContain('`flux/task-42`');
    expect(text).toContain('`main`');
    expect(text).toContain('`' + instructionsPath + '`');
    expect(text).toContain('Do not commit secrets');
    expect(text).not.toContain('git status');
  });
});

describe('buildTaskAgentPullRequestPromptCursorCompact', () => {
  it('is a single line (avoids Cursor [Pasted N lines] collapse) and keeps key fields', () => {
    const instructionsPath = '/tmp/flux-project/agent-instructions/create-pr.md';
    const text = buildTaskAgentPullRequestPromptCursorCompact({
      taskId: 'task-42',
      taskTitle: 'Fix login bug',
      headBranch: 'flux/task-42',
      baseBranch: 'main',
      prTitle: 'Fix login bug',
      prBody: 'Long\nbody\nhere',
      instructionsAbsolutePath: instructionsPath,
    });
    expect(text).not.toMatch(/\n/);
    expect(text).not.toContain('```');
    expect(text).toContain('`task-42`');
    expect(text).toContain('Fix login bug');
    expect(text).toContain('`flux/task-42`');
    expect(text).toContain('`main`');
    expect(text).toContain(instructionsPath);
  });
});
