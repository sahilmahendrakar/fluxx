import type { ValidationArtifactView, ValidationRun } from './types';

/** Stable machine-readable validation run shape for `fluxx validation` JSON output. */
export type ValidationRunCliJson = {
  id: string;
  taskId: string;
  projectId: string;
  repoId?: string;
  packId: string;
  status: string;
  validatorAgent: string;
  startedAt: string;
  completedAt?: string;
  summary?: string;
  verdictReason?: string;
  artifactDir: string;
  artifacts: ValidationArtifactCliJson[];
  validatorSessionId?: string;
  worktreeCwd?: string;
  gitGuardrails?: {
    preValidationGitStatus?: string;
    postValidationGitStatus?: string;
    gitStatusDriftDetected?: boolean;
  };
};

export type ValidationArtifactCliJson = {
  id: string;
  kind: string;
  label: string;
  path: string;
  createdAt: string;
  fileState: string;
};

export function validationArtifactToCliJson(a: ValidationArtifactView): ValidationArtifactCliJson {
  return {
    id: a.id,
    kind: a.kind,
    label: a.label,
    path: a.path,
    createdAt: a.createdAt,
    fileState: a.fileState,
  };
}

export function validationRunToCliJson(run: ValidationRun): ValidationRunCliJson {
  return {
    id: run.id,
    taskId: run.taskId,
    projectId: run.projectId,
    ...(run.repoId ? { repoId: run.repoId } : {}),
    packId: run.packId,
    status: run.status,
    validatorAgent: run.validatorAgent,
    startedAt: run.startedAt,
    ...(run.completedAt ? { completedAt: run.completedAt } : {}),
    ...(run.summary ? { summary: run.summary } : {}),
    ...(run.verdictReason ? { verdictReason: run.verdictReason } : {}),
    artifactDir: run.artifactDir,
    artifacts: run.artifacts.map(validationArtifactToCliJson),
    ...(run.validatorSessionId ? { validatorSessionId: run.validatorSessionId } : {}),
    ...(run.worktreeCwd ? { worktreeCwd: run.worktreeCwd } : {}),
    ...(run.gitGuardrails ? { gitGuardrails: run.gitGuardrails } : {}),
  };
}
