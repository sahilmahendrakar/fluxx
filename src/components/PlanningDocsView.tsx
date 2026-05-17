import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {
  PlanningDocFileEntry,
  PlanningDocsCloudListMeta,
  PlanningDocsWriteErrorCode,
} from '../planningDocs/types';
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
  onDirtyChange?: (dirty: boolean) => void;
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

function writeErrorMessage(code: PlanningDocsWriteErrorCode): string {
  switch (code) {
    case 'NO_PROJECT':
      return 'No workspace is open.';
    case 'INVALID_PATH':
      return 'That path is not allowed.';
    case 'FORBIDDEN_PATH':
      return 'This path cannot be edited here.';
    case 'INVALID_CONTENT':
      return 'The document could not be saved.';
    case 'IO_ERROR':
    default:
      return 'Could not save the file. Check disk permissions and try again.';
  }
}

export function PlanningDocsView({
  selectedPath,
  fileRevision = 0,
  projectKind,
  cloudProjectId,
  planningDocFiles,
  firebaseConfigured,
  onPlanningDocsMutated,
  onDirtyChange,
}: PlanningDocsViewProps) {
  const api = window.electronAPI.planningDocs;

  const [savedBaseline, setSavedBaseline] = useState('');
  const [draft, setDraft] = useState('');
  const [readError, setReadError] = useState<string | null>(null);
  const [loadingRead, setLoadingRead] = useState(false);
  const [resolveBusy, setResolveBusy] = useState<string | null>(null);
  const [resolveMsg, setResolveMsg] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'preview' | 'edit'>('preview');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [diskChangedBanner, setDiskChangedBanner] = useState(false);

  const lastLoadedKeyRef = useRef('');

  const selectedEntry =
    selectedPath != null
      ? planningDocFiles.find((f) => f.relativePath === selectedPath) ?? null
      : null;

  const conflictActive = selectedEntry?.syncStatus === 'conflict';
  const editingAllowed =
    !!selectedPath && !loadingRead && !readError && !conflictActive;

  const dirty = useMemo(() => draft !== savedBaseline, [draft, savedBaseline]);

  useLayoutEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    setResolveMsg(null);
  }, [selectedPath]);

  useEffect(() => {
    setViewMode('preview');
  }, [selectedPath]);

  useEffect(() => {
    if (!selectedPath) {
      setSavedBaseline('');
      setDraft('');
      setReadError(null);
      setLoadingRead(false);
      setSaveError(null);
      setDiskChangedBanner(false);
      lastLoadedKeyRef.current = '';
      return;
    }

    const loadKey = `${selectedPath}:${fileRevision}`;

    if (dirty) {
      if (lastLoadedKeyRef.current !== loadKey) {
        setDiskChangedBanner(true);
      }
      return;
    }

    let cancelled = false;
    setLoadingRead(true);
    setReadError(null);
    setSaveError(null);
    setDiskChangedBanner(false);

    void api.read(selectedPath).then((result) => {
      if (cancelled) return;
      setLoadingRead(false);
      if ('error' in result) {
        setSavedBaseline('');
        setDraft('');
        setReadError('Could not open this file.');
        lastLoadedKeyRef.current = '';
        return;
      }
      setSavedBaseline(result.content);
      setDraft(result.content);
      lastLoadedKeyRef.current = loadKey;
    });

    return () => {
      cancelled = true;
    };
  }, [api, selectedPath, fileRevision, dirty]);

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

  const handleSave = useCallback(async () => {
    if (!selectedPath || !editingAllowed || saving) return;
    setSaving(true);
    setSaveError(null);
    const r = await api.write(selectedPath, draft);
    setSaving(false);
    if ('error' in r) {
      setSaveError(writeErrorMessage(r.error));
      return;
    }
    setSavedBaseline(draft);
    onPlanningDocsMutated();
  }, [api, selectedPath, draft, editingAllowed, saving, onPlanningDocsMutated]);

  const reloadFromDisk = useCallback(() => {
    if (!selectedPath) return;
    setDiskChangedBanner(false);
    setSavedBaseline('');
    setDraft('');
    lastLoadedKeyRef.current = '';
    void api.read(selectedPath).then((result) => {
      if ('error' in result) {
        setReadError('Could not open this file.');
        return;
      }
      setReadError(null);
      setSavedBaseline(result.content);
      setDraft(result.content);
      lastLoadedKeyRef.current = `${selectedPath}:${fileRevision}`;
    });
  }, [api, selectedPath, fileRevision]);

  const showCloudChrome = projectKind === 'cloud';

  const markdownBodyClass = [
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
  ].join(' ');

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#09090b]">
      {!selectedPath ? (
        <div className="flex h-full flex-col items-center justify-center px-6 text-center text-sm text-zinc-600">
          <p>
            Choose a document from the sidebar, or expand <span className="px-1 font-medium text-zinc-500">Docs</span>{' '}
            to see what is in <span className="font-mono text-zinc-500">planning/docs/</span>.
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
            <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
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
                      <p className="text-amber-200/90">Sync conflict — choose how to recover before editing.</p>
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
                {saveError ? <p className="mt-1 text-[12px] text-red-400/90">{saveError}</p> : null}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                <div className="flex rounded-md border border-white/[0.08] p-0.5">
                  <button
                    type="button"
                    onClick={() => setViewMode('preview')}
                    className={[
                      'rounded px-2 py-1 text-[11px] font-medium transition',
                      viewMode === 'preview'
                        ? 'bg-white/[0.08] text-zinc-100'
                        : 'text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-300',
                    ].join(' ')}
                  >
                    Preview
                  </button>
                  <button
                    type="button"
                    disabled={!editingAllowed}
                    onClick={() => setViewMode('edit')}
                    title={conflictActive ? 'Resolve the sync conflict before editing.' : undefined}
                    className={[
                      'rounded px-2 py-1 text-[11px] font-medium transition',
                      viewMode === 'edit'
                        ? 'bg-white/[0.08] text-zinc-100'
                        : 'text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-300',
                      !editingAllowed ? 'cursor-not-allowed opacity-40' : '',
                    ].join(' ')}
                  >
                    Edit
                  </button>
                </div>
                <button
                  type="button"
                  disabled={!editingAllowed || !dirty || saving}
                  onClick={() => void handleSave()}
                  className="rounded-md border border-sky-500/40 bg-sky-500/15 px-2.5 py-1 text-[11px] font-medium text-sky-100 transition hover:bg-sky-500/25 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
                {dirty ? (
                  <span className="text-[11px] text-amber-200/80" title="Unsaved changes">
                    Unsaved
                  </span>
                ) : null}
              </div>
            </div>
          </header>
          {diskChangedBanner ? (
            <div className="shrink-0 border-b border-sky-500/25 bg-sky-500/[0.08] px-5 py-2 text-[12px] text-sky-50/95">
              <span className="leading-snug">This file may have changed on disk while you have unsaved edits.</span>{' '}
              <button
                type="button"
                onClick={() => void reloadFromDisk()}
                className="font-medium text-sky-200 underline decoration-sky-400/40 underline-offset-2 hover:text-white"
              >
                Reload from disk (discard local edits)
              </button>
            </div>
          ) : null}
          {showCloudChrome && selectedEntry?.syncStatus === 'conflict' && cloudProjectId ? (
            <div className="shrink-0 space-y-2 border-b border-amber-500/20 bg-amber-500/[0.07] px-5 py-3 text-[12px] text-amber-50/95">
              <p className="leading-snug">
                This file could not be merged automatically with the team copy. Conflict details are saved under{' '}
                <span className="font-mono text-amber-100/90">planning/.fluxx-docs-sync/</span>.
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
          {viewMode === 'edit' && editingAllowed ? (
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              spellCheck={false}
              className="min-h-0 w-full flex-1 resize-none border-0 bg-[#0c0c0e] px-5 py-4 font-mono text-[12px] leading-relaxed text-zinc-200 outline-none focus:ring-0"
              aria-label="Markdown source"
            />
          ) : (
            <article className={markdownBodyClass}>
              {!readError && !loadingRead ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{draft}</ReactMarkdown>
              ) : null}
            </article>
          )}
          {viewMode === 'preview' && editingAllowed ? (
            <p className="shrink-0 border-t border-white/[0.06] px-5 py-2 text-[11px] text-zinc-600">
              Switch to <span className="text-zinc-500">Edit</span> to change the markdown source, then Save.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
