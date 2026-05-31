import type { Agent } from '../types';

export const GLOBAL_ONBOARDING_STATE_VERSION = 1 as const;

export type GlobalOnboardingStatus = 'pending' | 'skipped' | 'completed';

/** Persisted global onboarding record (`app-state.json`). */
export interface GlobalOnboardingStateV1 {
  version: typeof GLOBAL_ONBOARDING_STATE_VERSION;
  status: GlobalOnboardingStatus;
  /** ISO timestamp when `status` last changed. */
  updatedAt?: string;
  /** Global default agent chosen during onboarding. */
  selectedAgent?: Agent;
}

export type GlobalOnboardingCliId = 'claude' | 'agent' | 'codex' | 'gh';

export type CliProbeStatus = 'found' | 'missing' | 'error' | 'timeout';

export interface GlobalOnboardingCliProbeResult {
  command: GlobalOnboardingCliId;
  status: CliProbeStatus;
  path?: string;
  message?: string;
}

/** Renderer-facing onboarding snapshot (after force override resolution). */
export interface ResolvedGlobalOnboardingState {
  status: GlobalOnboardingStatus;
  /** True when `FLUXX_FORCE_GLOBAL_ONBOARDING` treats the user as new. */
  forced: boolean;
  selectedAgent?: Agent;
}
