import type { ValidationArtifactKind } from '../validationRuns/types';

export type ValidationPackId = 'electron-playwright';

export const VALIDATION_PACK_IDS = ['electron-playwright'] as const satisfies readonly ValidationPackId[];

/** Renderer-safe structural pack id check (no disk I/O). */
export function isKnownValidationPackId(packId: string): packId is ValidationPackId {
  return (VALIDATION_PACK_IDS as readonly string[]).includes(packId);
}

export type ValidationVerdictOutcome = 'passed' | 'failed' | 'needs-human-review' | 'errored';

export type ValidationCheckStatus = 'passed' | 'failed' | 'skipped' | 'needs-human-review';

export interface ValidationPackManifest {
  id: ValidationPackId;
  displayName: string;
  description: string;
  supportedArtifactKinds: ValidationArtifactKind[];
  defaultInstructions: string;
}

export interface ValidationPackDefinition {
  manifest: ValidationPackManifest;
  /** Pack root directory on disk (absolute). */
  rootDir: string;
  skillMarkdown: string;
  verdictSchemaJson: string;
  validateElectronTemplate: string;
}

export type ValidationReadyConfig =
  | { type: 'selector'; value: string; timeoutMs?: number }
  | { type: 'timeout'; ms: number };

export type ValidationArtifactPolicy = {
  screenshots?: 'required' | 'optional' | 'never';
  trace?: 'always' | 'on-failure' | 'never';
  consoleLogs?: 'always' | 'on-failure' | 'never';
};

export interface ElectronPlaywrightPackProjectConfig {
  launchCommand?: string;
  worktreeCwd?: string;
  ready?: ValidationReadyConfig;
  cleanUserData?: boolean;
  artifactPolicy?: ValidationArtifactPolicy;
  /** Trimmed free text appended to validator session prompt when non-empty (prompt-only). */
  appendPrompt?: string;
}

export type ValidationPacksProjectFile = {
  packs?: Partial<Record<ValidationPackId, ElectronPlaywrightPackProjectConfig>>;
};

export const VALIDATION_PACKS_PROJECT_FILENAME = 'validation-packs.json';

export type ValidationPackScaffoldContext = {
  runId: string;
  runDir: string;
  worktreeCwd?: string;
  projectConfig?: ElectronPlaywrightPackProjectConfig;
};

export type ValidationPackSummary = {
  id: ValidationPackId;
  displayName: string;
  description: string;
  supportedArtifactKinds: ValidationArtifactKind[];
  defaultInstructions: string;
};

export type ValidationPackResolvedInstructions = {
  packId: ValidationPackId;
  displayName: string;
  instructionsMarkdown: string;
  verdictSchemaJson: string;
  skillMarkdown: string;
  projectConfig?: ElectronPlaywrightPackProjectConfig;
};

/** IPC/renderer view of a pack (includes skill + schema text). */
export type ValidationPackDetail = ValidationPackSummary & {
  verdictSchemaJson: string;
  skillMarkdown: string;
};
