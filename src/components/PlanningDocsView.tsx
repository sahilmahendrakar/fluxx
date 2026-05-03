import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface PlanningDocsViewProps {
  selectedPath: string | null;
  /** Increment when the file may have changed on disk (same path). */
  fileRevision?: number;
}

export function PlanningDocsView({
  selectedPath,
  fileRevision = 0,
}: PlanningDocsViewProps) {
  const api = window.electronAPI.planningDocs;

  const [content, setContent] = useState<string>('');
  const [readError, setReadError] = useState<string | null>(null);
  const [loadingRead, setLoadingRead] = useState(false);

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

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-flux-canvas">
      {!selectedPath ? (
        <div className="flex h-full items-center justify-center px-6 text-center text-sm text-flux-fg-subtle">
          Choose a document from the sidebar, or expand <span className="px-1 font-medium text-flux-fg-muted">Docs</span> to see what is in{' '}
          <span className="font-mono text-flux-fg-muted">planning/</span>.
        </div>
      ) : (
        <div className="flex h-full min-h-0 flex-col overflow-hidden">
          <header className="shrink-0 border-b border-flux-border/10 px-5 py-3">
            <h1 className="truncate font-mono text-[13px] font-medium text-flux-fg-muted">
              {selectedPath}
            </h1>
            {readError ? (
              <p className="mt-1 text-[12px] text-red-400/90">{readError}</p>
            ) : loadingRead ? (
              <p className="mt-1 text-[12px] text-flux-fg-subtle">Loading…</p>
            ) : null}
          </header>
          <article
            className={[
              'min-h-0 flex-1 overflow-y-auto px-5 py-4 text-[13px] leading-relaxed text-flux-fg-muted',
              '[&_a]:text-sky-400 [&_a]:underline [&_a]:decoration-sky-400/40 [&_a]:underline-offset-2 hover:[&_a]:text-sky-300',
              '[&_h1]:mb-3 [&_h1]:mt-6 [&_h1]:text-xl [&_h1]:font-semibold [&_h1]:text-flux-fg [&_h1]:first:mt-0',
              '[&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:text-lg [&_h2]:font-medium [&_h2]:text-flux-fg',
              '[&_h3]:mb-2 [&_h3]:mt-4 [&_h3]:text-[15px] [&_h3]:font-medium [&_h3]:text-flux-fg-muted',
              '[&_p]:my-3 [&_p]:text-flux-fg-muted',
              '[&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-5',
              '[&_li]:my-1',
              '[&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-flux-border/30 [&_blockquote]:pl-4 [&_blockquote]:text-flux-fg-muted',
              '[&_code]:rounded [&_code]:bg-flux-hover/12 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[12px] [&_code]:text-emerald-200/90',
              '[&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-flux-border/12 [&_pre]:bg-flux-surface [&_pre]:p-3',
              '[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-[12px] [&_pre_code]:text-flux-fg-muted',
              '[&_table]:my-4 [&_table]:w-full [&_table]:border-collapse [&_table]:text-left text-[12px]',
              '[&_th]:border [&_th]:border-flux-border/12 [&_th]:bg-flux-hover/6 [&_th]:px-2 [&_th]:py-1.5 [&_th]:font-medium [&_th]:text-flux-fg-muted',
              '[&_td]:border [&_td]:border-flux-border/10 [&_td]:px-2 [&_td]:py-1.5',
              '[&_hr]:my-6 [&_hr]:border-flux-border/12',
              '[&_strong]:font-semibold [&_strong]:text-flux-fg',
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
