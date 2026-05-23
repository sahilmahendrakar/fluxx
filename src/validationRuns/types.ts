import type { Agent } from '../types';

export type ValidationRunStatus =
  | 'queued'
  | 'running'
  | 'passed'
  | 'failed'
  | 'needs-human-review'
  | 'errored'
  | 'cancelled';

import type { ValidationPackId } from '../validationPacks/types';

export type { ValidationPackId };

export type ValidationArtifactKind =
  | 'screenshot'
  | 'video'
  | 'trace'
  | 'console-log'
  | 'text'
  | 'json';

/** Persisted artifact row (relative `path` is within the run directory). */
export interface ValidationArtifact {
  id: string;
  kind: ValidationArtifactKind;
  label: string;
  path: string;
  createdAt: string;
}

export type ValidationArtifactFileState = 'present' | 'missing' | 'unreadable';

/** Artifact metadata enriched for UI consumers. */
export interface ValidationArtifactView extends ValidationArtifact {
  fileState: ValidationArtifactFileState;
}

export interface ValidationRunGitGuardrails {
  preValidationGitStatus?: string;
  postValidationGitStatus?: string;
  gitStatusDriftDetected?: boolean;
}

export interface ValidationRun {
  id: string;
  taskId: string;
  projectId: string;
  repoId?: string;
  packId: ValidationPackId;
  status: ValidationRunStatus;
  validatorAgent: Agent;
  startedAt: string;
  completedAt?: string;
  summary?: string;
  verdictReason?: string;
  /** Absolute path to `<fluxxProjectDir>/validation-runs/<runId>/`. */
  artifactDir: string;
  artifacts: ValidationArtifactView[];
  /** Daemon session id for the independent validator agent PTY. */
  validatorSessionId?: string;
  /** Task worktree cwd used for Playwright launch during validation. */
  worktreeCwd?: string;
  /** Pre/post `git status --porcelain` captured for source-edit guardrails. */
  gitGuardrails?: ValidationRunGitGuardrails;
}

export type ValidationRunCreateInput = {
  taskId: string;
  projectId: string;
  repoId?: string;
  packId?: ValidationPackId;
  validatorAgent: Agent;
  /** Task worktree cwd for Playwright launch (optional; defaults from project config). */
  worktreeCwd?: string;
};

export type ValidationRunStatusUpdate = {
  runId: string;
  status: ValidationRunStatus;
  summary?: string;
  verdictReason?: string;
  completedAt?: string;
};

export type ValidationArtifactRegisterInput = {
  runId: string;
  kind: ValidationArtifactKind;
  label: string;
  path: string;
  createdAt?: string;
};

export type ValidationRunLaunchUpdate = {
  runId: string;
  validatorSessionId: string;
  worktreeCwd: string;
  preValidationGitStatus: string;
};

export type ValidationRunGuardrailsUpdate = {
  runId: string;
  postValidationGitStatus: string;
  gitStatusDriftDetected: boolean;
};
