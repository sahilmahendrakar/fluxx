import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  PlanningDocFileEntry,
  PlanningDocsCloudListMeta,
  PlanningDocsWriteErrorCode,
} from '../planningDocs/types';
import type { PlanningDocsFirestoreStreamState } from '../renderer/planningDocs/usePlanningDocsFirestoreSync';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { MarkdownContent } from './markdownContent';

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

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      {!selectedPath ? (
        <div className="flex h-full flex-col items-center justify-center px-6 text-center text-sm text-muted-foreground">
          <p>
            Choose a document from the sidebar, or expand{' '}
            <span className="px-1 font-medium text-foreground/80">Docs</span> to see what is in{' '}
            <span className="font-mono text-foreground/70">planning/docs/</span>.
          </p>
          {showCloudChrome && !firebaseConfigured ? (
            <p className="mt-3 max-w-sm text-[12px] leading-relaxed">
              Cloud projects can share these files with your team when Firebase is configured in this
              build.
            </p>
          ) : null}
        </div>
      ) : (
        <div className="flex h-full min-h-0 flex-col overflow-hidden">
          <header className="shrink-0 border-b border-border px-5 py-3">
            <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <h1 className="truncate font-mono text-[13px] font-medium text-foreground">
                  {selectedPath}
                </h1>
                {showCloudChrome && selectedEntry ? (
                  <div className="mt-1 flex flex-col gap-0.5 text-[11px] text-muted-foreground">
                    {selectedEntry.syncStatus === 'synced' && formatDocSyncTime(selectedEntry.syncInfo?.lastSyncedAt) ? (
                      <p>
                        Up to date with cloud · last aligned{' '}
                        {formatDocSyncTime(selectedEntry.syncInfo?.lastSyncedAt)}
                      </p>
                    ) : null}
                    {selectedEntry.syncStatus === 'pending_push' ? (
                      <p className="text-primary">Local edits are waiting to upload.</p>
                    ) : null}
                    {selectedEntry.syncStatus === 'conflict' ? (
                      <p className="text-status-needs-input">Sync conflict — choose how to recover before editing.</p>
                    ) : null}
                    {selectedEntry.syncStatus === 'idle' && !selectedEntry.syncInfo?.lastSyncedAt ? (
                      <p>Not yet uploaded to shared docs.</p>
                    ) : null}
                  </div>
                ) : null}
                {readError ? (
                  <p className="mt-1 text-[12px] text-destructive">{readError}</p>
                ) : loadingRead ? (
                  <p className="mt-1 text-[12px] text-muted-foreground">Loading…</p>
                ) : null}
                {saveError ? <p className="mt-1 text-[12px] text-destructive">{saveError}</p> : null}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                <div className="flex rounded-lg border border-border p-0.5">
                  <Button
                    type="button"
                    variant={viewMode === 'preview' ? 'secondary' : 'ghost'}
                    size="sm"
                    className="h-7 px-2 text-[11px]"
                    onClick={() => setViewMode('preview')}
                  >
                    Preview
                  </Button>
                  <Button
                    type="button"
                    variant={viewMode === 'edit' ? 'secondary' : 'ghost'}
                    size="sm"
                    className="h-7 px-2 text-[11px]"
                    disabled={!editingAllowed}
                    onClick={() => setViewMode('edit')}
                    title={conflictActive ? 'Resolve the sync conflict before editing.' : undefined}
                  >
                    Edit
                  </Button>
                </div>
                <Button
                  type="button"
                  size="sm"
                  className="h-7 text-[11px]"
                  disabled={!editingAllowed || !dirty || saving}
                  onClick={() => void handleSave()}
                >
                  {saving ? 'Saving…' : 'Save'}
                </Button>
                {dirty ? (
                  <Badge
                    variant="outline"
                    className="border-status-needs-input/40 bg-status-needs-input/10 text-[11px] text-status-needs-input-foreground"
                  >
                    Unsaved
                  </Badge>
                ) : null}
              </div>
            </div>
          </header>
          {diskChangedBanner ? (
            <div className="shrink-0 border-b border-primary/25 bg-primary/10 px-5 py-2 text-[12px] text-foreground">
              <span className="leading-snug">
                This file may have changed on disk while you have unsaved edits.
              </span>{' '}
              <Button
                type="button"
                variant="link"
                className="h-auto p-0 text-[12px] font-medium"
                onClick={() => void reloadFromDisk()}
              >
                Reload from disk (discard local edits)
              </Button>
            </div>
          ) : null}
          {showCloudChrome && selectedEntry?.syncStatus === 'conflict' && cloudProjectId ? (
            <div className="shrink-0 border-b border-status-needs-input/25 bg-status-needs-input/10 px-5 py-3 text-[12px] text-foreground">
              <p className="leading-snug">
                This file could not be merged automatically with the team copy. Conflict details are saved
                under{' '}
                <span className="font-mono text-status-needs-input-foreground">
                  planning/.fluxx-docs-sync/
                </span>
                .
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="h-7 border-status-needs-input/35 bg-status-needs-input/15 text-[11px] hover:bg-status-needs-input/25"
                  disabled={!!resolveBusy}
                  onClick={() => void runResolve('take_remote')}
                >
                  {resolveBusy === 'take_remote' ? 'Applying…' : 'Use team version'}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 text-[11px]"
                  disabled={!!resolveBusy}
                  onClick={() => void runResolve('resume_push')}
                >
                  {resolveBusy === 'resume_push' ? 'Working…' : 'Retry upload'}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 text-[11px]"
                  disabled={!!resolveBusy}
                  onClick={() => void runResolve('mark_merged')}
                >
                  {resolveBusy === 'mark_merged' ? 'Saving…' : 'I merged manually'}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 text-[11px]"
                  disabled={!!resolveBusy}
                  onClick={() => void openSyncFolder()}
                >
                  Open sync folder
                </Button>
              </div>
              {resolveMsg ? <p className="mt-2 text-[11px] text-destructive">{resolveMsg}</p> : null}
            </div>
          ) : null}
          {viewMode === 'edit' && editingAllowed ? (
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              spellCheck={false}
              className="min-h-0 flex-1 resize-none rounded-none border-0 bg-muted/30 px-8 pb-4 pt-2 font-mono text-[12px] leading-relaxed shadow-none focus-visible:ring-0"
              aria-label="Markdown source"
            />
          ) : !readError && !loadingRead ? (
            <MarkdownContent scroll density="docs">
              {draft}
            </MarkdownContent>
          ) : null}
          {viewMode === 'preview' && editingAllowed ? (
            <>
              <Separator />
              <p className="shrink-0 px-5 py-2 text-[11px] text-muted-foreground">
                Switch to <span className="text-foreground/80">Edit</span> to change the markdown source,
                then Save.
              </p>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
