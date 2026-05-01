import { useCallback, useEffect, useState } from 'react';
import { AGENTS, type Agent, type CloudProject, type LocalProject, type RepoConfig } from '../types';
import { defaultTaskAgentForProject } from '../cloudBindingPrefs';
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
  const [planningAgentSaveState, setPlanningAgentSaveState] = useState<SaveState>('idle');
  const [planningAgentError, setPlanningAgentError] = useState<string | null>(null);
  const [defaultTaskAgentSaveState, setDefaultTaskAgentSaveState] = useState<SaveState>('idle');
  const [defaultTaskAgentError, setDefaultTaskAgentError] = useState<string | null>(null);

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
  }, [project.id]);

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

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl px-8 py-10">
        <h1 className="text-[18px] font-semibold tracking-tight text-zinc-100">
          Project Config
        </h1>
        <p className="mt-1 text-[13px] text-zinc-500">
          Configure how new task workspaces are created for {project.name}.
        </p>

        <section className="mt-6 rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-[13px] font-medium text-zinc-200">
                Auto-start sessions when tasks enter In progress
              </h2>
              <p className="mt-0.5 text-[12px] leading-snug text-zinc-500">
                Applies to status transitions from board drag, task detail status updates,
                and MCP <code className="text-zinc-400">flux__update_task</code>.
                <code className="ml-1 text-zinc-400">flux__start_task</code> always starts
                a session regardless of this setting.
              </p>
            </div>
            <label className="inline-flex cursor-pointer items-center gap-2 text-[12px] text-zinc-300">
              <input
                type="checkbox"
                checked={autoStartEnabled}
                disabled={autoStartLoading || autoStartSaveState === 'saving'}
                onChange={(e) => void handleAutoStartChange(e.target.checked)}
                className="h-4 w-4 rounded border-white/[0.2] bg-[#09090b]"
              />
              Enabled
            </label>
          </div>
          <div className="mt-2 min-h-4 text-[11px]">
            {autoStartSaveState === 'saving' ? (
              <span className="text-zinc-500">Saving…</span>
            ) : autoStartSaveState === 'saved' ? (
              <span className="text-emerald-400">Saved</span>
            ) : autoStartError ? (
              <span className="text-red-400">{autoStartError}</span>
            ) : null}
          </div>
        </section>

        <section className="mt-4 rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-[13px] font-medium text-zinc-200">
                Auto-start when dependencies unblock
              </h2>
              <p className="mt-0.5 text-[12px] leading-snug text-zinc-500">
                When a task is waiting on other tasks, start a session automatically after the last
                blocking task is completed. You can also opt in per task from the card or task detail.
                Uses the same session start path as “In progress” (worktree, agent, model). Pair with
                the setting above, or use this alone for dependency-driven runs.
              </p>
            </div>
            <label className="inline-flex cursor-pointer items-center gap-2 text-[12px] text-zinc-300">
              <input
                type="checkbox"
                checked={whenUnblockedEnabled}
                disabled={whenUnblockedLoading || whenUnblockedSaveState === 'saving'}
                onChange={(e) => void handleWhenUnblockedChange(e.target.checked)}
                className="h-4 w-4 rounded border-white/[0.2] bg-[#09090b]"
              />
              Enabled
            </label>
          </div>
          <div className="mt-2 min-h-4 text-[11px]">
            {whenUnblockedSaveState === 'saving' ? (
              <span className="text-zinc-500">Saving…</span>
            ) : whenUnblockedSaveState === 'saved' ? (
              <span className="text-emerald-400">Saved</span>
            ) : whenUnblockedError ? (
              <span className="text-red-400">{whenUnblockedError}</span>
            ) : null}
          </div>
        </section>

        <section className="mt-4 rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
          <h2 className="text-[13px] font-medium text-zinc-200">Default agents</h2>
          <p className="mt-0.5 text-[12px] leading-snug text-zinc-500">
            These apply to this project on this machine. Planning defaults match the Planning
            sidebar; the task default is used for new tasks and when MCP tools create a task
            without specifying an agent.
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
                Agent for new planning sessions (same control as in the Planning panel).
              </p>
              <select
                id="project-settings-planning-agent"
                aria-label="Planning assistant default"
                value={planningAgentValue}
                disabled={planningAgentSaveState === 'saving'}
                onChange={(e) => {
                  const next = e.target.value as Agent;
                  void handlePlanningAgentChange(next);
                }}
                className="mt-2 block w-full max-w-xs cursor-pointer rounded-md border border-white/[0.08] bg-[#09090b] py-2 pl-3 pr-8 text-[13px] text-zinc-100 outline-none focus:border-white/[0.14] focus:ring-1 focus:ring-white/[0.12] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {AGENTS.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
              <div className="mt-1.5 min-h-4 text-[11px]">
                {planningAgentSaveState === 'saving' ? (
                  <span className="text-zinc-500">Saving…</span>
                ) : planningAgentSaveState === 'saved' ? (
                  <span className="text-emerald-400">Saved</span>
                ) : planningAgentError ? (
                  <span className="text-red-400">{planningAgentError}</span>
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
                Used when creating new tasks and when tools create tasks without an agent.
              </p>
              <select
                id="project-settings-default-task-agent"
                aria-label="Default task agent"
                value={defaultTaskAgentValue}
                disabled={defaultTaskAgentSaveState === 'saving'}
                onChange={(e) => {
                  const next = e.target.value as Agent;
                  void handleDefaultTaskAgentChange(next);
                }}
                className="mt-2 block w-full max-w-xs cursor-pointer rounded-md border border-white/[0.08] bg-[#09090b] py-2 pl-3 pr-8 text-[13px] text-zinc-100 outline-none focus:border-white/[0.14] focus:ring-1 focus:ring-white/[0.12] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {AGENTS.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
              <div className="mt-1.5 min-h-4 text-[11px]">
                {defaultTaskAgentSaveState === 'saving' ? (
                  <span className="text-zinc-500">Saving…</span>
                ) : defaultTaskAgentSaveState === 'saved' ? (
                  <span className="text-emerald-400">Saved</span>
                ) : defaultTaskAgentError ? (
                  <span className="text-red-400">{defaultTaskAgentError}</span>
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
