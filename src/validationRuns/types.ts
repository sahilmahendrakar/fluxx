import type { Agent } from '../types';

export type ValidationRunStatus =
  | 'queued'
  | 'running'
  | 'passed'
  | 'failed'
  | 'needs-human-review'
  | 'errored'
  | 'cancelled';

export type ValidationPackId = 'electron-playwright';

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
}

export type ValidationRunCreateInput = {
  taskId: string;
  projectId: string;
  repoId?: string;
  packId?: ValidationPackId;
  validatorAgent: Agent;
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
