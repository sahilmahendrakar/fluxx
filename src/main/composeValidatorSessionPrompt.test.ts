import { describe, expect, it } from 'vitest';
import type { Task } from '../types';
import { composeValidatorSessionPrompt } from './composeValidatorSessionPrompt';

describe('composeValidatorSessionPrompt', () => {
  const task: Task = {
    id: 'task-1',
    title: 'Validator launch flow',
    description: [
      'Implement validator agent launch.',
      '',
      '## Acceptance Criteria',
      '',
      '- Task in Review can start a validator session',
      '- Validator writes verdict.json under the run directory',
    ].join('\n'),
    status: 'review',
    agent: 'cursor',
    projectId: 'proj-1',
    orderKey: 'a',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  it('includes task context, rules, artifact contract, and pack instructions', () => {
    const prompt = composeValidatorSessionPrompt({
      task,
      run: {
        id: 'run-abc',
        artifactDir: '/tmp/project/validation-runs/run-abc',
        packId: 'electron-playwright',
        validatorAgent: 'cursor',
      },
      worktreeCwd: '/tmp/worktrees/task-1',
      instructionsMarkdown: '## Skill\nLaunch Electron with Playwright.',
      verdictSchemaJson: '{ "verdict": "passed" }',
      changeSummary: '### git status\n M src/main.ts',
    });

    expect(prompt).toContain('Validator launch flow');
    expect(prompt).toContain('### Acceptance criteria');
    expect(prompt).toContain('Task in Review can start a validator session');
    expect(prompt).toContain('Do **not** implement product source changes');
    expect(prompt).toContain('Infer launch from the project');
    expect(prompt).toContain('package.json');
    expect(prompt).not.toContain('pnpm run build:validation');
    expect(prompt).toContain('/tmp/project/validation-runs/run-abc');
    expect(prompt).toContain('verdict.json');
    expect(prompt).toContain('fluxx validation finish');
    expect(prompt).toContain('FLUXX_VALIDATION_RUN_ID');
    expect(prompt).toContain('Launch Electron with Playwright');
    expect(prompt).toContain('M src/main.ts');
  });

  it('uses saved launch command and ready config when project config is set', () => {
    const prompt = composeValidatorSessionPrompt({
      task,
      run: {
        id: 'run-abc',
        artifactDir: '/tmp/project/validation-runs/run-abc',
        packId: 'electron-playwright',
        validatorAgent: 'cursor',
      },
      worktreeCwd: '/tmp/worktrees/task-1',
      instructionsMarkdown: 'Pack skill',
      verdictSchemaJson: '{ "verdict": "passed" }',
      projectConfig: {
        launchCommand: 'pnpm start:aux',
        ready: { type: 'selector', value: "[data-testid='app-shell']", timeoutMs: 120_000 },
        cleanUserData: true,
      },
    });

    expect(prompt).toContain('pnpm start:aux');
    expect(prompt).toContain("[data-testid='app-shell']");
    expect(prompt).toContain('isolated user-data directory');
    expect(prompt).not.toContain('Infer launch from the project');
    expect(prompt).not.toContain('pnpm run build:validation');
  });

  it('includes Project validation notes when appendPrompt is set', () => {
    const prompt = composeValidatorSessionPrompt({
      task,
      run: {
        id: 'run-abc',
        artifactDir: '/tmp/project/validation-runs/run-abc',
        packId: 'electron-playwright',
        validatorAgent: 'cursor',
      },
      worktreeCwd: '/tmp/worktrees/task-1',
      instructionsMarkdown: 'Pack skill',
      verdictSchemaJson: '{ "verdict": "passed" }',
      projectConfig: {
        appendPrompt: 'Always open Settings before asserting sync.',
      },
    });

    expect(prompt).toContain('## Project validation notes');
    expect(prompt).toContain('Always open Settings before asserting sync.');
    expect(prompt.indexOf('## Pack instructions')).toBeLessThan(
      prompt.indexOf('## Project validation notes'),
    );
    expect(prompt).toContain('Infer launch from the project');
  });

  it('omits Project validation notes when appendPrompt is empty', () => {
    const prompt = composeValidatorSessionPrompt({
      task,
      run: {
        id: 'run-abc',
        artifactDir: '/tmp/project/validation-runs/run-abc',
        packId: 'electron-playwright',
        validatorAgent: 'cursor',
      },
      worktreeCwd: '/tmp/worktrees/task-1',
      instructionsMarkdown: 'Pack skill',
      verdictSchemaJson: '{ "verdict": "passed" }',
      projectConfig: {
        launchCommand: 'pnpm start',
        appendPrompt: '   ',
      },
    });

    expect(prompt).not.toContain('## Project validation notes');
  });

  it('includes validation plan content and required artifacts when present', () => {
    const prompt = composeValidatorSessionPrompt({
      task,
      run: {
        id: 'run-abc',
        artifactDir: '/tmp/project/validation-runs/run-abc',
        packId: 'electron-playwright',
        validatorAgent: 'cursor',
      },
      worktreeCwd: '/tmp/worktrees/task-1',
      instructionsMarkdown: 'Pack skill',
      verdictSchemaJson: '{ "verdict": "passed" }',
      validationPlan: {
        goal: 'Verify validation tab',
        pack: 'electron-playwright',
        checks: ['Open task details', 'Confirm Validation tab'],
        requiredArtifacts: ['task-detail-validation'],
      },
    });

    expect(prompt).toContain('Verify validation tab');
    expect(prompt).toContain('Confirm Validation tab');
    expect(prompt).toContain('task-detail-validation');
  });

  it('surfaces invalid plan warnings without blocking prompt generation', () => {
    const prompt = composeValidatorSessionPrompt({
      task,
      run: {
        id: 'run-abc',
        artifactDir: '/tmp/project/validation-runs/run-abc',
        packId: 'electron-playwright',
        validatorAgent: 'cursor',
      },
      worktreeCwd: '/tmp/worktrees/task-1',
      instructionsMarkdown: 'Pack skill',
      verdictSchemaJson: '{ "verdict": "passed" }',
      validationPlanWarning: 'Task validation plan is invalid and was ignored: missing goal',
    });
    expect(prompt).toContain('Validation plan warning');
    expect(prompt).toContain('invalid and was ignored');
  });
});
