import { ipcMain } from 'electron';
import type { AppStateStore } from './AppStateStore';
import {
  buildGlobalOnboardingPatch,
  isForceGlobalOnboardingEnabled,
  migrateGlobalOnboardingFromDisk,
  resolveGlobalOnboardingState,
} from '../globalOnboarding/globalOnboardingState';
import type {
  GlobalOnboardingStateV1,
  ResolvedGlobalOnboardingState,
} from '../globalOnboarding/types';
import { probeAllGlobalOnboardingClis } from './globalOnboardingCliProbe';
import type { Agent } from '../types';

const AGENTS: Agent[] = ['claude-code', 'codex', 'cursor'];

function isAgent(value: unknown): value is Agent {
  return typeof value === 'string' && (AGENTS as string[]).includes(value);
}

function readStoredGlobalOnboarding(appStateStore: AppStateStore): GlobalOnboardingStateV1 {
  const appState = appStateStore.get();
  return (
    appState.globalOnboarding ??
    migrateGlobalOnboardingFromDisk(undefined, appState)
  );
}

export type GlobalOnboardingProjectAgentSync = (
  agent: Agent,
) => Promise<{ ok: true } | { error: string }>;

export function registerGlobalOnboardingIpc(
  appStateStore: AppStateStore,
  syncProjectAgents?: GlobalOnboardingProjectAgentSync,
): void {
  ipcMain.handle('globalOnboarding:getState', (): ResolvedGlobalOnboardingState => {
    const stored = readStoredGlobalOnboarding(appStateStore);
    return resolveGlobalOnboardingState(stored, {
      force: isForceGlobalOnboardingEnabled(),
    });
  });

  ipcMain.handle('globalOnboarding:probeClis', async () => probeAllGlobalOnboardingClis());

  ipcMain.handle('globalOnboarding:skip', async (): Promise<{ ok: true }> => {
    const stored = readStoredGlobalOnboarding(appStateStore);
    const next = buildGlobalOnboardingPatch(stored, { status: 'skipped' });
    await appStateStore.set({ globalOnboarding: next });
    return { ok: true };
  });

  ipcMain.handle('globalOnboarding:complete', async (): Promise<{ ok: true }> => {
    const stored = readStoredGlobalOnboarding(appStateStore);
    const next = buildGlobalOnboardingPatch(stored, { status: 'completed' });
    await appStateStore.set({ globalOnboarding: next });
    return { ok: true };
  });

  ipcMain.handle(
    'globalOnboarding:selectAgent',
    async (
      _event,
      raw: unknown,
    ): Promise<{ ok: true } | { error: string }> => {
      if (!isAgent(raw)) {
        return { error: 'INVALID_AGENT' };
      }
      const stored = readStoredGlobalOnboarding(appStateStore);
      const next = buildGlobalOnboardingPatch(stored, { selectedAgent: raw });
      await appStateStore.set({ globalOnboarding: next });
      if (syncProjectAgents) {
        return syncProjectAgents(raw);
      }
      return { ok: true };
    },
  );
}
