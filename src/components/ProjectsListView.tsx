import { Search, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { AppearanceToggle } from './AppearanceToggle';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { hydrateCloudProject, primaryRootPathFromCloudBinding } from '../cloudBindingPrefs';
import {
  cloudProjectUsesLegacyFolderPicker,
  shellCloudBinding,
} from '../cloudProjectActivation';
import { buildCloudSharedReposAtCreate } from '../cloudProjectCreate';
import type { CloudProject, LocalProject } from '../types';
import type { AuthState } from '../renderer/auth/useAuth';
import type { CloudProjectsState } from '../renderer/projects/useCloudProjects';
import type {
  CloudProjectCreateRepoInput,
  CloudProjectSummary,
} from '../renderer/projects/cloudProjects';
import {
  createCloudProject,
  deleteCloudProject,
} from '../renderer/projects/cloudProjects';
import type { InvitesState } from '../renderer/invites/useInvites';
import { acceptInvite } from '../renderer/invites/invites';
import {
  buildProjectPickerRows,
  filterProjectPickerRows,
} from '../renderer/projects/buildProjectPickerRows';
import { NewProjectModal } from './NewProjectModal';
import { InviteTeammateModal } from './InviteTeammateModal';
import { ProjectPickerSyncBadges } from './ProjectPickerSyncBadges';
import { projectCreateErrorMessage } from '../projectCreate';
import {
  sendNewProjectTeamInvites,
  summarizeNewProjectInviteOutcomes,
} from './newProject/newProjectTeamInvites';

type ActiveProject = LocalProject | CloudProject;

const EMPTY_CLOUD_PROJECTS: CloudProjectSummary[] = [];

interface ProjectsListViewProps {
  onProjectActivated: (project: ActiveProject) => void;
  auth: AuthState;
  cloudProjects: CloudProjectsState;
  invites: InvitesState;
  authSlot?: React.ReactNode;
}

export function ProjectsListView({
  onProjectActivated,
  auth,
  cloudProjects,
  invites,
  authSlot,
}: ProjectsListViewProps) {
  const [projects, setProjects] = useState<LocalProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [inviteFor, setInviteFor] = useState<CloudProjectSummary | null>(null);
  const [activatingId, setActivatingId] = useState<string | null>(null);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [localRemovalError, setLocalRemovalError] = useState<string | null>(null);
  const [cloudLocalCleanupError, setCloudLocalCleanupError] = useState<string | null>(null);
  const [cloudLocalCleanupId, setCloudLocalCleanupId] = useState<string | null>(null);
  const [cloudDeleteCleanupWarning, setCloudDeleteCleanupWarning] = useState<string | null>(null);
  /** Local project id currently undergoing local Fluxx data removal. */
  const [localRemovalId, setLocalRemovalId] = useState<string | null>(null);
  const [projectSearchQuery, setProjectSearchQuery] = useState('');
  const [lastOpenedAtByKey, setLastOpenedAtByKey] = useState<Record<string, string>>({});

  const uid = auth.user?.uid ?? null;
  const signedIn = auth.status === 'signedIn';
  const readyCloudProjects =
    cloudProjects.status === 'ready' ? cloudProjects.projects : EMPTY_CLOUD_PROJECTS;

  const cloudProjectIdsKey = useMemo(
    () =>
      cloudProjects.status === 'ready'
        ? cloudProjects.projects.map((p) => p.id).join('\0')
        : '',
    [cloudProjects.status, cloudProjects.projects],
  );

  const pickerRows = useMemo(() => {
    const rows = buildProjectPickerRows({
      localProjects: projects,
      cloudProjects: readyCloudProjects,
      uid,
      lastOpenedAtByKey,
    });
    return filterProjectPickerRows(rows, projectSearchQuery);
  }, [
    projects,
    readyCloudProjects,
    uid,
    lastOpenedAtByKey,
    projectSearchQuery,
  ]);

  const hasAnyPickerRows = useMemo(
    () =>
      buildProjectPickerRows({
        localProjects: projects,
        cloudProjects: readyCloudProjects,
        uid,
        lastOpenedAtByKey,
      }).length > 0,
    [projects, readyCloudProjects, uid, lastOpenedAtByKey],
  );

  const refreshLocal = async () => {
    try {
      const list = await window.electronAPI.projects.listLocal();
      setProjects(list);
    } catch (err) {
      console.error('[projects.listLocal] failed', err);
    }
  };

  const refreshLastOpenedAt = async () => {
    try {
      const map = await window.electronAPI.projects.getPickerLastOpenedAt();
      setLastOpenedAtByKey(map);
    } catch (err) {
      console.error('[projects.getPickerLastOpenedAt] failed', err);
    }
  };

  useEffect(() => {
    let cancelled = false;
    window.electronAPI.projects
      .listLocal()
      .then((list) => {
        if (cancelled) return;
        setProjects(list);
        setLoading(false);
      })
      .catch((err) => {
        console.error('[projects.listLocal] failed', err);
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void refreshLastOpenedAt();
  }, [projects, cloudProjectIdsKey]);

  const handleOpenLocal = async (id: string) => {
    const active = await window.electronAPI.projects.activateLocal(id);
    if (active) onProjectActivated(active);
  };

  const handleRemoveLocalFlux = async (id: string, name: string) => {
    if (
      !window.confirm(
        `Remove "${name}" from Fluxx?\n\nThis deletes Fluxx-owned data under ~/.fluxx for this project (tasks, planning docs, CLI bridge config, and Fluxx-managed git worktrees), stops any running task or planning sessions for it, and clears saved tabs. Your original repository clone is not deleted.`,
      )
    ) {
      return;
    }
    setLocalRemovalError(null);
    setLocalRemovalId(id);
    try {
      const result = await window.electronAPI.projects.removeFluxxOwnedLocalState({
        kind: 'local',
        id,
      });
      const lines = [
        ...result.errors,
        ...result.warnings.map((w) => `Warning: ${w}`),
      ];
      if (lines.length > 0) {
        setLocalRemovalError(lines.join('\n'));
      }
      await refreshLocal();
    } catch (err) {
      console.error('[removeFluxxOwnedLocalState local]', err);
      setLocalRemovalError(
        err instanceof Error ? err.message : 'Could not remove project from Fluxx.',
      );
    } finally {
      setLocalRemovalId(null);
    }
  };

  const handleRemoveCloudLocalData = async (summary: CloudProjectSummary) => {
    if (
      !window.confirm(
        `Remove local Fluxx data for "${summary.name}"?\n\nThis machine will forget the local folder binding, delete Fluxx materialized files under ~/.fluxx for this team project, stop related sessions, and clear saved tabs. The team project in the cloud is unchanged. Your git clone is not deleted.`,
      )
    ) {
      return;
    }
    setCloudLocalCleanupError(null);
    setCloudLocalCleanupId(summary.id);
    try {
      const result = await window.electronAPI.projects.removeFluxxOwnedLocalState({
        kind: 'cloud',
        id: summary.id,
      });
      const lines = [
        ...result.errors,
        ...result.warnings.map((w) => `Warning: ${w}`),
      ];
      if (lines.length > 0) {
        setCloudLocalCleanupError(lines.join('\n'));
      }
    } catch (err) {
      console.error('[removeFluxxOwnedLocalState cloud]', err);
      setCloudLocalCleanupError(
        err instanceof Error ? err.message : 'Could not remove local team project data.',
      );
    } finally {
      setCloudLocalCleanupId(null);
    }
  };

  const handleOpenCloud = async (summary: CloudProjectSummary) => {
    if (!uid) return;
    setCloudError(null);
    setCloudLocalCleanupError(null);
    setActivatingId(summary.id);
    try {
      let binding = await window.electronAPI.projects.getLocalBinding(summary.id);
      const legacyPicker = cloudProjectUsesLegacyFolderPicker(summary.repos);

      if (!binding && legacyPicker) {
        const picked = await window.electronAPI.projects.pickDirectoryForCloud(summary.id);
        if (!picked) return;
        if ('error' in picked) {
          setCloudError('That folder is not a git repository.');
          return;
        }
        binding = await window.electronAPI.projects.getLocalBinding(summary.id);
      }

      const mat = await window.electronAPI.projects.resolveCloudMaterializationDir(summary.id);
      if ('error' in mat) {
        setCloudError(mat.error);
        return;
      }
      const materializationRootPath = mat.projectDir;

      const boundPrimary = binding
        ? primaryRootPathFromCloudBinding(summary.id, binding, summary.repos)
        : undefined;
      const activationRootPath = boundPrimary ?? materializationRootPath;

      const result = await window.electronAPI.projects.activateCloud({
        id: summary.id,
        rootPath: activationRootPath,
        ...(summary.repos?.length ? { sharedRepos: summary.repos } : {}),
      });
      if (!result || 'error' in result) {
        if (boundPrimary) {
          setCloudError(
            result && 'error' in result
              ? 'The bound folder is no longer a git repository. Re-bind it in project settings.'
              : 'Could not activate project.',
          );
          await window.electronAPI.projects.clearLocalBinding(summary.id);
        } else {
          setCloudError('Could not activate project.');
        }
        return;
      }

      const refreshed =
        (await window.electronAPI.projects.getLocalBinding(summary.id)) ??
        binding ??
        shellCloudBinding(new Date().toISOString());

      onProjectActivated(
        hydrateCloudProject(summary, refreshed, {
          materializationRootPath: boundPrimary ? undefined : materializationRootPath,
        }),
      );
    } finally {
      setActivatingId(null);
    }
  };

  const handleCreateLocalFromWizard = async (
    input: import('../projectCreate').ProjectCreateWizardPayload,
  ) => {
    const result = await window.electronAPI.projects.create(input);
    if (!result.ok) {
      return {
        ok: false as const,
        error: result.error,
        message: result.message,
      };
    }
    const active = await window.electronAPI.projects.activateLocal(result.project.id);
    if (active) {
      await refreshLocal();
      onProjectActivated(active);
      return { ok: true as const, project: active };
    }
    return {
      ok: false as const,
      error: 'CREATE_FAILED' as const,
      message: 'Project was created but could not be opened.',
    };
  };

  const handleCreateTeamFromWizard = async (input: {
    name: string;
    repos: CloudProjectCreateRepoInput[];
    primaryRootPath?: string;
    teamInvites: string[];
  }): Promise<{ inviteWarnings: string[] }> => {
    if (!uid) {
      throw new Error(projectCreateErrorMessage('AUTH_REQUIRED'));
    }
    setCloudError(null);
    const summary = await createCloudProject(uid, input.name, {
      displayName: auth.user?.displayName ?? undefined,
      email: auth.user?.email ?? undefined,
      photoURL: auth.user?.photoURL ?? null,
      repos: input.repos.length > 0 ? input.repos : undefined,
      primaryRootPath: input.primaryRootPath,
    });

    if (summary.repos && summary.repos.length > 0 && input.repos.length > 0) {
      const { primaryRepoId } = buildCloudSharedReposAtCreate(
        summary.id,
        input.repos,
        input.primaryRootPath,
      );
      const bindings = summary.repos.map((sr, i) => ({
        repoId: sr.id,
        rootPath: input.repos[i]?.rootPath ?? '',
      }));
      const bindResult = await window.electronAPI.projects.applyCloudCreateBindings({
        cloudProjectId: summary.id,
        bindings: bindings.filter((b) => b.rootPath),
        primaryRepoId,
        sharedRepos: summary.repos,
      });
      if ('error' in bindResult) {
        throw new Error(bindResult.error);
      }
    }

    let inviteWarnings: string[] = [];
    if (input.teamInvites.length > 0) {
      const outcomes = await sendNewProjectTeamInvites(
        summary.id,
        uid,
        input.teamInvites,
        {
          projectName: summary.name,
          inviterName: auth.user?.displayName ?? undefined,
          inviterEmail: auth.user?.email ?? undefined,
        },
      );
      inviteWarnings = summarizeNewProjectInviteOutcomes(outcomes);
    }

    const matDir = await window.electronAPI.projects.resolveCloudMaterializationDir(
      summary.id,
    );
    if (matDir && 'projectDir' in matDir) {
      await window.electronAPI.projectOnboarding.writePending(matDir.projectDir);
    }

    await handleOpenCloud(summary);
    return { inviteWarnings };
  };

  const handleDeleteCloud = async (summary: CloudProjectSummary) => {
    if (!uid) return;
    if (summary.ownerId !== uid) return;
    if (
      !window.confirm(
        `Delete "${summary.name}" from the team?\n\nThis removes the Firestore project for everyone. Any teammate who still has a clone can keep working locally, but shared Fluxx task data in the cloud will be gone.`,
      )
    ) {
      return;
    }
    setCloudDeleteCleanupWarning(null);
    try {
      await deleteCloudProject(summary.id);
    } catch (err) {
      console.error('[deleteCloudProject] failed', err);
      setCloudError(
        err instanceof Error ? err.message : 'Could not delete the team project.',
      );
      return;
    }
    try {
      const result = await window.electronAPI.projects.removeFluxxOwnedLocalState({
        kind: 'cloud',
        id: summary.id,
      });
      const lines = [
        ...result.errors,
        ...result.warnings.map((w) => `Warning: ${w}`),
      ];
      if (lines.length > 0) {
        setCloudDeleteCleanupWarning(
          `The team project was deleted, but some local cleanup steps failed:\n${lines.join('\n')}`,
        );
      }
    } catch (err) {
      console.error('[removeFluxxOwnedLocalState after team delete]', err);
      setCloudDeleteCleanupWarning(
        `The team project was deleted, but local cleanup failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  };

  const handleAcceptInvite = async (projectId: string, email: string) => {
    if (!uid) return;
    setInviteError(null);
    setAcceptingId(projectId);
    try {
      await acceptInvite(
        projectId,
        uid,
        email,
        auth.user?.displayName ?? undefined,
        auth.user?.photoURL ?? null,
      );
    } catch (err) {
      console.error('[acceptInvite] failed', err);
      setInviteError(
        err instanceof Error ? err.message : 'Could not accept invite.',
      );
    } finally {
      setAcceptingId(null);
    }
  };

  return (
    <div className="relative flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-[20%] -top-[10%] h-[min(560px,70vw)] w-[min(560px,70vw)] rounded-full bg-primary/15 blur-[100px]" />
        <div className="absolute -bottom-[15%] -right-[15%] h-[min(480px,65vw)] w-[min(480px,65vw)] rounded-full bg-status-review/15 blur-[100px]" />
      </div>
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            'linear-gradient(hsl(var(--border) / 0.35) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--border) / 0.35) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
          maskImage:
            'radial-gradient(ellipse 80% 60% at 50% 40%, black, transparent)',
        }}
      />

      <div className="relative z-10 mx-auto flex h-full min-h-0 w-full min-w-0 max-w-2xl flex-1 flex-col overflow-hidden px-8 pb-8 pt-16">
        <div className="flex shrink-0 items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl border border-border bg-card/80 shadow-sm backdrop-blur-md">
            <span className="text-base font-semibold tracking-tight text-foreground">F</span>
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">Fluxx</h1>
            <p className="text-[13px] text-muted-foreground">Projects</p>
          </div>
          <AppearanceToggle />
        </div>

        {authSlot ? <div className="mt-8 shrink-0">{authSlot}</div> : null}

        {(() => {
          if (auth.status !== 'signedIn' || invites.status !== 'ready') return null;
          // Hide invites for projects the user already belongs to — "Accept" is
          // a no-op there; those projects appear in the unified Projects list.
          const memberProjectIds = new Set(
            cloudProjects.status === 'ready'
              ? cloudProjects.projects.map((p) => p.id)
              : [],
          );
          const actionable = invites.invites.filter(
            (inv) => !memberProjectIds.has(inv.projectId),
          );
          if (actionable.length === 0) return null;
          return (
          <div className="mt-8 shrink-0">
            <h2 className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Invitations
            </h2>
            {inviteError ? (
              <p className="mb-2 rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
                {inviteError}
              </p>
            ) : null}
            <ul className="flex flex-col gap-1.5">
              {actionable.map((inv) => (
                <li
                  key={`${inv.projectId}-${inv.email}`}
                  className="flex items-center gap-3 rounded-lg border border-status-needs-input/25 bg-status-needs-input/10 px-3 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-foreground">
                      {inv.projectName || '(unknown project)'}
                    </div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      Invited to collaborate
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    disabled={acceptingId === inv.projectId}
                    onClick={() => void handleAcceptInvite(inv.projectId, inv.email)}
                    className="h-7 px-2.5 text-[12px]"
                  >
                    {acceptingId === inv.projectId ? 'Accepting…' : 'Accept'}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
          );
        })()}

        <div className="mt-8 flex min-h-0 min-w-0 flex-1 flex-col">
          <h2 className="mb-2 shrink-0 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Projects
          </h2>

          {loading && !hasAnyPickerRows ? null : (
            <div className="mb-3 flex shrink-0 items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <Search
                  className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  type="search"
                  role="searchbox"
                  inputMode="search"
                  enterKeyHint="search"
                  value={projectSearchQuery}
                  onChange={(e) => setProjectSearchQuery(e.target.value)}
                  placeholder="Search projects…"
                  aria-label="Search projects"
                  autoComplete="off"
                  spellCheck={false}
                  className={cn(
                    'h-9 rounded-lg bg-background/60 pl-8 text-[13px]',
                    projectSearchQuery ? 'pr-8' : undefined,
                  )}
                />
                {projectSearchQuery ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setProjectSearchQuery('')}
                    className="absolute right-0.5 top-1/2 size-7 -translate-y-1/2"
                    aria-label="Clear project search"
                  >
                    <X strokeWidth={2.5} />
                  </Button>
                ) : null}
              </div>
              <Button
                type="button"
                size="sm"
                onClick={() => setNewProjectOpen(true)}
                className="h-9 shrink-0 px-3.5 text-[13px]"
              >
                New project
              </Button>
            </div>
          )}

          {cloudError ? (
            <p className="mb-3 rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-[13px] leading-snug text-destructive">
              {cloudError}
            </p>
          ) : null}

          {signedIn && cloudProjects.status === 'error' ? (
            <p className="mb-3 rounded-lg border border-status-needs-input/25 bg-status-needs-input/10 px-3 py-2 text-[12px] leading-snug text-status-needs-input-foreground">
              Couldn&apos;t load team projects: {cloudProjects.error}. Local projects
              below are still available.
            </p>
          ) : null}

          {cloudDeleteCleanupWarning ? (
            <div
              role="alert"
              className="mb-3 flex items-start gap-2 rounded-lg border border-status-needs-input/25 bg-status-needs-input/10 px-3 py-2 text-[12px] leading-snug text-status-needs-input-foreground"
            >
              <p className="min-w-0 flex-1 whitespace-pre-wrap">{cloudDeleteCleanupWarning}</p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setCloudDeleteCleanupWarning(null)}
                className="h-auto shrink-0 px-2 py-0.5 text-[11px]"
              >
                Dismiss
              </Button>
            </div>
          ) : null}

          {cloudLocalCleanupError ? (
            <div
              className="mb-3 flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-[12px] leading-snug text-destructive"
              role="alert"
            >
              <p className="min-w-0 flex-1 whitespace-pre-wrap">{cloudLocalCleanupError}</p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setCloudLocalCleanupError(null)}
                className="h-auto shrink-0 px-2 py-0.5 text-[11px] text-destructive hover:text-destructive"
              >
                Dismiss
              </Button>
            </div>
          ) : null}

          {localRemovalError ? (
            <div
              className="mb-3 flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-[12px] leading-snug text-destructive"
              role="alert"
            >
              <p className="min-w-0 flex-1 whitespace-pre-wrap">{localRemovalError}</p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setLocalRemovalError(null)}
                className="h-auto shrink-0 px-2 py-0.5 text-[11px] text-destructive hover:text-destructive"
              >
                Dismiss
              </Button>
            </div>
          ) : null}

          <div
            className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain"
            role="region"
            aria-label="Projects list"
          >
          {loading && !hasAnyPickerRows ? (
            <div className="rounded-lg border border-border bg-card/50 px-4 py-6 text-center text-[13px] text-muted-foreground">
              Loading…
            </div>
          ) : !hasAnyPickerRows ? (
            <EmptyProjectsState
              onNewProject={() => setNewProjectOpen(true)}
              teamSyncLoading={signedIn && cloudProjects.status === 'loading'}
            />
          ) : pickerRows.length === 0 ? (
            <div className="rounded-lg border border-border bg-card/50 px-4 py-6 text-center text-[13px] text-muted-foreground">
              No projects match your search.
            </div>
          ) : (
            <>
              {signedIn && cloudProjects.status === 'loading' ? (
                <p className="mb-2 text-[12px] text-muted-foreground">Loading team projects…</p>
              ) : null}
              <ul className="flex flex-col gap-1.5">
                {pickerRows.map((row) => {
                  if (row.variant === 'team-synced') {
                    const p = row.cloud;
                    return (
                      <li key={row.id}>
                        <div className="group flex items-center gap-3 rounded-lg border border-border bg-card/40 px-3 py-2.5 transition hover:border-foreground/25 hover:bg-transparent">
                          <button
                            type="button"
                            disabled={activatingId === p.id}
                            onClick={() => void handleOpenCloud(p)}
                            className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:opacity-60"
                          >
                            <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-status-review/15 text-[13px] font-medium text-status-review-foreground">
                              {p.name.slice(0, 1).toUpperCase()}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex min-w-0 items-center gap-2">
                                <span className="truncate text-[13px] font-medium text-foreground">
                                  {p.name}
                                </span>
                                <ProjectPickerSyncBadges syncBadge={row.syncBadge} />
                              </div>
                              <div className="truncate text-[11px] text-muted-foreground">
                                {row.subtitle}
                              </div>
                            </div>
                          </button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={cloudLocalCleanupId === p.id}
                            onClick={() => void handleRemoveCloudLocalData(p)}
                            className="h-7 px-2 text-[11px] opacity-0 group-hover:opacity-100"
                            title="Remove local Fluxx data and unbind this machine (does not delete the team project)"
                          >
                            {cloudLocalCleanupId === p.id ? 'Removing…' : 'Remove'}
                          </Button>
                          {p.ownerId === uid ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => setInviteFor(p)}
                              className="h-7 px-2 text-[11px] opacity-0 group-hover:opacity-100"
                              title="Invite teammate"
                            >
                              Invite
                            </Button>
                          ) : null}
                          {p.ownerId === uid ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => void handleDeleteCloud(p)}
                              className="size-8 opacity-0 text-muted-foreground hover:text-destructive group-hover:opacity-100"
                              title="Delete team project for everyone (Firestore)"
                              aria-label={`Delete ${p.name}`}
                            >
                              <Trash2 aria-hidden />
                            </Button>
                          ) : null}
                        </div>
                      </li>
                    );
                  }

                  const p = row.local;
                  const removing = localRemovalId === p.id;
                  return (
                    <li key={row.id}>
                      <div
                        className={cn(
                          'group flex items-center gap-3 rounded-lg border border-border bg-card/40 px-3 py-2.5 transition hover:border-foreground/25 hover:bg-transparent',
                          removing && 'border-border bg-muted/30',
                        )}
                        aria-busy={removing}
                      >
                        <button
                          type="button"
                          disabled={removing}
                          onClick={() => void handleOpenLocal(p.id)}
                          className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:pointer-events-none disabled:opacity-50"
                        >
                          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-[13px] font-medium text-muted-foreground">
                            {removing ? (
                              <LocalRemovalSpinner aria-label="Removing project from Fluxx" />
                            ) : (
                              p.name.slice(0, 1).toUpperCase()
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 items-center gap-2">
                              <span className="truncate text-[13px] font-medium text-foreground">
                                {p.name}
                              </span>
                              <ProjectPickerSyncBadges syncBadge={row.syncBadge} />
                            </div>
                            <div
                              className={cn(
                                'truncate text-[11px] text-muted-foreground',
                                p.repos.length > 0 && 'font-mono',
                              )}
                              title={p.repos.length > 0 ? row.subtitle : undefined}
                            >
                              {row.subtitle}
                            </div>
                          </div>
                        </button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={removing}
                          onClick={() => void handleRemoveLocalFlux(p.id, p.name)}
                          className={cn(
                            'size-8 text-muted-foreground hover:text-destructive disabled:pointer-events-none',
                            removing ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                          )}
                          title="Remove from Fluxx (deletes ~/.fluxx workspace; keeps your git clone)"
                          aria-label={removing ? `Removing ${p.name}` : `Remove ${p.name}`}
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          </div>
        </div>

      </div>

      {newProjectOpen ? (
        <NewProjectModal
          onClose={() => setNewProjectOpen(false)}
          onCreateLocal={handleCreateLocalFromWizard}
          onCreateTeam={handleCreateTeamFromWizard}
        />
      ) : null}

      {inviteFor && uid ? (
        <InviteTeammateModal
          projectId={inviteFor.id}
          projectName={inviteFor.name}
          invitedByUid={uid}
          inviterName={auth.user?.displayName ?? undefined}
          inviterEmail={auth.user?.email ?? undefined}
          onClose={() => setInviteFor(null)}
        />
      ) : null}
    </div>
  );
}

function LocalRemovalSpinner({ 'aria-label': ariaLabel }: { 'aria-label'?: string }) {
  return (
    <span
      role="status"
      aria-label={ariaLabel}
      className="inline-block size-4 shrink-0 animate-spin rounded-full border-2 border-muted border-t-foreground"
    />
  );
}

function EmptyProjectsState({
  onNewProject,
  teamSyncLoading,
}: {
  onNewProject: () => void;
  teamSyncLoading: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed border-border bg-card/30 px-6 py-10 text-center">
      <p className="max-w-sm text-[14px] leading-relaxed text-muted-foreground">
        {teamSyncLoading
          ? 'Loading team projects…'
          : 'No projects yet. Create a project to attach repositories and run agents.'}
      </p>
      <Button
        type="button"
        disabled={teamSyncLoading}
        onClick={onNewProject}
        className="min-h-[38px] min-w-[180px] px-5 text-[13px]"
      >
        New project
      </Button>
    </div>
  );
}
