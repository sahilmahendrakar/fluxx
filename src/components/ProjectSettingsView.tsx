import { useCallback, useEffect, useId, useState, type ReactNode } from 'react';
import {
  AGENTS,
  DEFAULT_CURSOR_AGENT_MODEL,
  type Agent,
  type AgentSpawnDefaultsPatch,
  type CloudRepoBindingOverview,
  type CloudRepoLocalBindingStatus,
  type CloudProject,
  type CloudSharedRepo,
  type LocalProject,
  type RepoConfig,
  type RepoManagementState,
} from '../types';
import { defaultTaskAgentForProject } from '../cloudBindingPrefs';
import { deriveRepoIdForRootPath, repoRootBasename } from '../repoIdentity';
import { updateCloudProjectRepos } from '../renderer/projects/cloudProjects';
import AgentModelPicker from './AgentModelPicker';
import { SettingsSwitch } from './SettingsSwitch';
import { AGENT_SPAWN_AGENT_SELECT_CLASS } from './AgentSessionPrefsMenu';
import { TeamView } from './TeamView';

interface Props {
  project: LocalProject | CloudProject;
  currentUid: string | null;
  currentUserDisplayName?: string;
  currentUserEmail?: string;
  /** Fires after “auto-start when unblocked” is saved so the board can refresh hints. */
  onAutoStartWhenUnblockedChange?: (enabled: boolean) => void;
  /** After planning / default task agent prefs are saved, reload the active project from the main process. */
  onProjectAgentPrefsRefresh?: () => void | Promise<void>;
  onCloudSharedReposChanged?: (repos: CloudSharedRepo[]) => void;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';
type Category = 'project' | 'team';

function isRepoManagementStatesError(
  result:
    | Record<string, RepoManagementState>
    | { error: string },
): result is { error: string } {
  return typeof (result as { error?: unknown }).error === 'string';
}

function AutomationSettingRow({
  title,
  description,
  checked,
  onCheckedChange,
  switchDisabled,
  loading,
  saveState,
  error,
}: {
  title: string;
  description: ReactNode;
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  switchDisabled: boolean;
  /** While the initial preference value is loading from the main process. */
  loading: boolean;
  saveState: SaveState;
  error: string | null;
}) {
  const titleId = useId();
  const detailsId = useId();
  const [detailsOpen, setDetailsOpen] = useState(false);

  return (
    <div className="py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h3 id={titleId} className="text-[13px] font-medium text-zinc-200">
            {title}
          </h3>
          <button
            type="button"
            className="mt-1.5 text-left text-[11px] text-zinc-500 transition-colors hover:text-zinc-300"
            aria-expanded={detailsOpen}
            aria-controls={detailsId}
            onClick={() => setDetailsOpen((o) => !o)}
          >
            {detailsOpen ? 'Hide' : 'More info'}
          </button>
          <div
            id={detailsId}
            role="region"
            aria-labelledby={titleId}
            hidden={!detailsOpen}
            className="mt-2 text-[12px] leading-snug text-zinc-500"
          >
            {description}
          </div>
        </div>
        <SettingsSwitch
          checked={checked}
          onCheckedChange={onCheckedChange}
          disabled={switchDisabled}
          ariaLabelledBy={titleId}
          ariaBusy={loading || saveState === 'saving'}
        />
      </div>
      <div className="mt-2 min-h-4 text-[11px]">
        {loading ? (
          <span className="text-zinc-600">Loading…</span>
        ) : saveState === 'saving' ? (
          <span className="text-zinc-500">Saving…</span>
        ) : saveState === 'saved' ? (
          <span className="text-emerald-400">Saved</span>
        ) : error ? (
          <span className="text-red-400">{error}</span>
        ) : null}
      </div>
    </div>
  );
}

export function ProjectSettingsView({
  project,
  currentUid,
  currentUserDisplayName,
  currentUserEmail,
  onAutoStartWhenUnblockedChange,
  onProjectAgentPrefsRefresh,
  onCloudSharedReposChanged,
}: Props) {
  const teamAvailable = project.kind === 'cloud' && !!currentUid;
  const [category, setCategory] = useState<Category>('project');

  useEffect(() => {
    if (category === 'team' && !teamAvailable) {
      setCategory('project');
    }
  }, [category, teamAvailable]);

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <nav
        className="flex w-[140px] shrink-0 flex-col gap-0.5 pl-6 pr-1 pt-24"
        aria-label="Settings categories"
      >
        <CategoryButton
          active={category === 'project'}
          label="Project Config"
          onClick={() => setCategory('project')}
        />
        {teamAvailable ? (
          <CategoryButton
            active={category === 'team'}
            label="Team"
            onClick={() => setCategory('team')}
          />
        ) : null}
      </nav>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {category === 'project' ? (
          <ProjectConfigPane
            project={project}
            onAutoStartWhenUnblockedChange={onAutoStartWhenUnblockedChange}
            onProjectAgentPrefsRefresh={onProjectAgentPrefsRefresh}
            onCloudSharedReposChanged={onCloudSharedReposChanged}
          />
        ) : teamAvailable && project.kind === 'cloud' && currentUid ? (
          <TeamView
            project={project}
            currentUid={currentUid}
            currentUserDisplayName={currentUserDisplayName}
            currentUserEmail={currentUserEmail}
          />
        ) : null}
      </div>
    </div>
  );
}

function CategoryButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        'w-full rounded-md px-2 py-1.5 text-left text-[13.5px] transition-colors',
        active
          ? 'bg-white/[0.04] text-zinc-300'
          : 'text-zinc-600 hover:bg-white/[0.02] hover:text-zinc-400',
      ].join(' ')}
    >
      {label}
    </button>
  );
}

interface ProjectConfigPaneProps {
  project: LocalProject | CloudProject;
  onAutoStartWhenUnblockedChange?: (enabled: boolean) => void;
  onProjectAgentPrefsRefresh?: () => void | Promise<void>;
  onCloudSharedReposChanged?: (repos: CloudSharedRepo[]) => void;
}

function ProjectConfigPane({
  project,
  onAutoStartWhenUnblockedChange,
  onProjectAgentPrefsRefresh,
  onCloudSharedReposChanged,
}: ProjectConfigPaneProps) {
  const multiRepoLocalManagementEnabled = project.kind === 'local';
  const multiRepoCloudBindingsEnabled = project.kind === 'cloud';
  const [repos, setRepos] = useState<RepoConfig[] | null>(null);
  const [repoStates, setRepoStates] = useState<Record<string, RepoManagementState>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [addRepoState, setAddRepoState] = useState<SaveState>('idle');
  const [addRepoError, setAddRepoError] = useState<string | null>(null);
  const [autoStartEnabled, setAutoStartEnabled] = useState(false);
  const [autoStartLoading, setAutoStartLoading] = useState(true);
  const [autoStartSaveState, setAutoStartSaveState] = useState<SaveState>('idle');
  const [autoStartError, setAutoStartError] = useState<string | null>(null);
  const [whenUnblockedEnabled, setWhenUnblockedEnabled] = useState(false);
  const [whenUnblockedLoading, setWhenUnblockedLoading] = useState(true);
  const [whenUnblockedSaveState, setWhenUnblockedSaveState] = useState<SaveState>('idle');
  const [whenUnblockedError, setWhenUnblockedError] = useState<string | null>(null);
  const [autoCleanupOnDoneEnabled, setAutoCleanupOnDoneEnabled] = useState(false);
  const [autoCleanupOnDoneLoading, setAutoCleanupOnDoneLoading] = useState(true);
  const [autoCleanupOnDoneSaveState, setAutoCleanupOnDoneSaveState] = useState<SaveState>('idle');
  const [autoCleanupOnDoneError, setAutoCleanupOnDoneError] = useState<string | null>(null);
  const [autoDoneOnPrMergeEnabled, setAutoDoneOnPrMergeEnabled] = useState(false);
  const [autoDoneOnPrMergeLoading, setAutoDoneOnPrMergeLoading] = useState(true);
  const [autoDoneOnPrMergeSaveState, setAutoDoneOnPrMergeSaveState] = useState<SaveState>('idle');
  const [autoDoneOnPrMergeError, setAutoDoneOnPrMergeError] = useState<string | null>(null);
  const [autoReviewOnOpenPrEnabled, setAutoReviewOnOpenPrEnabled] = useState(false);
  const [autoReviewOnOpenPrLoading, setAutoReviewOnOpenPrLoading] = useState(true);
  const [autoReviewOnOpenPrSaveState, setAutoReviewOnOpenPrSaveState] = useState<SaveState>('idle');
  const [autoReviewOnOpenPrError, setAutoReviewOnOpenPrError] = useState<string | null>(null);
  const [planningAgentSaveState, setPlanningAgentSaveState] = useState<SaveState>('idle');
  const [planningAgentError, setPlanningAgentError] = useState<string | null>(null);
  const [defaultTaskAgentSaveState, setDefaultTaskAgentSaveState] = useState<SaveState>('idle');
  const [defaultTaskAgentError, setDefaultTaskAgentError] = useState<string | null>(null);
  const [planClaudeModel, setPlanClaudeModel] = useState('');
  const [planCursorModel, setPlanCursorModel] = useState(DEFAULT_CURSOR_AGENT_MODEL);
  const [planYolo, setPlanYolo] = useState(false);
  const [taskClaudeModel, setTaskClaudeModel] = useState('');
  const [taskCursorModel, setTaskCursorModel] = useState(DEFAULT_CURSOR_AGENT_MODEL);
  const [taskYolo, setTaskYolo] = useState(false);
  const [planSpawnSaveState, setPlanSpawnSaveState] = useState<SaveState>('idle');
  const [planSpawnError, setPlanSpawnError] = useState<string | null>(null);
  const [taskSpawnSaveState, setTaskSpawnSaveState] = useState<SaveState>('idle');
  const [taskSpawnError, setTaskSpawnError] = useState<string | null>(null);

  const planningAgentValue: Agent =
    project.kind === 'local'
      ? project.planningAgent
      : (project.planningAgent ?? 'claude-code');
  const defaultTaskAgentValue = defaultTaskAgentForProject(project);

  const refreshRepoStates = useCallback(
    async (nextRepos: RepoConfig[]) => {
      if (!multiRepoLocalManagementEnabled) {
        setRepoStates({});
        return;
      }
      const result = await window.electronAPI.project.getRepoManagementStates();
      if (isRepoManagementStatesError(result)) {
        throw new Error(result.error);
      }
      const known = new Set(nextRepos.map((r) => r.id));
      setRepoStates(
        Object.fromEntries(
          Object.entries(result).filter(([repoId]) => known.has(repoId)),
        ),
      );
    },
    [multiRepoLocalManagementEnabled],
  );

  const refresh = useCallback(async () => {
    if (multiRepoCloudBindingsEnabled) {
      setRepos([]);
      setRepoStates({});
      setLoadError(null);
      return;
    }
    try {
      const next = await window.electronAPI.project.getRepos();
      setRepos(next);
      await refreshRepoStates(next);
      setLoadError(null);
      setExpanded((prev) => {
        if (Object.keys(prev).length > 0) return prev;
        if (next.length === 1) {
          const key = multiRepoLocalManagementEnabled ? next[0].id : next[0].rootPath;
          return { [key]: true };
        }
        return prev;
      });
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, [
    multiRepoCloudBindingsEnabled,
    multiRepoLocalManagementEnabled,
    refreshRepoStates,
  ]);

  useEffect(() => {
    void refresh();
  }, [refresh, project.id]);

  useEffect(() => {
    setPlanningAgentError(null);
    setPlanningAgentSaveState('idle');
    setDefaultTaskAgentError(null);
    setDefaultTaskAgentSaveState('idle');
    setPlanSpawnSaveState('idle');
    setPlanSpawnError(null);
    setTaskSpawnSaveState('idle');
    setTaskSpawnError(null);
    setAddRepoState('idle');
    setAddRepoError(null);
  }, [project.id]);

  const planningModelsKey = JSON.stringify(project.planningModels ?? {});
  const taskModelsKey = JSON.stringify(project.taskDefaultModels ?? {});

  useEffect(() => {
    setPlanClaudeModel(project.planningModels?.['claude-code'] ?? '');
    setPlanCursorModel(
      project.planningModels?.cursor?.trim()
        ? (project.planningModels.cursor as string)
        : DEFAULT_CURSOR_AGENT_MODEL,
    );
    setPlanYolo(project.planningAgentYolo === true);
    setTaskClaudeModel(project.taskDefaultModels?.['claude-code'] ?? '');
    setTaskCursorModel(
      project.taskDefaultModels?.cursor?.trim()
        ? (project.taskDefaultModels.cursor as string)
        : DEFAULT_CURSOR_AGENT_MODEL,
    );
    setTaskYolo(project.defaultTaskAgentYolo === true);
  }, [
    project.id,
    planningModelsKey,
    project.planningAgentYolo,
    taskModelsKey,
    project.defaultTaskAgentYolo,
  ]);

  useEffect(() => {
    let cancelled = false;
    setAutoStartLoading(true);
    setAutoStartError(null);
    void window.electronAPI.project
      .getAutoStartSessionOnInProgress()
      .then((enabled) => {
        if (cancelled) return;
        setAutoStartEnabled(enabled);
        setAutoStartSaveState('idle');
      })
      .catch((err) => {
        if (cancelled) return;
        setAutoStartError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setAutoStartLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  useEffect(() => {
    let cancelled = false;
    setWhenUnblockedLoading(true);
    setWhenUnblockedError(null);
    void window.electronAPI.project
      .getAutoStartWhenUnblocked()
      .then((enabled) => {
        if (!cancelled) {
          setWhenUnblockedEnabled(enabled);
          setWhenUnblockedSaveState('idle');
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setWhenUnblockedError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setWhenUnblockedLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  useEffect(() => {
    let cancelled = false;
    setAutoCleanupOnDoneLoading(true);
    setAutoCleanupOnDoneError(null);
    void window.electronAPI.project
      .getAutoCleanupWorkspaceWhenDone()
      .then((enabled) => {
        if (!cancelled) {
          setAutoCleanupOnDoneEnabled(enabled);
          setAutoCleanupOnDoneSaveState('idle');
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setAutoCleanupOnDoneError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setAutoCleanupOnDoneLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  useEffect(() => {
    let cancelled = false;
    setAutoDoneOnPrMergeLoading(true);
    setAutoDoneOnPrMergeError(null);
    void window.electronAPI.project
      .getAutoMarkDoneWhenPrMerged()
      .then((enabled) => {
        if (!cancelled) {
          setAutoDoneOnPrMergeEnabled(enabled);
          setAutoDoneOnPrMergeSaveState('idle');
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setAutoDoneOnPrMergeError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setAutoDoneOnPrMergeLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  useEffect(() => {
    let cancelled = false;
    setAutoReviewOnOpenPrLoading(true);
    setAutoReviewOnOpenPrError(null);
    void window.electronAPI.project
      .getAutoMoveToReviewWhenPrOpen()
      .then((enabled) => {
        if (!cancelled) {
          setAutoReviewOnOpenPrEnabled(enabled);
          setAutoReviewOnOpenPrSaveState('idle');
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setAutoReviewOnOpenPrError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setAutoReviewOnOpenPrLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  const handleWhenUnblockedChange = useCallback(async (enabled: boolean) => {
    setWhenUnblockedEnabled(enabled);
    setWhenUnblockedSaveState('saving');
    setWhenUnblockedError(null);
    const result = await window.electronAPI.project.setAutoStartWhenUnblocked(enabled);
    if ('error' in result) {
      setWhenUnblockedSaveState('error');
      setWhenUnblockedError(result.error);
      setWhenUnblockedEnabled((prev) => !prev);
      return;
    }
    setWhenUnblockedEnabled(result.enabled);
    onAutoStartWhenUnblockedChange?.(result.enabled);
    setWhenUnblockedSaveState('saved');
    window.setTimeout(() => {
      setWhenUnblockedSaveState((state) => (state === 'saved' ? 'idle' : state));
    }, 1500);
  }, [onAutoStartWhenUnblockedChange]);

  const handlePlanningAgentChange = useCallback(
    async (next: Agent) => {
      setPlanningAgentSaveState('saving');
      setPlanningAgentError(null);
      const res = await window.electronAPI.project.setPlanningAgent(next);
      if ('error' in res) {
        setPlanningAgentSaveState('error');
        setPlanningAgentError(res.error);
        return;
      }
      await onProjectAgentPrefsRefresh?.();
      setPlanningAgentSaveState('saved');
      window.setTimeout(() => {
        setPlanningAgentSaveState((s) => (s === 'saved' ? 'idle' : s));
      }, 1500);
    },
    [onProjectAgentPrefsRefresh],
  );

  const handleDefaultTaskAgentChange = useCallback(
    async (next: Agent) => {
      setDefaultTaskAgentSaveState('saving');
      setDefaultTaskAgentError(null);
      const res = await window.electronAPI.project.setDefaultTaskAgent(next);
      if ('error' in res) {
        setDefaultTaskAgentSaveState('error');
        setDefaultTaskAgentError(res.error);
        return;
      }
      await onProjectAgentPrefsRefresh?.();
      setDefaultTaskAgentSaveState('saved');
      window.setTimeout(() => {
        setDefaultTaskAgentSaveState((s) => (s === 'saved' ? 'idle' : s));
      }, 1500);
    },
    [onProjectAgentPrefsRefresh],
  );

  const handleSavePlanningSpawnRow = useCallback(async () => {
    setPlanSpawnSaveState('saving');
    setPlanSpawnError(null);
    const patch: AgentSpawnDefaultsPatch = {
      planningModels: {
        'claude-code': planClaudeModel,
        cursor: planCursorModel.trim() || DEFAULT_CURSOR_AGENT_MODEL,
      },
      planningAgentYolo: planYolo,
    };
    const res = await window.electronAPI.project.patchAgentSpawnDefaults(patch);
    if ('error' in res) {
      setPlanSpawnSaveState('error');
      setPlanSpawnError(res.error);
      return;
    }
    await onProjectAgentPrefsRefresh?.();
    setPlanSpawnSaveState('saved');
    window.setTimeout(() => {
      setPlanSpawnSaveState((s) => (s === 'saved' ? 'idle' : s));
    }, 1500);
  }, [onProjectAgentPrefsRefresh, planClaudeModel, planCursorModel, planYolo]);

  const handleSaveTaskSpawnRow = useCallback(async () => {
    setTaskSpawnSaveState('saving');
    setTaskSpawnError(null);
    const patch: AgentSpawnDefaultsPatch = {
      taskDefaultModels: {
        'claude-code': taskClaudeModel,
        cursor: taskCursorModel.trim() || DEFAULT_CURSOR_AGENT_MODEL,
      },
      defaultTaskAgentYolo: taskYolo,
    };
    const res = await window.electronAPI.project.patchAgentSpawnDefaults(patch);
    if ('error' in res) {
      setTaskSpawnSaveState('error');
      setTaskSpawnError(res.error);
      return;
    }
    await onProjectAgentPrefsRefresh?.();
    setTaskSpawnSaveState('saved');
    window.setTimeout(() => {
      setTaskSpawnSaveState((s) => (s === 'saved' ? 'idle' : s));
    }, 1500);
  }, [onProjectAgentPrefsRefresh, taskClaudeModel, taskCursorModel, taskYolo]);

  const handleAutoStartChange = useCallback(async (enabled: boolean) => {
    setAutoStartEnabled(enabled);
    setAutoStartSaveState('saving');
    setAutoStartError(null);
    const result = await window.electronAPI.project.setAutoStartSessionOnInProgress(enabled);
    if ('error' in result) {
      setAutoStartSaveState('error');
      setAutoStartError(result.error);
      setAutoStartEnabled((prev) => !prev);
      return;
    }
    setAutoStartEnabled(result.enabled);
    setAutoStartSaveState('saved');
    window.setTimeout(() => {
      setAutoStartSaveState((state) => (state === 'saved' ? 'idle' : state));
    }, 1500);
  }, []);

  const handleAutoCleanupOnDoneChange = useCallback(async (enabled: boolean) => {
    setAutoCleanupOnDoneEnabled(enabled);
    setAutoCleanupOnDoneSaveState('saving');
    setAutoCleanupOnDoneError(null);
    const result = await window.electronAPI.project.setAutoCleanupWorkspaceWhenDone(enabled);
    if ('error' in result) {
      setAutoCleanupOnDoneSaveState('error');
      setAutoCleanupOnDoneError(result.error);
      setAutoCleanupOnDoneEnabled((prev) => !prev);
      return;
    }
    setAutoCleanupOnDoneEnabled(result.enabled);
    setAutoCleanupOnDoneSaveState('saved');
    window.setTimeout(() => {
      setAutoCleanupOnDoneSaveState((state) => (state === 'saved' ? 'idle' : state));
    }, 1500);
  }, []);

  const handleAutoDoneOnPrMergeChange = useCallback(async (enabled: boolean) => {
    setAutoDoneOnPrMergeEnabled(enabled);
    setAutoDoneOnPrMergeSaveState('saving');
    setAutoDoneOnPrMergeError(null);
    const result = await window.electronAPI.project.setAutoMarkDoneWhenPrMerged(enabled);
    if ('error' in result) {
      setAutoDoneOnPrMergeSaveState('error');
      setAutoDoneOnPrMergeError(result.error);
      setAutoDoneOnPrMergeEnabled((prev) => !prev);
      return;
    }
    setAutoDoneOnPrMergeEnabled(result.enabled);
    setAutoDoneOnPrMergeSaveState('saved');
    window.setTimeout(() => {
      setAutoDoneOnPrMergeSaveState((state) => (state === 'saved' ? 'idle' : state));
    }, 1500);
  }, []);

  const handleAutoReviewOnOpenPrChange = useCallback(async (enabled: boolean) => {
    setAutoReviewOnOpenPrEnabled(enabled);
    setAutoReviewOnOpenPrSaveState('saving');
    setAutoReviewOnOpenPrError(null);
    const result = await window.electronAPI.project.setAutoMoveToReviewWhenPrOpen(enabled);
    if ('error' in result) {
      setAutoReviewOnOpenPrSaveState('error');
      setAutoReviewOnOpenPrError(result.error);
      setAutoReviewOnOpenPrEnabled((prev) => !prev);
      return;
    }
    setAutoReviewOnOpenPrEnabled(result.enabled);
    setAutoReviewOnOpenPrSaveState('saved');
    window.setTimeout(() => {
      setAutoReviewOnOpenPrSaveState((state) => (state === 'saved' ? 'idle' : state));
    }, 1500);
  }, []);

  const handleAddRepo = useCallback(async () => {
    if (!multiRepoLocalManagementEnabled) return;
    setAddRepoState('saving');
    setAddRepoError(null);
    try {
      const picked = await window.electronAPI.project.pickRepoDirectory();
      if (!picked) {
        setAddRepoState('idle');
        return;
      }
      if ('error' in picked) {
        setAddRepoState('error');
        setAddRepoError(
          picked.error === 'NOT_GIT_REPO'
            ? 'Choose a folder that contains a .git directory.'
            : picked.error,
        );
        return;
      }

      const result = await window.electronAPI.project.addRepo({
        rootPath: picked.rootPath,
      });
      if ('error' in result) {
        setAddRepoState('error');
        setAddRepoError(result.error);
        return;
      }

      setRepos(result.repos);
      await refreshRepoStates(result.repos);
      await onProjectAgentPrefsRefresh?.();
      const added = result.repos.find((r) => r.rootPath === picked.rootPath);
      if (added) {
        setExpanded((prev) => ({ ...prev, [added.id]: true }));
      }
      setAddRepoState('saved');
      window.setTimeout(() => {
        setAddRepoState((state) => (state === 'saved' ? 'idle' : state));
      }, 1500);
    } catch (err) {
      setAddRepoState('error');
      setAddRepoError(err instanceof Error ? err.message : String(err));
    }
  }, [multiRepoLocalManagementEnabled, onProjectAgentPrefsRefresh, refreshRepoStates]);

  const handleAddCloudRepo = useCallback(async () => {
    if (!multiRepoCloudBindingsEnabled || project.kind !== 'cloud') return;
    setAddRepoState('saving');
    setAddRepoError(null);
    try {
      const picked = await window.electronAPI.project.pickRepoDirectory();
      if (!picked) {
        setAddRepoState('idle');
        return;
      }
      if ('error' in picked) {
        setAddRepoState('error');
        setAddRepoError(
          picked.error === 'NOT_GIT_REPO'
            ? 'Choose a folder that contains a .git directory.'
            : picked.error,
        );
        return;
      }

      const existingRoot = project.sharedRepos.find((sr) => {
        const bound = project.repoMachineBindings[sr.id]?.rootPath;
        return bound === picked.rootPath;
      });
      if (existingRoot) {
        setAddRepoState('error');
        setAddRepoError('That local folder is already bound to this cloud project.');
        return;
      }

      const existingIds = new Set(project.sharedRepos.map((r) => r.id));
      let repoId = deriveRepoIdForRootPath({
        projectId: project.id,
        rootPath: picked.rootPath,
      });
      let salt = 1;
      while (existingIds.has(repoId)) {
        repoId = deriveRepoIdForRootPath({
          projectId: project.id,
          rootPath: picked.rootPath,
          salt: `dup-${salt}`,
        });
        salt += 1;
      }

      const nextRepo: CloudSharedRepo = {
        id: repoId,
        name: repoRootBasename(picked.rootPath) || `repo:${repoId.slice(0, 7)}`,
        baseBranch: 'main',
      };
      const nextSharedRepos = [...project.sharedRepos, nextRepo];
      await updateCloudProjectRepos(project.id, nextSharedRepos);
      onCloudSharedReposChanged?.(nextSharedRepos);

      const bindResult = await window.electronAPI.project.bindCloudSharedRepo({
        repoId,
        rootPath: picked.rootPath,
        sharedRepos: nextSharedRepos,
      });
      if ('error' in bindResult) {
        setAddRepoState('error');
        setAddRepoError(bindResult.error);
        return;
      }

      await onProjectAgentPrefsRefresh?.();
      setAddRepoState('saved');
      window.setTimeout(() => {
        setAddRepoState((state) => (state === 'saved' ? 'idle' : state));
      }, 1500);
    } catch (err) {
      setAddRepoState('error');
      setAddRepoError(err instanceof Error ? err.message : String(err));
    }
  }, [
    multiRepoCloudBindingsEnabled,
    onCloudSharedReposChanged,
    onProjectAgentPrefsRefresh,
    project,
  ]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl px-8 py-10">
        <h1 className="text-[18px] font-semibold tracking-tight text-zinc-100">
          Project Config
        </h1>
        <p className="mt-1 text-[13px] text-zinc-500">
          Configure how new task workspaces are created for {project.name}.
        </p>

        <section
          className="mt-6 rounded-xl border border-white/[0.08] bg-white/[0.02] px-4"
          aria-labelledby="project-settings-automations-heading"
        >
          <div className="border-b border-white/[0.06] py-4">
            <h2
              id="project-settings-automations-heading"
              className="text-[14px] font-semibold tracking-tight text-zinc-100"
            >
              Automations
            </h2>
            <p className="mt-1 text-[12px] leading-snug text-zinc-500">
              Choose when sessions start automatically, when merged or open pull requests update the
              board, and when finished workspaces are cleaned up.
            </p>
          </div>
          <div className="divide-y divide-white/[0.06]">
            <AutomationSettingRow
              key={`${project.id}-auto-start-in-progress`}
              title="Auto-start sessions when tasks move from Backlog to In progress"
              description={
                <>
                  Applies when a task leaves Backlog for In progress (board drag, task detail, MCP{' '}
                  <code className="text-zinc-400">flux__update_task</code>). Other columns into In
                  progress do not auto-start from this setting.{' '}
                  <code className="text-zinc-400">flux__start_task</code> always starts a session
                  regardless of this setting.
                </>
              }
              checked={autoStartEnabled}
              onCheckedChange={(next) => void handleAutoStartChange(next)}
              switchDisabled={autoStartLoading || autoStartSaveState === 'saving'}
              loading={autoStartLoading}
              saveState={autoStartSaveState}
              error={autoStartError}
            />
            <AutomationSettingRow
              key={`${project.id}-auto-start-when-unblocked`}
              title="Auto-start when dependencies unblock"
              description={
                <>
                  When a task is waiting on other tasks, start a session automatically after the last
                  blocking task is completed. You can also opt in per task from the card or task detail.
                  Uses the same session start path as “In progress” (worktree, agent, model). Pair with
                  the setting above, or use this alone for dependency-driven runs.
                </>
              }
              checked={whenUnblockedEnabled}
              onCheckedChange={(next) => void handleWhenUnblockedChange(next)}
              switchDisabled={whenUnblockedLoading || whenUnblockedSaveState === 'saving'}
              loading={whenUnblockedLoading}
              saveState={whenUnblockedSaveState}
              error={whenUnblockedError}
            />
            <AutomationSettingRow
              key={`${project.id}-auto-cleanup-on-done`}
              title="Clean up workspace when moved to Done"
              description={
                <>
                  After a task reaches Done, automatically run the same cleanup as the broom on the
                  card: stop agent sessions and remove the task git worktree on this machine. The task
                  stays in Done with the broom marked complete. Applies to drags, detail status changes,
                  and MCP updates. For cloud projects this preference is stored per machine.
                </>
              }
              checked={autoCleanupOnDoneEnabled}
              onCheckedChange={(next) => void handleAutoCleanupOnDoneChange(next)}
              switchDisabled={
                autoCleanupOnDoneLoading || autoCleanupOnDoneSaveState === 'saving'
              }
              loading={autoCleanupOnDoneLoading}
              saveState={autoCleanupOnDoneSaveState}
              error={autoCleanupOnDoneError}
            />
            <AutomationSettingRow
              key={`${project.id}-auto-done-pr-merged`}
              title="Move to Done when linked PR merges"
              description={
                <>
                  After a linked GitHub PR refresh shows the PR merged, move the task to Done only
                  from “In progress”, “Needs input”, or “Review”, when the task has
                  a PR URL, is not blocked by incomplete dependencies, and the refresh actually
                  changed PR metadata. Backlog tasks are never auto-completed. For cloud projects this
                  preference is stored per machine (local binding), like other automations.
                </>
              }
              checked={autoDoneOnPrMergeEnabled}
              onCheckedChange={(next) => void handleAutoDoneOnPrMergeChange(next)}
              switchDisabled={
                autoDoneOnPrMergeLoading || autoDoneOnPrMergeSaveState === 'saving'
              }
              loading={autoDoneOnPrMergeLoading}
              saveState={autoDoneOnPrMergeSaveState}
              error={autoDoneOnPrMergeError}
            />
            <AutomationSettingRow
              key={`${project.id}-auto-review-open-pr`}
              title="Move to Review when pull request is open"
              description={
                <>
                  After Flux refreshes PR metadata from GitHub, if the linked PR is open and the task
                  is in Backlog or In progress, move it to Review. When GitHub reports a head
                  branch, it must match this task&apos;s Flux work branch. Merged or closed PRs are
                  ignored. For cloud projects this preference is stored per machine.
                </>
              }
              checked={autoReviewOnOpenPrEnabled}
              onCheckedChange={(next) => void handleAutoReviewOnOpenPrChange(next)}
              switchDisabled={
                autoReviewOnOpenPrLoading || autoReviewOnOpenPrSaveState === 'saving'
              }
              loading={autoReviewOnOpenPrLoading}
              saveState={autoReviewOnOpenPrSaveState}
              error={autoReviewOnOpenPrError}
            />
          </div>
        </section>

        <section className="mt-4 rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
          <h2 className="text-[13px] font-medium text-zinc-200">Default agents</h2>
          <p className="mt-0.5 text-[12px] leading-snug text-zinc-500">
            These apply to this project on this machine. Each row sets the default agent, the same
            model dropdown as tasks (choices follow the selected provider), and optional YOLO (
            <span className="font-mono text-zinc-400">--yolo</span> /{' '}
            <span className="font-mono text-zinc-400">--dangerously-skip-permissions</span>). Agent
            changes save immediately; use Save on the same row to persist models and YOLO for that
            flow.
          </p>

          <div className="mt-4 flex flex-col gap-4">
            <div>
              <label
                htmlFor="project-settings-planning-agent"
                className="text-[12px] font-medium text-zinc-300"
              >
                Planning assistant
              </label>
              <p className="mt-0.5 text-[11px] leading-snug text-zinc-600">
                Same defaults as the Planning panel. Codex ignores model/YOLO here.
              </p>
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                    Agent
                  </span>
                  <select
                    id="project-settings-planning-agent"
                    aria-label="Planning assistant default"
                    value={planningAgentValue}
                    disabled={planningAgentSaveState === 'saving'}
                    onChange={(e) => {
                      const next = e.target.value as Agent;
                      void handlePlanningAgentChange(next);
                    }}
                    className={AGENT_SPAWN_AGENT_SELECT_CLASS}
                  >
                    {AGENTS.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex min-w-0 flex-1 basis-[8rem] flex-col gap-0.5 sm:max-w-xs">
                  <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                    Model
                  </span>
                  {planningAgentValue === 'codex' ? (
                    <span
                      className="flex min-h-[2rem] items-center rounded-md border border-white/[0.06] bg-[#09090b]/60 px-2 text-[12px] text-zinc-500"
                      title="Model selection is not wired for Codex in this version."
                    >
                      Default model
                    </span>
                  ) : (
                    <div className="min-w-0 max-w-[200px] flex-1 sm:max-w-xs">
                      <AgentModelPicker
                        kind={planningAgentValue === 'cursor' ? 'cursor' : 'claude-code'}
                        modelId={
                          planningAgentValue === 'cursor'
                            ? planCursorModel.trim() || DEFAULT_CURSOR_AGENT_MODEL
                            : planClaudeModel
                        }
                        onModelIdChange={(id) => {
                          if (planningAgentValue === 'cursor') {
                            setPlanCursorModel(id.trim() || DEFAULT_CURSOR_AGENT_MODEL);
                          } else {
                            setPlanClaudeModel(id.trim());
                          }
                        }}
                        aria-label="Planning default model"
                      />
                    </div>
                  )}
                </div>
                <div className="flex h-[34px] shrink-0 items-center gap-1.5 self-end pb-0.5">
                  <span
                    className="text-[10px] text-zinc-500"
                    title="Fewer permission prompts for planning spawns (Cursor --yolo; Claude --dangerously-skip-permissions)"
                  >
                    YOLO?
                  </span>
                  <SettingsSwitch
                    checked={planYolo}
                    onCheckedChange={(n) => setPlanYolo(n)}
                    disabled={planSpawnSaveState === 'saving'}
                    ariaBusy={planSpawnSaveState === 'saving'}
                  />
                </div>
                <button
                  type="button"
                  disabled={planSpawnSaveState === 'saving'}
                  onClick={() => void handleSavePlanningSpawnRow()}
                  className="h-[34px] shrink-0 rounded-md border border-emerald-800/50 bg-emerald-950/40 px-2.5 text-[12px] font-medium text-emerald-100/90 transition hover:bg-emerald-950/60 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {planSpawnSaveState === 'saving' ? '…' : 'Save'}
                </button>
              </div>
              <div className="mt-1.5 flex min-h-4 flex-wrap gap-x-4 gap-y-0.5 text-[11px]">
                {planningAgentSaveState === 'saving' ? (
                  <span className="text-zinc-500">Agent: saving…</span>
                ) : planningAgentSaveState === 'saved' ? (
                  <span className="text-emerald-400">Agent: saved</span>
                ) : planningAgentError ? (
                  <span className="text-red-400">Agent: {planningAgentError}</span>
                ) : null}
                {planSpawnSaveState === 'saving' ? (
                  <span className="text-zinc-500">Models/YOLO: saving…</span>
                ) : planSpawnSaveState === 'saved' ? (
                  <span className="text-emerald-400">Models/YOLO: saved</span>
                ) : planSpawnError ? (
                  <span className="text-red-400">Models/YOLO: {planSpawnError}</span>
                ) : null}
              </div>
            </div>

            <div className="border-t border-white/[0.06] pt-4">
              <label
                htmlFor="project-settings-default-task-agent"
                className="text-[12px] font-medium text-zinc-300"
              >
                Default task agent
              </label>
              <p className="mt-0.5 text-[11px] leading-snug text-zinc-600">
                New tasks and MCP{' '}
                <code className="font-mono text-zinc-500">flux__create_task</code> when no agent is
                given. Codex ignores model/YOLO here.
              </p>
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                    Agent
                  </span>
                  <select
                    id="project-settings-default-task-agent"
                    aria-label="Default task agent"
                    value={defaultTaskAgentValue}
                    disabled={defaultTaskAgentSaveState === 'saving'}
                    onChange={(e) => {
                      const next = e.target.value as Agent;
                      void handleDefaultTaskAgentChange(next);
                    }}
                    className={AGENT_SPAWN_AGENT_SELECT_CLASS}
                  >
                    {AGENTS.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex min-w-0 flex-1 basis-[8rem] flex-col gap-0.5 sm:max-w-xs">
                  <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                    Model
                  </span>
                  {defaultTaskAgentValue === 'codex' ? (
                    <span
                      className="flex min-h-[2rem] items-center rounded-md border border-white/[0.06] bg-[#09090b]/60 px-2 text-[12px] text-zinc-500"
                      title="Model selection is not wired for Codex in this version."
                    >
                      Default model
                    </span>
                  ) : (
                    <div className="min-w-0 max-w-[200px] flex-1 sm:max-w-xs">
                      <AgentModelPicker
                        kind={defaultTaskAgentValue === 'cursor' ? 'cursor' : 'claude-code'}
                        modelId={
                          defaultTaskAgentValue === 'cursor'
                            ? taskCursorModel.trim() || DEFAULT_CURSOR_AGENT_MODEL
                            : taskClaudeModel
                        }
                        onModelIdChange={(id) => {
                          if (defaultTaskAgentValue === 'cursor') {
                            setTaskCursorModel(id.trim() || DEFAULT_CURSOR_AGENT_MODEL);
                          } else {
                            setTaskClaudeModel(id.trim());
                          }
                        }}
                        aria-label="Default task model"
                      />
                    </div>
                  )}
                </div>
                <div className="flex h-[34px] shrink-0 items-center gap-1.5 self-end pb-0.5">
                  <span
                    className="text-[10px] text-zinc-500"
                    title="Default for new tasks when YOLO is not set on the task (Cursor --yolo; Claude --dangerously-skip-permissions)"
                  >
                    YOLO?
                  </span>
                  <SettingsSwitch
                    checked={taskYolo}
                    onCheckedChange={(n) => setTaskYolo(n)}
                    disabled={taskSpawnSaveState === 'saving'}
                    ariaBusy={taskSpawnSaveState === 'saving'}
                  />
                </div>
                <button
                  type="button"
                  disabled={taskSpawnSaveState === 'saving'}
                  onClick={() => void handleSaveTaskSpawnRow()}
                  className="h-[34px] shrink-0 rounded-md border border-emerald-800/50 bg-emerald-950/40 px-2.5 text-[12px] font-medium text-emerald-100/90 transition hover:bg-emerald-950/60 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {taskSpawnSaveState === 'saving' ? '…' : 'Save'}
                </button>
              </div>
              <div className="mt-1.5 flex min-h-4 flex-wrap gap-x-4 gap-y-0.5 text-[11px]">
                {defaultTaskAgentSaveState === 'saving' ? (
                  <span className="text-zinc-500">Agent: saving…</span>
                ) : defaultTaskAgentSaveState === 'saved' ? (
                  <span className="text-emerald-400">Agent: saved</span>
                ) : defaultTaskAgentError ? (
                  <span className="text-red-400">Agent: {defaultTaskAgentError}</span>
                ) : null}
                {taskSpawnSaveState === 'saving' ? (
                  <span className="text-zinc-500">Models/YOLO: saving…</span>
                ) : taskSpawnSaveState === 'saved' ? (
                  <span className="text-emerald-400">Models/YOLO: saved</span>
                ) : taskSpawnError ? (
                  <span className="text-red-400">Models/YOLO: {taskSpawnError}</span>
                ) : null}
              </div>
            </div>
          </div>
        </section>

        <section className="mt-8">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-[13px] font-medium uppercase tracking-[0.12em] text-zinc-500">
                {multiRepoCloudBindingsEnabled ? 'Team repositories' : 'Repositories'}
              </h2>
              {multiRepoCloudBindingsEnabled ? (
                <p className="mt-1 text-[12px] leading-snug text-zinc-600">
                  Shared metadata comes from the cloud project. Bind each repo to a local clone on
                  this machine so agents and git operations can run. Paths are stored only in your
                  local Flux data, not synced to teammates.
                </p>
              ) : multiRepoLocalManagementEnabled ? (
                <p className="mt-1 text-[12px] leading-snug text-zinc-600">
                  Manage the local git repositories attached to this project.
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="text-[11px] text-zinc-600">
                {multiRepoCloudBindingsEnabled
                  ? `${project.kind === 'cloud' ? project.sharedRepos.length : 0} shared`
                  : `${repos?.length ?? 0} ${repos?.length === 1 ? 'repo' : 'repos'}`}
              </span>
              {multiRepoLocalManagementEnabled ? (
                <button
                  type="button"
                  onClick={() => void handleAddRepo()}
                  disabled={addRepoState === 'saving'}
                  className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-[12px] font-medium text-zinc-200 transition hover:bg-white/[0.07] disabled:pointer-events-none disabled:opacity-50"
                >
                  {addRepoState === 'saving' ? 'Adding…' : 'Add repo'}
                </button>
              ) : multiRepoCloudBindingsEnabled ? (
                <button
                  type="button"
                  onClick={() => void handleAddCloudRepo()}
                  disabled={addRepoState === 'saving'}
                  className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-[12px] font-medium text-zinc-200 transition hover:bg-white/[0.07] disabled:pointer-events-none disabled:opacity-50"
                >
                  {addRepoState === 'saving' ? 'Adding…' : 'Add repo'}
                </button>
              ) : null}
            </div>
          </div>

          {multiRepoCloudBindingsEnabled && project.kind === 'cloud' ? (
            <CloudTeamReposBindingsSection
              project={project}
              onBindingsChanged={onProjectAgentPrefsRefresh}
              onSharedReposChanged={onCloudSharedReposChanged}
              addRepoActionError={addRepoError}
              addRepoActionSaved={addRepoState === 'saved'}
            />
          ) : (
            <>
              {loadError ? (
                <p className="mt-4 rounded-md border border-red-500/30 bg-red-500/[0.06] px-3 py-2 text-[12px] text-red-300">
                  {loadError}
                </p>
              ) : null}
              {multiRepoLocalManagementEnabled && (addRepoError || addRepoState === 'saved') ? (
                <p
                  className={`mt-3 rounded-md border px-3 py-2 text-[12px] ${
                    addRepoError
                      ? 'border-red-500/30 bg-red-500/[0.06] text-red-300'
                      : 'border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-300'
                  }`}
                >
                  {addRepoError ?? 'Repository added.'}
                </p>
              ) : null}

              <div className="mt-3 flex flex-col gap-2">
                {repos === null && !loadError ? (
                  <p className="px-3 py-4 text-[12px] text-zinc-600">Loading…</p>
                ) : (
                  repos?.map((repo, index) => {
                    const key = multiRepoLocalManagementEnabled ? repo.id : repo.rootPath;
                    return (
                      <RepoCard
                        key={key}
                        repo={repo}
                        repoCount={repos?.length ?? 0}
                        repoState={repoStates[repo.id]}
                        primary={index === 0}
                        multiRepoManagementEnabled={multiRepoLocalManagementEnabled}
                        expanded={expanded[key] ?? false}
                        onToggle={() =>
                          setExpanded((prev) => ({
                            ...prev,
                            [key]: !(prev[key] ?? false),
                          }))
                        }
                        onSaved={(repos) => {
                          setRepos(repos);
                          void onProjectAgentPrefsRefresh?.();
                        }}
                        onReposChanged={async (repos) => {
                          setRepos(repos);
                          await refreshRepoStates(repos);
                          await onProjectAgentPrefsRefresh?.();
                        }}
                      />
                    );
                  })
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function CloudRepoBindingStatusBadge({ status }: { status: CloudRepoLocalBindingStatus }) {
  if (status.kind === 'missing_binding') {
    return (
      <span className="rounded-full border border-zinc-500/25 bg-zinc-500/[0.06] px-1.5 py-0.5 text-[10px] text-zinc-400">
        Missing local path
      </span>
    );
  }
  if (status.pathStatus === 'valid') {
    return null;
  }
  if (status.pathStatus === 'missing') {
    return (
      <span className="rounded-full border border-red-500/25 bg-red-500/[0.06] px-1.5 py-0.5 text-[10px] text-red-300">
        Path missing
      </span>
    );
  }
  return (
    <span className="rounded-full border border-amber-500/25 bg-amber-500/[0.06] px-1.5 py-0.5 text-[10px] text-amber-300">
      Not a git repo
    </span>
  );
}

function CloudTeamReposBindingsSection({
  project,
  onBindingsChanged,
  onSharedReposChanged,
  addRepoActionError,
  addRepoActionSaved,
}: {
  project: CloudProject;
  onBindingsChanged?: () => void | Promise<void>;
  onSharedReposChanged?: (repos: CloudSharedRepo[]) => void;
  addRepoActionError?: string | null;
  addRepoActionSaved?: boolean;
}) {
  const [overview, setOverview] = useState<CloudRepoBindingOverview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionRepoId, setActionRepoId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const displayedActionError = actionError ?? addRepoActionError ?? null;

  const sharedReposKey = project.sharedRepos.map((s) => s.id).join(',');

  const refreshOverview = useCallback(async () => {
    try {
      const r = await window.electronAPI.project.getCloudRepoBindingOverview(project.sharedRepos);
      if (r && typeof r === 'object' && 'error' in r && typeof (r as { error: string }).error === 'string') {
        setLoadError((r as { error: string }).error);
        setOverview(null);
        return;
      }
      setOverview(r as CloudRepoBindingOverview);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
      setOverview(null);
    }
  }, [project.sharedRepos, sharedReposKey]);

  useEffect(() => {
    void refreshOverview();
  }, [refreshOverview, project.id, sharedReposKey]);

  const handleBind = async (repoId: string) => {
    setActionRepoId(repoId);
    setActionError(null);
    try {
      const picked = await window.electronAPI.project.pickRepoDirectory();
      if (!picked) {
        setActionRepoId(null);
        return;
      }
      if ('error' in picked) {
        setActionError(
          picked.error === 'NOT_GIT_REPO'
            ? 'Choose a folder that contains a .git directory.'
            : picked.error,
        );
        setActionRepoId(null);
        return;
      }
      const result = await window.electronAPI.project.bindCloudSharedRepo({
        repoId,
        rootPath: picked.rootPath,
        sharedRepos: project.sharedRepos,
      });
      if ('error' in result) {
        setActionError(result.error);
        setActionRepoId(null);
        return;
      }
      await refreshOverview();
      await onBindingsChanged?.();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionRepoId(null);
    }
  };

  if (project.sharedRepos.length === 0) {
    return (
      <div className="mt-4">
        {displayedActionError ? (
          <p className="mb-3 rounded-md border border-red-500/30 bg-red-500/[0.06] px-3 py-2 text-[12px] text-red-300">
            {displayedActionError}
          </p>
        ) : null}
        <p className="text-[12px] text-zinc-500">
          No shared repositories are listed for this cloud project yet. Use Add repo to add
          one to the team project and bind it on this machine.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-3 flex flex-col gap-2">
      {loadError ? (
        <p className="rounded-md border border-red-500/30 bg-red-500/[0.06] px-3 py-2 text-[12px] text-red-300">
          {loadError}
        </p>
      ) : null}
      {displayedActionError ? (
        <p className="rounded-md border border-red-500/30 bg-red-500/[0.06] px-3 py-2 text-[12px] text-red-300">
          {displayedActionError}
        </p>
      ) : addRepoActionSaved ? (
        <p className="rounded-md border border-emerald-500/20 bg-emerald-500/[0.06] px-3 py-2 text-[12px] text-emerald-300">
          Repository added.
        </p>
      ) : null}
      {project.sharedRepos.map((sr, index) => {
        const st = overview?.[sr.id];
        const isExpanded = expanded[sr.id] ?? false;
        return (
          <div
            key={sr.id}
            className="rounded-xl border border-white/[0.08] bg-white/[0.02]"
          >
            <button
              type="button"
              onClick={() =>
                setExpanded((prev) => ({ ...prev, [sr.id]: !(prev[sr.id] ?? false) }))
              }
              className="flex w-full flex-wrap items-start justify-between gap-3 px-4 py-3 text-left"
              aria-expanded={isExpanded}
            >
              <div className="flex min-w-0 flex-1 gap-2">
                <ChevronRight
                  className={`mt-0.5 shrink-0 text-zinc-500 transition-transform ${
                    isExpanded ? 'rotate-90' : ''
                  }`}
                />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-medium text-zinc-200">{sr.name}</span>
                  {index === 0 ? (
                    <span className="rounded-full border border-emerald-500/20 bg-emerald-500/[0.08] px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">
                      Primary
                    </span>
                  ) : null}
                  {st ? (
                    <CloudRepoBindingStatusBadge status={st} />
                  ) : (
                    <span className="text-[10px] text-zinc-600">…</span>
                  )}
                </div>
                <p className="mt-1 text-[11px] text-zinc-500">
                  Base branch:{' '}
                  <span className="font-mono text-zinc-400">{sr.baseBranch}</span>
                  {sr.remoteUrl ? (
                    <>
                      {' '}
                      ·{' '}
                      <span
                        className="font-mono text-zinc-500"
                        title={sr.remoteUrl}
                      >
                        {sr.remoteUrl.length > 56 ? `${sr.remoteUrl.slice(0, 54)}…` : sr.remoteUrl}
                      </span>
                    </>
                  ) : null}
                </p>
                {st?.kind === 'bound' ? (
                  <p
                    className="mt-1 truncate font-mono text-[11px] text-zinc-600"
                    title={st.rootPath}
                  >
                    {st.rootPath}
                  </p>
                ) : null}
                {st?.kind === 'bound' && st.pathStatus === 'missing' ? (
                  <p className="mt-2 text-[11px] text-red-300">
                    This path no longer exists on disk. Bind a different folder.
                  </p>
                ) : null}
                {st?.kind === 'bound' && st.pathStatus === 'not_git' ? (
                  <p className="mt-2 text-[11px] text-amber-300">
                    This folder is not a git repository root. Choose another folder.
                  </p>
                ) : null}
              </div>
              </div>
            </button>
            {isExpanded ? (
              <div className="border-t border-white/[0.06] px-4 py-4">
                <CloudRepoFields
                  project={project}
                  repo={sr}
                  status={st}
                  onSharedReposChanged={onSharedReposChanged}
                  onBindingsChanged={onBindingsChanged}
                />
              </div>
            ) : null}
            <div className="flex justify-end border-t border-white/[0.04] px-4 py-3">
              <button
                type="button"
                onClick={() => void handleBind(sr.id)}
                disabled={actionRepoId === sr.id}
                className="shrink-0 rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-[12px] font-medium text-zinc-200 transition hover:bg-white/[0.07] disabled:opacity-50"
              >
                {actionRepoId === sr.id
                  ? 'Working…'
                  : st?.kind === 'bound'
                    ? 'Change folder'
                    : 'Bind local folder'}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CloudRepoFields({
  project,
  repo,
  status,
  onSharedReposChanged,
  onBindingsChanged,
}: {
  project: CloudProject;
  repo: CloudSharedRepo;
  status?: CloudRepoLocalBindingStatus;
  onSharedReposChanged?: (repos: CloudSharedRepo[]) => void;
  onBindingsChanged?: () => void | Promise<void>;
}) {
  const [name, setName] = useState(repo.name);
  const [baseBranch, setBaseBranch] = useState(repo.baseBranch);
  const [remoteUrl, setRemoteUrl] = useState(repo.remoteUrl ?? '');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(repo.name);
    setBaseBranch(repo.baseBranch);
    setRemoteUrl(repo.remoteUrl ?? '');
    setSaveState('idle');
    setError(null);
  }, [repo.id, repo.name, repo.baseBranch, repo.remoteUrl]);

  const save = async () => {
    const trimmedName = name.trim();
    const trimmedBase = baseBranch.trim();
    if (!trimmedName) {
      setSaveState('error');
      setError('Display name is required.');
      return;
    }
    setSaveState('saving');
    setError(null);
    try {
      const nextRepos = project.sharedRepos.map((r) => {
        if (r.id !== repo.id) return r;
        const next: CloudSharedRepo = {
          ...r,
          name: trimmedName,
          baseBranch: trimmedBase || 'main',
        };
        const trimmedRemote = remoteUrl.trim();
        if (trimmedRemote) {
          next.remoteUrl = trimmedRemote;
        } else {
          delete next.remoteUrl;
        }
        return next;
      });
      await updateCloudProjectRepos(project.id, nextRepos);
      onSharedReposChanged?.(nextRepos);
      const syncResult = await window.electronAPI.project.syncCloudSharedRepos(nextRepos);
      if ('error' in syncResult) {
        throw new Error(syncResult.error);
      }
      await onBindingsChanged?.();
      setSaveState('saved');
      window.setTimeout(() => {
        setSaveState((state) => (state === 'saved' ? 'idle' : state));
      }, 1500);
    } catch (err) {
      setSaveState('error');
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const bindingCopy =
    status?.kind === 'bound'
      ? status.rootPath
      : 'No local folder is bound on this machine.';

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-white/[0.06] bg-black/10 px-3 py-2">
        <div className="text-[12px] font-medium text-zinc-300">Repository binding</div>
        <p className="mt-0.5 truncate font-mono text-[11px] text-zinc-600" title={bindingCopy}>
          {bindingCopy}
        </p>
      </div>
      <label className="block">
        <span className="text-[12px] font-medium text-zinc-300">Display name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1.5 w-full rounded-md border border-white/[0.08] bg-black/20 px-2.5 py-1.5 text-[13px] text-zinc-100 outline-none focus:border-white/[0.16]"
        />
      </label>
      <label className="block">
        <span className="text-[12px] font-medium text-zinc-300">Base branch</span>
        <input
          value={baseBranch}
          onChange={(e) => setBaseBranch(e.target.value)}
          placeholder="main"
          className="mt-1.5 w-full rounded-md border border-white/[0.08] bg-black/20 px-2.5 py-1.5 font-mono text-[13px] text-zinc-100 outline-none focus:border-white/[0.16]"
        />
      </label>
      <label className="block">
        <span className="text-[12px] font-medium text-zinc-300">Remote origin</span>
        <input
          value={remoteUrl}
          onChange={(e) => setRemoteUrl(e.target.value)}
          placeholder="https://github.com/org/repo.git"
          className="mt-1.5 w-full rounded-md border border-white/[0.08] bg-black/20 px-2.5 py-1.5 font-mono text-[13px] text-zinc-100 outline-none focus:border-white/[0.16]"
        />
      </label>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saveState === 'saving'}
          className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-[12px] font-medium text-zinc-200 transition hover:bg-white/[0.07] disabled:pointer-events-none disabled:opacity-50"
        >
          {saveState === 'saving' ? 'Saving...' : 'Save repository'}
        </button>
        {error ? (
          <span className="text-[11px] text-red-400">{error}</span>
        ) : saveState === 'saved' ? (
          <span className="text-[11px] text-emerald-400">Saved</span>
        ) : null}
      </div>
    </div>
  );
}

interface RepoCardProps {
  repo: RepoConfig;
  repoCount: number;
  repoState?: RepoManagementState;
  primary: boolean;
  multiRepoManagementEnabled: boolean;
  expanded: boolean;
  onToggle: () => void;
  onSaved: (repos: RepoConfig[]) => void;
  onReposChanged: (repos: RepoConfig[]) => void | Promise<void>;
}

function RepoCard({
  repo,
  repoCount,
  repoState,
  primary,
  multiRepoManagementEnabled,
  expanded,
  onToggle,
  onSaved,
  onReposChanged,
}: RepoCardProps) {
  const label = repoDisplayLabelForSettings(repo);
  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.02]">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-4 py-3 text-left"
        aria-expanded={expanded}
      >
        <ChevronRight
          className={`shrink-0 text-zinc-500 transition-transform ${
            expanded ? 'rotate-90' : ''
          }`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span
              className={`truncate ${
                multiRepoManagementEnabled
                  ? 'text-[13px] font-medium text-zinc-200'
                  : 'font-mono text-[12px] text-zinc-200'
              }`}
              title={multiRepoManagementEnabled ? label : repo.rootPath}
            >
              {multiRepoManagementEnabled ? label : repo.rootPath}
            </span>
            {primary && multiRepoManagementEnabled ? (
              <span className="rounded-full border border-emerald-500/20 bg-emerald-500/[0.08] px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">
                Primary
              </span>
            ) : null}
            {multiRepoManagementEnabled && repoState ? (
              <RepoStateBadge state={repoState} />
            ) : null}
          </div>
          <div className="mt-0.5 truncate text-[11px] text-zinc-600">
            {multiRepoManagementEnabled ? (
              <span className="font-mono" title={repo.rootPath}>
                {repo.rootPath}
              </span>
            ) : null}
            {multiRepoManagementEnabled ? ' · ' : ''}
            base: {repo.baseBranch}
            {repo.setupScript ? ' · setup script' : ''}
            {repo.env ? ' · .env' : ''}
          </div>
        </div>
      </button>
      {expanded ? (
        <div className="border-t border-white/[0.06] px-4 py-4">
          <RepoFields
            repo={repo}
            repoCount={repoCount}
            repoState={repoState}
            primary={primary}
            multiRepoManagementEnabled={multiRepoManagementEnabled}
            onSaved={onSaved}
            onReposChanged={onReposChanged}
          />
        </div>
      ) : null}
    </div>
  );
}

function RepoStateBadge({ state }: { state: RepoManagementState }) {
  if (state.pathStatus === 'valid' && !state.removalBlocked) {
    return null;
  }

  if (state.pathStatus === 'missing') {
    return (
      <span className="rounded-full border border-red-500/25 bg-red-500/[0.06] px-1.5 py-0.5 text-[10px] text-red-300">
        Missing path
      </span>
    );
  }

  if (state.pathStatus === 'not_git') {
    return (
      <span className="rounded-full border border-amber-500/25 bg-amber-500/[0.06] px-1.5 py-0.5 text-[10px] text-amber-300">
        Not a git repo
      </span>
    );
  }

  return null;
}

interface RepoFieldsProps {
  repo: RepoConfig;
  repoCount: number;
  repoState?: RepoManagementState;
  primary: boolean;
  multiRepoManagementEnabled: boolean;
  onSaved: (repos: RepoConfig[]) => void;
  onReposChanged: (repos: RepoConfig[]) => void | Promise<void>;
}

function RepoFields({
  repo,
  repoCount,
  repoState,
  primary,
  multiRepoManagementEnabled,
  onSaved,
  onReposChanged,
}: RepoFieldsProps) {
  const [actionState, setActionState] = useState<SaveState>('idle');
  const [actionError, setActionError] = useState<string | null>(null);

  const removalBlocked =
    repoCount <= 1 || (repoState?.removalBlocked ?? false);
  const removalBlockCopy =
    repoCount <= 1
      ? 'A project must have at least one repository.'
      : repoState?.removalBlocked
        ? removalBlockedMessage(repoState)
        : null;

  const handleSetPrimary = async () => {
    if (!multiRepoManagementEnabled || primary) return;
    setActionState('saving');
    setActionError(null);
    const result = await window.electronAPI.project.setPrimaryRepo({ repoId: repo.id });
    if ('error' in result) {
      setActionState('error');
      setActionError(result.error);
      return;
    }
    await onReposChanged(result.repos);
    setActionState('saved');
    window.setTimeout(() => {
      setActionState((state) => (state === 'saved' ? 'idle' : state));
    }, 1500);
  };

  const handleRemove = async () => {
    if (!multiRepoManagementEnabled || removalBlocked) return;
    setActionState('saving');
    setActionError(null);
    const result = await window.electronAPI.project.removeRepo({ repoId: repo.id });
    if ('error' in result) {
      setActionState('error');
      setActionError(result.error);
      return;
    }
    await onReposChanged(result.repos);
    setActionState('saved');
  };

  return (
    <div className="flex flex-col gap-5">
      {multiRepoManagementEnabled ? (
        <>
          <div className="rounded-lg border border-white/[0.06] bg-black/10 px-3 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[12px] font-medium text-zinc-300">
                  Repository binding
                </div>
                <p className="mt-0.5 truncate font-mono text-[11px] text-zinc-600" title={repo.rootPath}>
                  {repo.rootPath}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {repoState ? <RepoStateBadge state={repoState} /> : null}
                <button
                  type="button"
                  onClick={() => void handleSetPrimary()}
                  disabled={primary || actionState === 'saving'}
                  className="rounded-md border border-white/[0.08] bg-white/[0.03] px-2.5 py-1.5 text-[12px] font-medium text-zinc-200 transition hover:bg-white/[0.06] disabled:pointer-events-none disabled:opacity-45"
                >
                  {primary ? 'Primary repo' : 'Set primary'}
                </button>
              </div>
            </div>
            {repoState?.pathStatus === 'missing' ? (
              <p className="mt-2 text-[11px] text-red-300">
                This path no longer exists on disk.
              </p>
            ) : repoState?.pathStatus === 'not_git' ? (
              <p className="mt-2 text-[11px] text-amber-300">
                This folder exists, but Flux cannot find a .git directory in it.
              </p>
            ) : null}
          </div>
          <FieldEditor
            label="Display name"
            description="Optional label shown for this repository in Flux."
            repoId={repo.id}
            rootPath={repo.rootPath}
            useRepoId={multiRepoManagementEnabled}
            field="name"
            initialValue={repo.name ?? ''}
            placeholder={repoDisplayLabelForSettings({ ...repo, name: undefined })}
            onSaved={onSaved}
          />
        </>
      ) : null}
      <FieldEditor
        label="Base branch"
        description="Branch fetched from origin and used as the base for new task worktrees."
        repoId={repo.id}
        rootPath={repo.rootPath}
        useRepoId={multiRepoManagementEnabled}
        field="baseBranch"
        initialValue={repo.baseBranch}
        placeholder="main"
        onSaved={onSaved}
      />
      <FieldEditor
        label="Setup script"
        description="Bash script run inside each new worktree after creation. Output is logged to .flux-setup.log."
        repoId={repo.id}
        rootPath={repo.rootPath}
        useRepoId={multiRepoManagementEnabled}
        field="setupScript"
        initialValue={repo.setupScript ?? ''}
        placeholder={'# e.g.\nnpm install\n'}
        multiline
        onSaved={onSaved}
      />
      <FieldEditor
        label=".env contents"
        description="Written verbatim to .env in each new worktree. Stored locally in plaintext."
        repoId={repo.id}
        rootPath={repo.rootPath}
        useRepoId={multiRepoManagementEnabled}
        field="env"
        initialValue={repo.env ?? ''}
        placeholder={'KEY=value\n'}
        multiline
        sensitive
        onSaved={onSaved}
      />
      {multiRepoManagementEnabled ? (
        <div className="border-t border-white/[0.06] pt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-[12px] font-medium text-zinc-300">
                Remove repository
              </div>
              <p className="mt-0.5 text-[11px] leading-snug text-zinc-600">
                Removes this repo from project settings. Files on disk are not deleted.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void handleRemove()}
              disabled={removalBlocked || actionState === 'saving'}
              className="rounded-md border border-red-500/30 bg-red-500/[0.06] px-2.5 py-1.5 text-[12px] font-medium text-red-200 transition hover:bg-red-500/[0.1] disabled:pointer-events-none disabled:opacity-45"
            >
              {actionState === 'saving' ? 'Working…' : 'Remove'}
            </button>
          </div>
          {removalBlockCopy ? (
            <p className="mt-2 text-[11px] text-amber-300">{removalBlockCopy}</p>
          ) : null}
          {actionError ? (
            <p className="mt-2 text-[11px] text-red-400">{actionError}</p>
          ) : actionState === 'saved' ? (
            <p className="mt-2 text-[11px] text-emerald-400">Saved</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function removalBlockedMessage(state: RepoManagementState): string {
  const parts: string[] = [];
  if (state.blockingTaskCount > 0) {
    parts.push(`${state.blockingTaskCount} task(s)`);
  }
  if (state.blockingWorkspaceCount > 0) {
    parts.push(`${state.blockingWorkspaceCount} workspace(s)`);
  }
  return `Cannot remove while ${parts.join(' and ')} still reference this repository.`;
}

function repoDisplayLabelForSettings(
  repo: Pick<RepoConfig, 'id' | 'name' | 'rootPath'>,
): string {
  const explicit = (repo.name ?? '').trim();
  if (explicit) return explicit;
  const cleaned = repo.rootPath.replace(/[\\/]+$/, '');
  const base = cleaned.split(/[\\/]/).filter(Boolean).pop();
  if (base) return base;
  return repo.id ? `repo:${repo.id.slice(0, 7)}` : 'repo';
}

interface FieldEditorProps {
  label: string;
  description: string;
  repoId: string;
  rootPath: string;
  useRepoId: boolean;
  field: 'name' | 'baseBranch' | 'setupScript' | 'env';
  initialValue: string;
  placeholder?: string;
  multiline?: boolean;
  sensitive?: boolean;
  onSaved: (repos: RepoConfig[]) => void;
}

function FieldEditor({
  label,
  description,
  repoId,
  rootPath,
  useRepoId,
  field,
  initialValue,
  placeholder,
  multiline,
  sensitive,
  onSaved,
}: FieldEditorProps) {
  const [value, setValue] = useState(initialValue);
  const [savedValue, setSavedValue] = useState(initialValue);
  const [state, setState] = useState<SaveState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(!sensitive || initialValue.length === 0);

  useEffect(() => {
    setValue(initialValue);
    setSavedValue(initialValue);
    setState('idle');
    setError(null);
  }, [initialValue]);

  const dirty = value !== savedValue;

  const handleSave = async () => {
    if (!dirty) return;
    setState('saving');
    setError(null);
    const result = useRepoId
      ? await window.electronAPI.project.updateRepoById({
          repoId,
          patch: { [field]: value },
        })
      : await window.electronAPI.project.updateRepo({
          rootPath,
          patch: { [field]: value },
        });
    if ('error' in result) {
      setState('error');
      setError(result.error);
      return;
    }
    setSavedValue(value);
    setState('saved');
    onSaved(result.repos);
    window.setTimeout(() => {
      setState((s) => (s === 'saved' ? 'idle' : s));
    }, 1500);
  };

  const showMasked = sensitive && !revealed;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label className="text-[12px] font-medium text-zinc-300">{label}</label>
        {sensitive ? (
          <button
            type="button"
            onClick={() => setRevealed((r) => !r)}
            className="text-[11px] text-zinc-500 transition hover:text-zinc-300"
          >
            {revealed ? 'Hide' : 'Reveal'}
          </button>
        ) : null}
      </div>
      <p className="mt-0.5 text-[11px] leading-snug text-zinc-600">{description}</p>
      <div className="mt-2">
        {multiline ? (
          <textarea
            value={showMasked ? maskValue(value) : value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            disabled={showMasked}
            rows={Math.min(10, Math.max(4, value.split('\n').length + 1))}
            className="block w-full rounded-md border border-white/[0.08] bg-[#09090b] px-3 py-2 font-mono text-[12px] leading-relaxed text-zinc-100 outline-none focus-visible:border-white/[0.14] focus-visible:ring-1 focus-visible:ring-white/[0.12] disabled:opacity-60"
          />
        ) : (
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            className="block w-full rounded-md border border-white/[0.08] bg-[#09090b] px-3 py-2 text-[13px] text-zinc-100 outline-none focus-visible:border-white/[0.14] focus-visible:ring-1 focus-visible:ring-white/[0.12]"
          />
        )}
      </div>
      <div className="mt-2 flex items-center justify-end gap-3">
        {state === 'error' && error ? (
          <span className="text-[11px] text-red-400">{error}</span>
        ) : state === 'saved' ? (
          <span className="text-[11px] text-emerald-400">Saved</span>
        ) : dirty ? (
          <span className="text-[11px] text-zinc-500">Unsaved changes</span>
        ) : null}
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={!dirty || state === 'saving' || showMasked}
          className="rounded-md bg-white px-3 py-1 text-[12px] font-medium text-zinc-950 transition hover:bg-zinc-100 disabled:pointer-events-none disabled:opacity-40"
        >
          {state === 'saving' ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

function maskValue(value: string): string {
  if (!value) return '';
  return value.replace(/[^\n]/g, '•');
}

function ChevronRight({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width={12}
      height={12}
      viewBox="0 0 12 12"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M4 2.5L7.5 6L4 9.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
