import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, FileText, Film, ImageIcon, ScrollText, Workflow } from 'lucide-react';
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
      <p className="text-xs text-zinc-600">
        No artifacts recorded yet. Artifacts appear here after the validator finishes and the verdict
        is ingested.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-1.5" role="list">
        {artifacts.map((artifact) => {
          const Icon = artifactKindIcon(artifact.kind);
          const selectedRow = selectedId === artifact.id;
          const missing = artifact.fileState === 'missing';
          const unreadable = artifact.fileState === 'unreadable';
          return (
            <li
              key={artifact.id}
              className={`rounded-lg border px-3 py-2 ${
                selectedRow
                  ? 'border-white/[0.12] bg-white/[0.04]'
                  : 'border-white/[0.06] bg-white/[0.02]'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedId((cur) => (cur === artifact.id ? null : artifact.id))}
                  className="min-w-0 flex-1 text-left"
                  aria-expanded={selectedRow}
                >
                  <span className="flex items-center gap-2">
                    <Icon className="h-3.5 w-3.5 shrink-0 text-zinc-500" strokeWidth={2} aria-hidden />
                    <span className="truncate text-[13px] font-medium text-zinc-200">{artifact.label}</span>
                  </span>
                  <span className="mt-0.5 block text-[11px] text-zinc-500">
                    {artifactKindLabel(artifact.kind)}
                    {missing ? ' · Missing on disk' : null}
                    {unreadable ? ' · Unreadable' : null}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleOpenExternally(artifact)}
                  disabled={missing || unreadable}
                  title={
                    missing
                      ? 'File missing on disk'
                      : unreadable
                        ? 'File unreadable'
                        : 'Open in default app'
                  }
                  className="shrink-0 rounded-md p-1.5 text-zinc-500 transition hover:bg-white/[0.06] hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label={`Open ${artifact.label} externally`}
                >
                  <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {openError ? (
        <p className="text-[11px] text-red-300/90" role="alert">
          {openError}
        </p>
      ) : null}

      {selected ? (
        <div className="rounded-xl border border-white/[0.08] bg-[#0c0c0e] p-3">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-500">
            Preview
          </p>
          {preview.status === 'loading' ? (
            <p className="text-xs text-zinc-500">Loading artifact…</p>
          ) : null}
          {preview.status === 'error' ? (
            <p className="text-xs leading-relaxed text-amber-200/90">{preview.message}</p>
          ) : null}
          {preview.status === 'utf8' ? (
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-white/[0.06] bg-[#09090b] p-2.5 font-mono text-[11px] leading-relaxed text-zinc-300">
              {preview.content}
            </pre>
          ) : null}
          {preview.status === 'image' ? (
            <img
              src={preview.src}
              alt={preview.alt}
              className="max-h-80 w-full rounded-lg border border-white/[0.06] object-contain"
            />
          ) : null}
          {preview.status === 'idle' && validationArtifactShouldOpenExternally(selected.kind) ? (
            <p className="text-xs leading-relaxed text-zinc-500">
              {artifactKindLabel(selected.kind)} files open externally in v1. Use the open button
              above.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
