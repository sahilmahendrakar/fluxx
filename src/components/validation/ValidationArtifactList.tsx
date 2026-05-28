import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, FileText, Film, ImageIcon, ScrollText, Workflow } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { ValidationArtifactKind, ValidationArtifactView } from '../../validationRuns/types';
import {
  validationArtifactCanPreviewInline,
  validationArtifactMissingCopy,
  validationArtifactShouldOpenExternally,
} from '../../validationRuns/artifactUi';

function artifactKindIcon(kind: ValidationArtifactKind) {
  switch (kind) {
    case 'screenshot':
      return ImageIcon;
    case 'video':
      return Film;
    case 'trace':
      return Workflow;
    case 'console-log':
      return ScrollText;
    case 'json':
    case 'text':
    default:
      return FileText;
  }
}

function artifactKindLabel(kind: ValidationArtifactKind): string {
  switch (kind) {
    case 'screenshot':
      return 'Screenshot';
    case 'video':
      return 'Video';
    case 'trace':
      return 'Trace';
    case 'console-log':
      return 'Console log';
    case 'json':
      return 'JSON';
    case 'text':
      return 'Text';
    default:
      return kind;
  }
}

type PreviewState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'utf8'; content: string }
  | { status: 'image'; src: string; alt: string }
  | { status: 'error'; message: string };

export default function ValidationArtifactList({
  runId,
  artifacts,
}: {
  runId: string;
  artifacts: ValidationArtifactView[];
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState>({ status: 'idle' });
  const [openError, setOpenError] = useState<string | null>(null);

  const selected = artifacts.find((a) => a.id === selectedId) ?? null;

  const loadPreview = useCallback(async (artifact: ValidationArtifactView) => {
    const missingCopy = validationArtifactMissingCopy(artifact.fileState);
    if (missingCopy) {
      setPreview({ status: 'error', message: missingCopy });
      return;
    }
    if (validationArtifactShouldOpenExternally(artifact.kind)) {
      setPreview({ status: 'idle' });
      return;
    }
    if (!validationArtifactCanPreviewInline(artifact.kind)) {
      setPreview({
        status: 'error',
        message: 'Preview is not available for this artifact type. Use Open externally.',
      });
      return;
    }
    setPreview({ status: 'loading' });
    const result = await window.electronAPI.validationRuns.readArtifact({
      runId,
      artifactId: artifact.id,
    });
    if (!result.ok) {
      setPreview({ status: 'error', message: result.error });
      return;
    }
    if (result.encoding === 'base64') {
      setPreview({
        status: 'image',
        src: `data:${result.mimeType};base64,${result.content}`,
        alt: artifact.label,
      });
      return;
    }
    setPreview({ status: 'utf8', content: result.content });
  }, [runId]);

  useEffect(() => {
    setOpenError(null);
    if (!selected) {
      setPreview({ status: 'idle' });
      return;
    }
    void loadPreview(selected);
  }, [selected, loadPreview]);

  const handleOpenExternally = async (artifact: ValidationArtifactView) => {
    setOpenError(null);
    if (artifact.fileState !== 'present') {
      setOpenError('Artifact file is not available on disk.');
      return;
    }
    const result = await window.electronAPI.validationRuns.openArtifact({
      runId,
      artifactId: artifact.id,
    });
    if (!result.ok) {
      setOpenError(result.error);
    }
  };

  if (artifacts.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No artifacts recorded yet. Artifacts appear here after the validator finishes and the verdict
        is ingested.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-1.5" role="list">
        {artifacts.map((artifact) => {
          const Icon = artifactKindIcon(artifact.kind);
          const selectedRow = selectedId === artifact.id;
          const missing = artifact.fileState === 'missing';
          const unreadable = artifact.fileState === 'unreadable';
          return (
            <li key={artifact.id}>
              <Card
                className={cn(
                  'py-0 shadow-none',
                  selectedRow ? 'border-primary/30 bg-accent/50' : '',
                )}
              >
                <CardContent className="flex items-start justify-between gap-2 px-3 py-2">
                  <button
                    type="button"
                    onClick={() => setSelectedId((cur) => (cur === artifact.id ? null : artifact.id))}
                    className="min-w-0 flex-1 text-left"
                    aria-expanded={selectedRow}
                  >
                    <span className="flex items-center gap-2">
                      <Icon className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={2} aria-hidden />
                      <span className="truncate text-sm font-medium">{artifact.label}</span>
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {artifactKindLabel(artifact.kind)}
                      {missing ? ' · Missing on disk' : null}
                      {unreadable ? ' · Unreadable' : null}
                    </span>
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 shrink-0"
                    onClick={() => void handleOpenExternally(artifact)}
                    disabled={missing || unreadable}
                    title={
                      missing
                        ? 'File missing on disk'
                        : unreadable
                          ? 'File unreadable'
                          : 'Open in default app'
                    }
                    aria-label={`Open ${artifact.label} externally`}
                  >
                    <ExternalLink strokeWidth={2} aria-hidden />
                  </Button>
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>

      {openError ? (
        <Alert variant="destructive">
          <AlertDescription className="text-xs">{openError}</AlertDescription>
        </Alert>
      ) : null}

      {selected ? (
        <Card className="shadow-none">
          <CardContent className="p-3">
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Preview</p>
            {preview.status === 'loading' ? (
              <p className="text-xs text-muted-foreground">Loading artifact…</p>
            ) : null}
            {preview.status === 'error' ? (
              <p className="text-xs leading-relaxed text-status-needs-input-foreground">{preview.message}</p>
            ) : null}
            {preview.status === 'utf8' ? (
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-muted/50 p-2.5 font-mono text-[11px] leading-relaxed">
                {preview.content}
              </pre>
            ) : null}
            {preview.status === 'image' ? (
              <img
                src={preview.src}
                alt={preview.alt}
                className="max-h-80 w-full rounded-lg border border-border object-contain"
              />
            ) : null}
            {preview.status === 'idle' && validationArtifactShouldOpenExternally(selected.kind) ? (
              <p className="text-xs leading-relaxed text-muted-foreground">
                {artifactKindLabel(selected.kind)} files open externally in v1. Use the open button above.
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
