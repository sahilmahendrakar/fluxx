import { describe, expect, it } from 'vitest';
import {
  buildCreatePrInstructionsMarkdown,
  buildTaskAgentPullRequestPrompt,
  resolveAgentPullRequestBranchContext,
} from './taskAgentPullRequestPrompt';
import type { Task } from './types';

describe('resolveAgentPullRequestBranchContext', () => {
  it('uses task sourceBranch when set, else per-repo project default', () => {
    expect(
      resolveAgentPullRequestBranchContext({
        task: {} as Pick<Task, 'sourceBranch'>,
        projectDefaultBranchShort: 'main',
        sessionBranch: 'flux/task-abc',
      }),
    ).toEqual({ baseBranch: 'main', headBranch: 'flux/task-abc' });

    expect(
      resolveAgentPullRequestBranchContext({
        task: {} as Pick<Task, 'sourceBranch'>,
        projectDefaultBranchShort: 'release',
        sessionBranch: 'flux/task-abc',
      }),
    ).toEqual({ baseBranch: 'release', headBranch: 'flux/task-abc' });

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
    expect(text).toContain('# Fluxx: GitHub pull request from the task agent');
    expect(text).toContain('Fluxx app');
    expect(text).not.toMatch(/\bFlux\b/);
    expect(text).toContain('git status');
    expect(text).toContain('gh pr create');
    expect(text).toContain('force-push');
    expect(text).toContain('secrets');
    expect(text).toContain('origin');
    expect(text).toContain('PR base branch');
    expect(text).toContain('Never force-push the base branch');
  });
});

describe('buildTaskAgentPullRequestPrompt', () => {
  it('includes repository label and clone path with head and base branches for multi-repo clarity', () => {
    const instructionsPath = '/tmp/flux-project/agent-instructions/create-pr.md';
    const text = buildTaskAgentPullRequestPrompt({
      taskId: 'task-b',
      taskTitle: 'Backend fix',
      headBranch: 'flux/task-b',
      baseBranch: 'develop',
      instructionsAbsolutePath: instructionsPath,
      repoDisplayLabel: 'service-b',
      repoRootPath: '/Users/me/projects/service-b',
    });
    expect(text).toContain('## Fluxx: open a GitHub pull request for this task');
    expect(text).not.toMatch(/\bFlux\b/);
    expect(text).toContain('- **Repository:** service-b');
    expect(text).toContain('`/Users/me/projects/service-b`');
    expect(text).toContain('`flux/task-b`');
    expect(text).toContain('`develop`');
    expect(text).not.toContain('`main`');
    expect(text).not.toContain('Suggested PR');
  });

  it('includes task id, title, branches, instructions path, and constraints', () => {
    const instructionsPath = '/tmp/flux-project/agent-instructions/create-pr.md';
    const text = buildTaskAgentPullRequestPrompt({
      taskId: 'task-42',
      taskTitle: 'Fix login bug',
      headBranch: 'flux/task-42',
      baseBranch: 'main',
      instructionsAbsolutePath: instructionsPath,
    });
    expect(text).toContain('`task-42`');
    expect(text).toContain('Fix login bug');
    expect(text).toContain('`flux/task-42`');
    expect(text).toContain('`main`');
    expect(text).toContain('`' + instructionsPath + '`');
    expect(text).toContain('Do not commit secrets');
    expect(text).not.toContain('git status');
    expect(text).not.toContain('Suggested PR');
    expect(text).not.toContain('```');
  });
});
