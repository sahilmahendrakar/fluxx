import { useCallback, useEffect, useId, useState } from 'react';
import type {
  CloudSharedRepo,
  RepoConfig,
  RepoEnvFileDetectionEntry,
  RepoEnvFileDetectionResult,
  RepoEnvFileName,
} from '../types';
import { SettingsSwitch } from './SettingsSwitch';
import { Button } from '@/components/ui/button';

type SaveState = 'idle' | 'loading' | 'saving' | 'saved' | 'error';

function formatBytes(sizeBytes: number | undefined): string {
  if (sizeBytes === undefined) return '';
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  return `${(sizeBytes / 1024).toFixed(1)} KB`;
}

function formatModified(modifiedAt: string | undefined): string {
  if (!modifiedAt) return '';
  try {
    return new Date(modifiedAt).toLocaleString();
  } catch {
    return modifiedAt;
  }
}

function EnvFileRow({
  entry,
  rowTitleId,
  disabled,
  busy,
  onEnablementChange,
}: {
  entry: RepoEnvFileDetectionEntry;
  rowTitleId: string;
  disabled?: boolean;
  busy?: boolean;
  onEnablementChange: (fileName: RepoEnvFileName, enabled: boolean) => void;
}) {
  const found = entry.presence === 'found';
  const enabled = entry.enablement === 'enabled';
  const metaParts: string[] = [];
  if (found) {
    const size = formatBytes(entry.sizeBytes);
    const modified = formatModified(entry.modifiedAt);
    if (size) metaParts.push(size);
    if (modified) metaParts.push(`modified ${modified}`);
  } else {
    metaParts.push('Not found at repo root');
  }

  return (
    <div className="flex items-start justify-between gap-3 rounded-md border border-border/80 bg-muted/20 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span id={rowTitleId} className="font-mono text-[12px] text-foreground">
            {entry.fileName}
          </span>
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
              found
                ? 'bg-status-success/15 text-status-success'
                : 'bg-muted text-muted-foreground'
            }`}
          >
            {found ? 'Found' : 'Missing'}
          </span>
        </div>
        {metaParts.length > 0 ? (
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
            {metaParts.join(' · ')}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1 pt-0.5">
        <span className="text-[10px] text-muted-foreground">Copy to worktrees</span>
        <SettingsSwitch
          checked={enabled}
          onCheckedChange={(next) => onEnablementChange(entry.fileName, next)}
          disabled={disabled || !found}
          ariaLabelledBy={rowTitleId}
          ariaBusy={busy}
          size="sm"
        />
      </div>
    </div>
  );
}

export interface RepoEnvFilesPanelProps {
  repoId: string;
  rootPath: string;
  legacyPastedEnvActive?: boolean;
  sharedRepos?: CloudSharedRepo[];
  disabled?: boolean;
  disabledReason?: string;
  onReposChanged?: (repos: RepoConfig[]) => void;
}

export function RepoEnvFilesPanel({
  repoId,
  rootPath,
  legacyPastedEnvActive = false,
  sharedRepos,
  disabled = false,
  disabledReason,
  onReposChanged,
}: RepoEnvFilesPanelProps) {
  const panelTitleId = useId();
  const [detection, setDetection] = useState<RepoEnvFileDetectionResult | null>(null);
  const [state, setState] = useState<SaveState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [togglingFile, setTogglingFile] = useState<RepoEnvFileName | null>(null);

  const loadDetection = useCallback(async () => {
    if (disabled || !rootPath.trim()) {
      setDetection(null);
      return;
    }
    setState('loading');
    setError(null);
    const result = await window.electronAPI.project.detectRepoEnvFiles({ repoId });
    if ('error' in result) {
      setState('error');
      setError(result.error);
      setDetection(null);
      return;
    }
    setDetection(result.detection);
    setState('idle');
  }, [disabled, repoId, rootPath]);

  useEffect(() => {
    void loadDetection();
  }, [loadDetection]);

  const handleRescan = async () => {
    if (disabled) return;
    setState('saving');
    setError(null);
    const result = await window.electronAPI.project.rescanRepoEnvFiles({
      repoId,
      ...(sharedRepos ? { sharedRepos } : {}),
    });
    if ('error' in result) {
      setState('error');
      setError(result.error);
      return;
    }
    setDetection(result.detection);
    setState('saved');
    onReposChanged?.(result.repos);
    window.setTimeout(() => {
      setState((s) => (s === 'saved' ? 'idle' : s));
    }, 1500);
  };

  const handleEnablementChange = async (fileName: RepoEnvFileName, enabled: boolean) => {
    if (disabled) return;
    setTogglingFile(fileName);
    setError(null);
    const result = await window.electronAPI.project.setRepoEnvFileEnablement({
      repoId,
      fileName,
      enablement: enabled ? 'enabled' : 'disabled',
      ...(sharedRepos ? { sharedRepos } : {}),
    });
    setTogglingFile(null);
    if ('error' in result) {
      setState('error');
      setError(result.error);
      return;
    }
    setDetection(result.detection);
    onReposChanged?.(result.repos);
  };

  const foundCount = detection?.files.filter((f) => f.presence === 'found').length ?? 0;
  const busy = state === 'loading' || state === 'saving' || togglingFile !== null;

  return (
    <div className="mt-4 border-t border-border pt-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h4 id={panelTitleId} className="text-[12px] font-medium text-foreground">
            Env files
          </h4>
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
            Fluxx scans the repository root for common env files (for example{' '}
            <span className="font-mono">.env</span> and{' '}
            <span className="font-mono">.env.local</span>). Enabled files are copied into each
            new task worktree. This metadata is stored on this machine only and is not synced to
            teammates.
          </p>
          {legacyPastedEnvActive ? (
            <p className="mt-1.5 text-[11px] leading-snug text-status-needs-input">
              Legacy pasted .env contents below are still active. Root{' '}
              <span className="font-mono">.env</span> file copy stays off until you clear or migrate
              that pasted value.
            </p>
          ) : null}
          {disabled && disabledReason ? (
            <p className="mt-1.5 text-[11px] leading-snug text-status-needs-input">
              {disabledReason}
            </p>
          ) : null}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 shrink-0 text-[12px]"
          onClick={() => void handleRescan()}
          disabled={disabled || busy || !rootPath.trim()}
        >
          {state === 'saving' ? 'Scanning…' : 'Rescan repo root'}
        </Button>
      </div>

      <div className="mt-3 flex flex-col gap-2" aria-labelledby={panelTitleId}>
        {state === 'loading' && !detection ? (
          <p className="text-[11px] text-muted-foreground">Scanning repository root…</p>
        ) : null}
        {detection?.files.map((entry) => (
          <EnvFileRow
            key={entry.fileName}
            entry={entry}
            rowTitleId={`${panelTitleId}-${entry.fileName}`}
            disabled={disabled}
            busy={togglingFile === entry.fileName}
            onEnablementChange={(fileName, enabled) => {
              void handleEnablementChange(fileName, enabled);
            }}
          />
        ))}
      </div>

      <div className="mt-2 flex items-center gap-3">
        {state === 'error' && error ? (
          <span className="text-[11px] text-destructive">{error}</span>
        ) : state === 'saved' ? (
          <span className="text-[11px] text-status-success">Scan complete</span>
        ) : detection ? (
          <span className="text-[11px] text-muted-foreground">
            {foundCount === 0
              ? 'No env files found at the repository root.'
              : `${foundCount} file${foundCount === 1 ? '' : 's'} found at the repository root.`}
            {detection.detectedAt
              ? ` Last scan: ${formatModified(detection.detectedAt)}.`
              : ''}
          </span>
        ) : null}
      </div>
    </div>
  );
}
