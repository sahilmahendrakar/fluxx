import { useCallback, useEffect, useId, useState, type ReactNode } from 'react';
import {
  AGENTS,
  DEFAULT_CURSOR_AGENT_MODEL,
  type Agent,
  type AgentSpawnDefaultsPatch,
  type CloudProject,
  type LocalProject,
  type RepoConfig,
} from '../types';
import { defaultTaskAgentForProject } from '../cloudBindingPrefs';
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
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';
type Category = 'project' | 'team';

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
}

function ProjectConfigPane({
  project,
  onAutoStartWhenUnblockedChange,
  onProjectAgentPrefsRefresh,
}: ProjectConfigPaneProps) {
  const [repos, setRepos] = useState<RepoConfig[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
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

  const refresh = useCallback(async () => {
    try {
      const next = await window.electronAPI.project.getRepos();
      setRepos(next);
      setLoadError(null);
      setExpanded((prev) => {
        if (Object.keys(prev).length > 0) return prev;
        if (next.length === 1) return { [next[0].rootPath]: true };
        return prev;
      });
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, []);

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
          <div className="flex items-baseline justify-between">
            <h2 className="text-[13px] font-medium uppercase tracking-[0.12em] text-zinc-500">
              Repositories
            </h2>
            <span className="text-[11px] text-zinc-600">
              {repos?.length ?? 0} {repos?.length === 1 ? 'repo' : 'repos'}
            </span>
          </div>

          {loadError ? (
            <p className="mt-4 rounded-md border border-red-500/30 bg-red-500/[0.06] px-3 py-2 text-[12px] text-red-300">
              {loadError}
            </p>
          ) : null}

          <div className="mt-3 flex flex-col gap-2">
            {repos === null && !loadError ? (
              <p className="px-3 py-4 text-[12px] text-zinc-600">Loading…</p>
            ) : (
              repos?.map((repo) => (
                <RepoCard
                  key={repo.rootPath}
                  repo={repo}
                  expanded={expanded[repo.rootPath] ?? false}
                  onToggle={() =>
                    setExpanded((prev) => ({
                      ...prev,
                      [repo.rootPath]: !(prev[repo.rootPath] ?? false),
                    }))
                  }
                  onSaved={(repos) => setRepos(repos)}
                />
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

interface RepoCardProps {
  repo: RepoConfig;
  expanded: boolean;
  onToggle: () => void;
  onSaved: (repos: RepoConfig[]) => void;
}

function RepoCard({ repo, expanded, onToggle, onSaved }: RepoCardProps) {
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
          <div
            className="truncate font-mono text-[12px] text-zinc-200"
            title={repo.rootPath}
          >
            {repo.rootPath}
          </div>
          <div className="mt-0.5 truncate text-[11px] text-zinc-600">
            base: {repo.baseBranch}
            {repo.setupScript ? ' · setup script' : ''}
            {repo.env ? ' · .env' : ''}
          </div>
        </div>
      </button>
      {expanded ? (
        <div className="border-t border-white/[0.06] px-4 py-4">
          <RepoFields repo={repo} onSaved={onSaved} />
        </div>
      ) : null}
    </div>
  );
}

interface RepoFieldsProps {
  repo: RepoConfig;
  onSaved: (repos: RepoConfig[]) => void;
}

function RepoFields({ repo, onSaved }: RepoFieldsProps) {
  return (
    <div className="flex flex-col gap-5">
      <FieldEditor
        label="Base branch"
        description="Branch fetched from origin and used as the base for new task worktrees."
        rootPath={repo.rootPath}
        field="baseBranch"
        initialValue={repo.baseBranch}
        placeholder="main"
        onSaved={onSaved}
      />
      <FieldEditor
        label="Setup script"
        description="Bash script run inside each new worktree after creation. Output is logged to .flux-setup.log."
        rootPath={repo.rootPath}
        field="setupScript"
        initialValue={repo.setupScript ?? ''}
        placeholder={'# e.g.\nnpm install\n'}
        multiline
        onSaved={onSaved}
      />
      <FieldEditor
        label=".env contents"
        description="Written verbatim to .env in each new worktree. Stored locally in plaintext."
        rootPath={repo.rootPath}
        field="env"
        initialValue={repo.env ?? ''}
        placeholder={'KEY=value\n'}
        multiline
        sensitive
        onSaved={onSaved}
      />
    </div>
  );
}

interface FieldEditorProps {
  label: string;
  description: string;
  rootPath: string;
  field: 'baseBranch' | 'setupScript' | 'env';
  initialValue: string;
  placeholder?: string;
  multiline?: boolean;
  sensitive?: boolean;
  onSaved: (repos: RepoConfig[]) => void;
}

function FieldEditor({
  label,
  description,
  rootPath,
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
    const result = await window.electronAPI.project.updateRepo({
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
