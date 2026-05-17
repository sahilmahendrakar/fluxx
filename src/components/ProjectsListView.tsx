import { useEffect, useState } from 'react';
import { hydrateCloudProject, primaryRootPathFromCloudBinding } from '../cloudBindingPrefs';
import {
  cloudProjectNeedsRepoBinding,
  cloudProjectUsesLegacyFolderPicker,
  shellCloudBinding,
} from '../cloudProjectActivation';
import { buildCloudSharedReposAtCreate } from '../cloudProjectCreate';
import type { CloudProject, CloudProjectLocalBinding, LocalProject } from '../types';
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
import { CreateCloudProjectModal } from './CreateCloudProjectModal';
import { InviteTeammateModal } from './InviteTeammateModal';

type ActiveProject = LocalProject | CloudProject;

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
  const [adding, setAdding] = useState(false);
  const [gitError, setGitError] = useState(false);
  const [createCloudOpen, setCreateCloudOpen] = useState(false);
  const [inviteFor, setInviteFor] = useState<CloudProjectSummary | null>(null);
  const [activatingId, setActivatingId] = useState<string | null>(null);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [localRemovalError, setLocalRemovalError] = useState<string | null>(null);
  const [cloudLocalCleanupError, setCloudLocalCleanupError] = useState<string | null>(null);
  const [cloudLocalCleanupId, setCloudLocalCleanupId] = useState<string | null>(null);
  const [cloudDeleteCleanupWarning, setCloudDeleteCleanupWarning] = useState<string | null>(null);
  /** Local project id currently undergoing `Remove from Fluxx` cleanup. */
  const [localRemovalId, setLocalRemovalId] = useState<string | null>(null);
  const [cloudBindingsById, setCloudBindingsById] = useState<
    Record<string, CloudProjectLocalBinding | null>
  >({});

  const uid = auth.user?.uid ?? null;

  const refreshLocal = async () => {
    try {
      const list = await window.electronAPI.projects.listLocal();
      setProjects(list);
    } catch (err) {
      console.error('[projects.listLocal] failed', err);
    }
  };

  useEffect(() => {
    if (cloudProjects.status !== 'ready' || cloudProjects.projects.length === 0) {
      setCloudBindingsById({});
      return;
    }
    let cancelled = false;
    void Promise.all(
      cloudProjects.projects.map(async (p) => {
        const binding = await window.electronAPI.projects.getLocalBinding(p.id);
        return [p.id, binding] as const;
      }),
    ).then((rows) => {
      if (cancelled) return;
      setCloudBindingsById(Object.fromEntries(rows));
    });
    return () => {
      cancelled = true;
    };
  }, [cloudProjects.status, cloudProjects.projects]);

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

  const handleAddLocal = async () => {
    setGitError(false);
    setAdding(true);
    try {
      const result = await window.electronAPI.projects.addLocal();
      if (!result) return;
      if ('error' in result) {
        if (result.error === 'NOT_GIT_REPO') setGitError(true);
        return;
      }
      const active = await window.electronAPI.projects.activateLocal(result.id);
      if (active) onProjectActivated(active);
    } finally {
      setAdding(false);
    }
  };

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

  const handleCreateCloud = async (input: {
    name: string;
    repos: CloudProjectCreateRepoInput[];
    primaryRootPath?: string;
  }) => {
    if (!uid) return;
    const summary = await createCloudProject(uid, input.name, {
      displayName: auth.user?.displayName ?? undefined,
      email: auth.user?.email ?? undefined,
      photoURL: auth.user?.photoURL ?? null,
      repos: input.repos.length > 0 ? input.repos : undefined,
      primaryRootPath: input.primaryRootPath,
    });
    setCreateCloudOpen(false);

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
        setCloudError(bindResult.error);
      }
    }

    await handleOpenCloud(summary);
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
    <div className="relative flex h-full w-full flex-col overflow-y-auto bg-[#09090b] text-zinc-100">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-[20%] -top-[10%] h-[min(560px,70vw)] w-[min(560px,70vw)] rounded-full bg-violet-600/[0.12] blur-[100px]" />
        <div className="absolute -bottom-[15%] -right-[15%] h-[min(480px,65vw)] w-[min(480px,65vw)] rounded-full bg-sky-600/[0.1] blur-[100px]" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/50" />
      </div>
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.4]"
        style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,0.028) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.028) 1px, transparent 1px)`,
          backgroundSize: '64px 64px',
          maskImage:
            'radial-gradient(ellipse 80% 60% at 50% 40%, black, transparent)',
        }}
      />

      <div className="relative z-10 mx-auto flex w-full max-w-2xl flex-col px-8 py-16">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] shadow-[0_1px_0_0_rgba(255,255,255,0.06)_inset] backdrop-blur-md">
            <span className="text-base font-semibold tracking-tight text-white">
              F
            </span>
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-white">
              Fluxx
            </h1>
            <p className="text-[13px] text-zinc-500">Projects</p>
          </div>
        </div>

        {authSlot ? <div className="mt-8">{authSlot}</div> : null}

        {(() => {
          if (auth.status !== 'signedIn' || invites.status !== 'ready') return null;
          // Hide invites for projects the user already belongs to — "Accept" is
          // a no-op there. They show up under Team > Pending invites instead.
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
          <div className="mt-8">
            <h2 className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-zinc-500">
              Invitations
            </h2>
            {inviteError ? (
              <p className="mb-2 rounded-md border border-red-500/20 bg-red-500/[0.08] px-3 py-2 text-[12px] text-red-300/95">
                {inviteError}
              </p>
            ) : null}
            <ul className="flex flex-col gap-1.5">
              {actionable.map((inv) => (
                <li
                  key={`${inv.projectId}-${inv.email}`}
                  className="flex items-center gap-3 rounded-lg border border-amber-500/20 bg-amber-500/[0.05] px-3 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-zinc-100">
                      {inv.projectName || '(unknown project)'}
                    </div>
                    <div className="truncate text-[11px] text-zinc-500">
                      Invited to collaborate
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={acceptingId === inv.projectId}
                    onClick={() => void handleAcceptInvite(inv.projectId, inv.email)}
                    className="rounded-md bg-white px-2.5 py-1 text-[12px] font-medium text-zinc-950 transition hover:bg-zinc-100 disabled:pointer-events-none disabled:opacity-45"
                  >
                    {acceptingId === inv.projectId ? 'Accepting…' : 'Accept'}
                  </button>
                </li>
              ))}
            </ul>
          </div>
          );
        })()}

        {auth.status === 'signedIn' ? (
          <div className="mt-8">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-zinc-500">
                Team projects
              </h2>
              <button
                type="button"
                onClick={() => setCreateCloudOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[12px] font-medium text-zinc-200 transition hover:bg-white/[0.06] active:scale-[0.98]"
              >
                + New team project
              </button>
            </div>

            {cloudError ? (
              <p className="mb-3 rounded-lg border border-red-500/20 bg-red-500/[0.08] px-3 py-2 text-[13px] leading-snug text-red-300/95">
                {cloudError}
              </p>
            ) : null}

            {cloudDeleteCleanupWarning ? (
              <div
                role="alert"
                className="mb-3 flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/[0.08] px-3 py-2 text-[12px] leading-snug text-amber-100/95"
              >
                <p className="min-w-0 flex-1 whitespace-pre-wrap">{cloudDeleteCleanupWarning}</p>
                <button
                  type="button"
                  onClick={() => setCloudDeleteCleanupWarning(null)}
                  className="shrink-0 rounded px-2 py-0.5 text-[11px] font-medium text-amber-200/90 hover:bg-amber-500/15"
                >
                  Dismiss
                </button>
              </div>
            ) : null}

            {cloudLocalCleanupError ? (
              <div
                className="mb-3 flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/[0.08] px-3 py-2 text-[12px] leading-snug text-red-300/95"
                role="alert"
              >
                <p className="min-w-0 flex-1 whitespace-pre-wrap">{cloudLocalCleanupError}</p>
                <button
                  type="button"
                  onClick={() => setCloudLocalCleanupError(null)}
                  className="shrink-0 rounded px-2 py-0.5 text-[11px] font-medium text-red-200/90 hover:bg-red-500/15"
                >
                  Dismiss
                </button>
              </div>
            ) : null}

            {cloudProjects.status === 'loading' ? (
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-6 text-center text-[13px] text-zinc-500">
                Loading…
              </div>
            ) : cloudProjects.status === 'error' ? (
              <div className="rounded-lg border border-red-500/20 bg-red-500/[0.08] px-4 py-3 text-[12px] text-red-300/95">
                Couldn't load team projects: {cloudProjects.error}
              </div>
            ) : cloudProjects.projects.length === 0 ? (
              <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-white/[0.08] bg-white/[0.015] px-6 py-8 text-center">
                <p className="text-[13px] text-zinc-400">
                  No team projects yet.
                </p>
                <button
                  type="button"
                  onClick={() => setCreateCloudOpen(true)}
                  className="rounded-md bg-white px-3 py-1.5 text-[12px] font-medium text-zinc-950 transition hover:bg-zinc-100"
                >
                  Create team project
                </button>
              </div>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {cloudProjects.projects.map((p) => {
                  const needsRepo = cloudProjectNeedsRepoBinding(
                    p.id,
                    p.repos,
                    cloudBindingsById[p.id],
                  );
                  return (
                  <li key={p.id}>
                    <div className="group flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 transition hover:border-white/[0.12] hover:bg-white/[0.04]">
                      <button
                        type="button"
                        disabled={activatingId === p.id}
                        onClick={() => void handleOpenCloud(p)}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:opacity-60"
                      >
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-sky-500/[0.12] text-[13px] font-medium text-sky-200/90">
                          {p.name.slice(0, 1).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="truncate text-[13px] font-medium text-zinc-100">
                              {p.name}
                            </span>
                            {needsRepo ? (
                              <span className="shrink-0 rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-200/90">
                                Needs repo
                              </span>
                            ) : null}
                          </div>
                          <div className="truncate text-[11px] text-zinc-500">
                            {p.ownerId === uid
                              ? `Owner · ${p.memberIds.length} member${p.memberIds.length === 1 ? '' : 's'}`
                              : `Member · ${p.memberIds.length} members`}
                          </div>
                        </div>
                      </button>
                      <button
                        type="button"
                        disabled={cloudLocalCleanupId === p.id}
                        onClick={() => void handleRemoveCloudLocalData(p)}
                        className="rounded-md px-2 py-1 text-[11px] font-medium text-zinc-500 opacity-0 transition hover:bg-white/[0.06] hover:text-zinc-200 group-hover:opacity-100 disabled:pointer-events-none disabled:opacity-45"
                        title="Remove local Fluxx data and unbind this machine (does not delete the team project)"
                      >
                        {cloudLocalCleanupId === p.id ? 'Removing…' : 'Local data'}
                      </button>
                      {p.ownerId === uid ? (
                        <>
                          <button
                            type="button"
                            onClick={() => setInviteFor(p)}
                            className="rounded-md px-2 py-1 text-[11px] font-medium text-zinc-400 opacity-0 transition hover:bg-white/[0.06] hover:text-zinc-200 group-hover:opacity-100"
                            title="Invite teammate"
                          >
                            Invite
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDeleteCloud(p)}
                            className="rounded-md px-2 py-1 text-[11px] font-medium text-zinc-500 opacity-0 transition hover:bg-white/[0.06] hover:text-red-300 group-hover:opacity-100"
                            title="Delete team project for everyone (Firestore)"
                          >
                            Delete team
                          </button>
                        </>
                      ) : null}
                    </div>
                  </li>
                  );
                })}
              </ul>
            )}
          </div>
        ) : null}

        <div className="mt-8">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-zinc-500">
              Local projects
            </h2>
            <button
              type="button"
              disabled={adding}
              onClick={() => void handleAddLocal()}
              className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[12px] font-medium text-zinc-200 transition hover:bg-white/[0.06] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45"
            >
              {adding ? 'Opening…' : '+ Add project'}
            </button>
          </div>

          {localRemovalError ? (
            <div
              className="mb-3 flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/[0.08] px-3 py-2 text-[12px] leading-snug text-red-300/95"
              role="alert"
            >
              <p className="min-w-0 flex-1 whitespace-pre-wrap">{localRemovalError}</p>
              <button
                type="button"
                onClick={() => setLocalRemovalError(null)}
                className="shrink-0 rounded px-2 py-0.5 text-[11px] font-medium text-red-200/90 hover:bg-red-500/15"
              >
                Dismiss
              </button>
            </div>
          ) : null}

          {gitError ? (
            <p
              className="mb-4 rounded-lg border border-red-500/20 bg-red-500/[0.08] px-3 py-2 text-[13px] leading-snug text-red-300/95"
              role="alert"
            >
              That folder isn&apos;t a git repository. Run{' '}
              <code className="font-mono text-red-200">git init</code> first.
            </p>
          ) : null}

          {loading ? (
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-6 text-center text-[13px] text-zinc-500">
              Loading…
            </div>
          ) : projects.length === 0 ? (
            <EmptyLocalState onAdd={() => void handleAddLocal()} busy={adding} />
          ) : (
            <ul className="flex flex-col gap-1.5">
              {projects.map((p) => {
                const removing = localRemovalId === p.id;
                return (
                <li key={p.id}>
                  <div
                    className={`group flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 transition hover:border-white/[0.12] hover:bg-white/[0.04] ${removing ? 'border-white/[0.08] bg-white/[0.03]' : ''}`}
                    aria-busy={removing}
                  >
                    <button
                      type="button"
                      disabled={removing}
                      onClick={() => void handleOpenLocal(p.id)}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:pointer-events-none disabled:opacity-50"
                    >
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white/[0.05] text-[13px] font-medium text-zinc-300">
                        {removing ? (
                          <LocalRemovalSpinner aria-label="Removing project from Fluxx" />
                        ) : (
                          p.name.slice(0, 1).toUpperCase()
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-medium text-zinc-100">
                          {p.name}
                        </div>
                        <div
                          className="truncate font-mono text-[11px] text-zinc-500"
                          title={p.rootPath}
                        >
                          {p.rootPath}
                        </div>
                      </div>
                    </button>
                    <button
                      type="button"
                      disabled={removing}
                      onClick={() => void handleRemoveLocalFlux(p.id, p.name)}
                      className={`rounded-md px-2 py-1 text-[11px] font-medium transition hover:bg-white/[0.06] disabled:pointer-events-none disabled:opacity-45 ${removing ? 'text-zinc-400 opacity-100' : 'text-zinc-500 opacity-0 group-hover:opacity-100 hover:text-zinc-300'}`}
                      title="Remove from Fluxx (deletes ~/.fluxx workspace; keeps your git clone)"
                    >
                      {removing ? 'Removing…' : 'Remove from Fluxx'}
                    </button>
                  </div>
                </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="mt-12 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 border-t border-white/[0.06] pt-8 text-[11px] font-medium uppercase tracking-[0.14em] text-zinc-600">
          <span>Claude Code</span>
          <span className="hidden text-zinc-700 sm:inline">·</span>
          <span>Codex</span>
          <span className="hidden text-zinc-700 sm:inline">·</span>
          <span>Cursor</span>
        </div>
      </div>

      {createCloudOpen ? (
        <CreateCloudProjectModal
          onClose={() => setCreateCloudOpen(false)}
          onCreate={handleCreateCloud}
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
      className="inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-zinc-600 border-t-zinc-200"
    />
  );
}

function EmptyLocalState({ onAdd, busy }: { onAdd: () => void; busy: boolean }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed border-white/[0.08] bg-white/[0.015] px-6 py-10 text-center">
      <p className="max-w-sm text-[14px] leading-relaxed text-zinc-400">
        No projects yet. Add a folder with a git repository to start running
        agents on it.
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={onAdd}
        className="inline-flex min-h-[38px] min-w-[180px] items-center justify-center rounded-lg bg-white px-5 text-[13px] font-medium text-zinc-950 shadow-[0_0_0_1px_rgba(255,255,255,0.12)_inset,0_1px_2px_rgba(0,0,0,0.24)] transition hover:bg-zinc-100 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45"
      >
        {busy ? 'Opening…' : 'Add project'}
      </button>
    </div>
  );
}
