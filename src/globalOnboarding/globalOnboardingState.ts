import type { ActiveProjectKey, Agent, ProjectTabState } from '../types';
import {
  GLOBAL_ONBOARDING_STATE_VERSION,
  type GlobalOnboardingStateV1,
  type GlobalOnboardingStatus,
  type ResolvedGlobalOnboardingState,
} from './types';

const STATUSES: GlobalOnboardingStatus[] = ['pending', 'skipped', 'completed'];

const AGENTS: Agent[] = ['claude-code', 'codex', 'cursor'];

export function isForceGlobalOnboardingEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = env.FLUXX_FORCE_GLOBAL_ONBOARDING?.trim();
  return raw === '1' || raw?.toLowerCase() === 'true';
}

export type GlobalOnboardingActivitySnapshot = {
  lastOpenedProjectDir: string | null;
  activeProjectKey: ActiveProjectKey | null;
  projectTabs: Record<string, ProjectTabState>;
  projectLastOpenedAt: Record<string, string>;
};

export function hasPriorAppActivity(state: GlobalOnboardingActivitySnapshot): boolean {
  if (state.lastOpenedProjectDir) return true;
  if (state.activeProjectKey) return true;
  if (Object.keys(state.projectTabs).length > 0) return true;
  if (Object.keys(state.projectLastOpenedAt).length > 0) return true;
  return false;
}

function isStatus(value: unknown): value is GlobalOnboardingStatus {
  return typeof value === 'string' && (STATUSES as string[]).includes(value);
}

function isAgent(value: unknown): value is Agent {
  return typeof value === 'string' && (AGENTS as string[]).includes(value);
}

export function normalizeGlobalOnboardingState(
  raw: unknown,
): GlobalOnboardingStateV1 | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Partial<GlobalOnboardingStateV1>;
  if (o.version !== GLOBAL_ONBOARDING_STATE_VERSION) return undefined;
  if (!isStatus(o.status)) return undefined;
  const out: GlobalOnboardingStateV1 = {
    version: GLOBAL_ONBOARDING_STATE_VERSION,
    status: o.status,
  };
  if (typeof o.updatedAt === 'string' && o.updatedAt) {
    out.updatedAt = o.updatedAt;
  }
  if (o.selectedAgent !== undefined) {
    if (!isAgent(o.selectedAgent)) return undefined;
    out.selectedAgent = o.selectedAgent;
  }
  return out;
}

/** First-run default when no persisted onboarding block exists yet. */
export function inferInitialGlobalOnboardingState(
  appState: GlobalOnboardingActivitySnapshot,
): GlobalOnboardingStateV1 {
  return {
    version: GLOBAL_ONBOARDING_STATE_VERSION,
    status: hasPriorAppActivity(appState) ? 'skipped' : 'pending',
  };
}

export function migrateGlobalOnboardingFromDisk(
  stored: unknown,
  appState: GlobalOnboardingActivitySnapshot,
): GlobalOnboardingStateV1 {
  const normalized = normalizeGlobalOnboardingState(stored);
  if (normalized) return normalized;
  return inferInitialGlobalOnboardingState(appState);
}

export function resolveEffectiveGlobalOnboardingStatus(
  stored: GlobalOnboardingStateV1,
  options?: { force?: boolean },
): GlobalOnboardingStatus {
  if (options?.force) return 'pending';
  return stored.status;
}

export function resolveGlobalOnboardingState(
  stored: GlobalOnboardingStateV1,
  options?: { force?: boolean },
): ResolvedGlobalOnboardingState {
  const forced = options?.force === true;
  return {
    status: resolveEffectiveGlobalOnboardingStatus(stored, { force: forced }),
    forced,
    ...(stored.selectedAgent ? { selectedAgent: stored.selectedAgent } : {}),
  };
}

export function buildGlobalOnboardingPatch(
  stored: GlobalOnboardingStateV1,
  patch: Partial<Pick<GlobalOnboardingStateV1, 'status' | 'selectedAgent'>>,
): GlobalOnboardingStateV1 {
  const next: GlobalOnboardingStateV1 = {
    version: GLOBAL_ONBOARDING_STATE_VERSION,
    status: patch.status ?? stored.status,
    updatedAt: new Date().toISOString(),
  };
  const agent = patch.selectedAgent ?? stored.selectedAgent;
  if (agent) next.selectedAgent = agent;
  return next;
}
