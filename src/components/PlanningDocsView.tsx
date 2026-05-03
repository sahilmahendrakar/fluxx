import { useCallback, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { PlanningDocFileEntry, PlanningDocsCloudListMeta } from '../planningDocs/types';
import type { PlanningDocsFirestoreStreamState } from '../renderer/planningDocs/usePlanningDocsFirestoreSync';

interface PlanningDocsViewProps {
  selectedPath: string | null;
  /** Increment when the file may have changed on disk (same path). */
  fileRevision?: number;
  projectKind: 'local' | 'cloud';
  cloudProjectId: string | null;
  planningDocFiles: PlanningDocFileEntry[];
  planningDocsCloudListMeta: PlanningDocsCloudListMeta | null;
  planningDocsFirestoreStream: PlanningDocsFirestoreStreamState;
  firebaseConfigured: boolean;
  onPlanningDocsMutated: () => void;
}

function formatDocSyncTime(iso: string | undefined): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return null;
  }
}

function cloudStreamSummary(stream: PlanningDocsFirestoreStreamState, firebaseConfigured: boolean): string | null {
  if (!firebaseConfigured) return 'Firebase is not configured — cloud sync is off.';
  if (stream.kind === 'error') return `Firestore: ${stream.message}`;
  if (stream.kind === 'connecting') return 'Connecting to shared docs…';
  if (stream.kind === 'live') {
    return stream.fromCache ? 'Live updates unavailable — showing cached data (may be offline).' : null;
  }
  if (stream.kind === 'disabled') return 'Sign in to receive live shared updates.';
  return null;
}

export function PlanningDocsView({
  selectedPath,
  fileRevision = 0,
  projectKind,
  cloudProjectId,
  planningDocFiles,
  planningDocsCloudListMeta,
  planningDocsFirestoreStream,
  firebaseConfigured,
  onPlanningDocsMutated,
}: PlanningDocsViewProps) {
  const api = window.electronAPI.planningDocs;

  const [content, setContent] = useState<string>('');
  const [readError, setReadError] = useState<string | null>(null);
  const [loadingRead, setLoadingRead] = useState(false);
  const [resolveBusy, setResolveBusy] = useState<string | null>(null);
  const [resolveMsg, setResolveMsg] = useState<string | null>(null);

  const selectedEntry =
    selectedPath != null
      ? planningDocFiles.find((f) => f.relativePath === selectedPath) ?? null
      : null;

  useEffect(() => {
    setResolveMsg(null);
  }, [selectedPath]);

  useEffect(() => {
    if (!selectedPath) {
      setContent('');
      setReadError(null);
      setLoadingRead(false);
      return;
    }
    let cancelled = false;
    setLoadingRead(true);
    setReadError(null);
    void api.read(selectedPath).then((result) => {
      if (cancelled) return;
      setLoadingRead(false);
      if ('error' in result) {
        setContent('');
        setReadError('Could not open this file.');
        return;
      }
      setContent(result.content);
    });
    return () => {
      cancelled = true;
    };
  }, [api, selectedPath, fileRevision]);

  const runResolve = useCallback(
    async (action: 'take_remote' | 'resume_push' | 'mark_merged') => {
      if (!cloudProjectId || !selectedPath) return;
      setResolveBusy(action);
      setResolveMsg(null);
      const r = await window.electronAPI.planningDocs.resolveConflict({
        projectId: cloudProjectId,
        relativePath: selectedPath,
        action,
        conflictArtifactBasename: selectedEntry?.syncInfo?.conflictArtifactBasename,
      });
      setResolveBusy(null);
      if (!r.ok) {
        setResolveMsg(
          r.code === 'NOT_ACTIVE_CLOUD'
            ? 'This cloud project is not active.'
            : `Could not apply (${r.code}).`,
        );
        return;
      }
      onPlanningDocsMutated();
    },
    [cloudProjectId, selectedPath, selectedEntry?.syncInfo?.conflictArtifactBasename, onPlanningDocsMutated],
  );

  const openSyncFolder = useCallback(async () => {
    setResolveMsg(null);
    const r = await window.electronAPI.planningDocs.revealSyncFolder();
    if (!r.ok) {
      setResolveMsg(r.message ?? r.code);
    }
  }, []);

  const streamHint = cloudStreamSummary(planningDocsFirestoreStream, firebaseConfigured);
  const showCloudChrome = projectKind === 'cloud';

  const listMetaLine = (meta: PlanningDocsCloudListMeta | null): string | null => {
    if (!meta) return null;
    const bits: string[] = [];
    if (meta.totalSynced > 0) bits.push(`${meta.totalSynced} synced`);
    if (meta.totalPendingPush > 0) bits.push(`${meta.totalPendingPush} pending upload`);
    if (meta.totalConflictPaths > 0) bits.push(`${meta.totalConflictPaths} conflict${meta.totalConflictPaths === 1 ? '' : 's'}`);
    if (bits.length === 0) return null;
    return bits.join(' · ');
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#09090b]">
      {showCloudChrome && (streamHint || planningDocsCloudListMeta) ? (
        <div className="shrink-0 space-y-0.5 border-b border-white/[0.06] bg-black/30 px-5 py-2 text-[11px] leading-snug text-zinc-500">
          {streamHint ? (
            <p className={planningDocsFirestoreStream.kind === 'error' ? 'text-amber-200/95' : ''}>
              {streamHint}
            </p>
          ) : null}
          {listMetaLine(planningDocsCloudListMeta) ? (
            <p className="text-zinc-600">{listMetaLine(planningDocsCloudListMeta)}</p>
          ) : null}
        </div>
      ) : null}
      {!selectedPath ? (
        <div className="flex h-full flex-col items-center justify-center px-6 text-center text-sm text-zinc-600">
          <p>
            Choose a document from the sidebar, or expand <span className="px-1 font-medium text-zinc-500">Docs</span>{' '}
            to see what is in <span className="font-mono text-zinc-500">planning/</span>.
          </p>
          {showCloudChrome && !firebaseConfigured ? (
            <p className="mt-3 max-w-sm text-[12px] leading-relaxed text-zinc-500">
              Cloud projects can share these files with your team when Firebase is configured in this build.
            </p>
          ) : null}
        </div>
      ) : (
        <div className="flex h-full min-h-0 flex-col overflow-hidden">
          <header className="shrink-0 border-b border-white/[0.06] px-5 py-3">
            <h1 className="truncate font-mono text-[13px] font-medium text-zinc-200">{selectedPath}</h1>
            {showCloudChrome && selectedEntry ? (
              <div className="mt-1 space-y-0.5 text-[11px] text-zinc-500">
                {selectedEntry.syncStatus === 'synced' && formatDocSyncTime(selectedEntry.syncInfo?.lastSyncedAt) ? (
                  <p>Up to date with cloud · last aligned {formatDocSyncTime(selectedEntry.syncInfo?.lastSyncedAt)}</p>
                ) : null}
                {selectedEntry.syncStatus === 'pending_push' ? (
                  <p className="text-sky-300/85">Local edits are waiting to upload.</p>
                ) : null}
                {selectedEntry.syncStatus === 'conflict' ? (
                  <p className="text-amber-200/90">Sync conflict — choose how to recover.</p>
                ) : null}
                {selectedEntry.syncStatus === 'idle' && !selectedEntry.syncInfo?.lastSyncedAt ? (
                  <p>Not yet uploaded to shared docs.</p>
                ) : null}
              </div>
            ) : null}
            {readError ? (
              <p className="mt-1 text-[12px] text-red-400/90">{readError}</p>
            ) : loadingRead ? (
              <p className="mt-1 text-[12px] text-zinc-600">Loading…</p>
            ) : null}
          </header>
          {showCloudChrome && selectedEntry?.syncStatus === 'conflict' && cloudProjectId ? (
            <div className="shrink-0 space-y-2 border-b border-amber-500/20 bg-amber-500/[0.07] px-5 py-3 text-[12px] text-amber-50/95">
              <p className="leading-snug">
                This file could not be merged automatically with the team copy. Conflict details are saved under{' '}
                <span className="font-mono text-amber-100/90">planning/.flux-docs-sync/</span>.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!!resolveBusy}
                  onClick={() => void runResolve('take_remote')}
                  className="rounded-md border border-amber-400/35 bg-amber-500/15 px-2.5 py-1 text-[11px] font-medium text-amber-50 transition hover:bg-amber-500/25 disabled:opacity-40"
                >
                  {resolveBusy === 'take_remote' ? 'Applying…' : 'Use team version'}
                </button>
                <button
                  type="button"
                  disabled={!!resolveBusy}
                  onClick={() => void runResolve('resume_push')}
                  className="rounded-md border border-white/10 bg-black/20 px-2.5 py-1 text-[11px] font-medium text-zinc-100 transition hover:bg-white/[0.06] disabled:opacity-40"
                >
                  {resolveBusy === 'resume_push' ? 'Working…' : 'Retry upload'}
                </button>
                <button
                  type="button"
                  disabled={!!resolveBusy}
                  onClick={() => void runResolve('mark_merged')}
                  className="rounded-md border border-white/10 bg-black/20 px-2.5 py-1 text-[11px] font-medium text-zinc-100 transition hover:bg-white/[0.06] disabled:opacity-40"
                >
                  {resolveBusy === 'mark_merged' ? 'Saving…' : 'I merged manually'}
                </button>
                <button
                  type="button"
                  disabled={!!resolveBusy}
                  onClick={() => void openSyncFolder()}
                  className="rounded-md border border-white/10 px-2.5 py-1 text-[11px] font-medium text-zinc-200 transition hover:bg-white/[0.06] disabled:opacity-40"
                >
                  Open sync folder
                </button>
              </div>
              {resolveMsg ? <p className="text-[11px] text-rose-200/90">{resolveMsg}</p> : null}
            </div>
          ) : null}
          <article
            className={[
              'min-h-0 flex-1 overflow-y-auto px-5 py-4 text-[13px] leading-relaxed text-zinc-300',
              '[&_a]:text-sky-400 [&_a]:underline [&_a]:decoration-sky-400/40 [&_a]:underline-offset-2 hover:[&_a]:text-sky-300',
              '[&_h1]:mb-3 [&_h1]:mt-6 [&_h1]:text-xl [&_h1]:font-semibold [&_h1]:text-zinc-100 [&_h1]:first:mt-0',
              '[&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:text-lg [&_h2]:font-medium [&_h2]:text-zinc-100',
              '[&_h3]:mb-2 [&_h3]:mt-4 [&_h3]:text-[15px] [&_h3]:font-medium [&_h3]:text-zinc-200',
              '[&_p]:my-3 [&_p]:text-zinc-300',
              '[&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-5',
              '[&_li]:my-1',
              '[&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-zinc-600 [&_blockquote]:pl-4 [&_blockquote]:text-zinc-400',
              '[&_code]:rounded [&_code]:bg-zinc-800/80 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[12px] [&_code]:text-emerald-200/90',
              '[&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-white/[0.08] [&_pre]:bg-[#0a0a0c] [&_pre]:p-3',
              '[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-[12px] [&_pre_code]:text-zinc-300',
              '[&_table]:my-4 [&_table]:w-full [&_table]:border-collapse [&_table]:text-left text-[12px]',
              '[&_th]:border [&_th]:border-white/[0.08] [&_th]:bg-white/[0.04] [&_th]:px-2 [&_th]:py-1.5 [&_th]:font-medium [&_th]:text-zinc-200',
              '[&_td]:border [&_td]:border-white/[0.06] [&_td]:px-2 [&_td]:py-1.5',
              '[&_hr]:my-6 [&_hr]:border-white/[0.08]',
              '[&_strong]:font-semibold [&_strong]:text-zinc-100',
            ].join(' ')}
          >
            {!readError && !loadingRead ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            ) : null}
          </article>
        </div>
      )}
    </div>
  );
}
