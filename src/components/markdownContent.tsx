import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

export type MarkdownProseDensity = 'docs' | 'panel';

/** Shared typography for planning docs and task descriptions (light + dark via semantic tokens). */
export function markdownProseClassName(
  options: { density?: MarkdownProseDensity; scroll?: boolean } = {},
): string {
  const { density = 'docs', scroll = false } = options;
  const panel = density === 'panel';

  return cn(
    'min-w-0 text-[13px] leading-relaxed text-foreground',
    scroll && 'min-h-0 flex-1 overflow-y-auto px-8 pb-4 pt-2',
    '[&_a]:text-primary [&_a]:underline [&_a]:decoration-primary/40 [&_a]:underline-offset-2 hover:[&_a]:text-primary/80',
    panel
      ? '[&_h1]:mb-2 [&_h1]:mt-0 [&_h1]:text-lg [&_h1]:font-semibold [&_h1]:text-foreground'
      : '[&_h1]:mb-3 [&_h1]:mt-6 [&_h1]:text-xl [&_h1]:font-semibold [&_h1]:text-foreground [&_h1]:first:mt-0',
    panel
      ? '[&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-base [&_h2]:font-medium [&_h2]:text-foreground first:[&_h2]:mt-0'
      : '[&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:text-lg [&_h2]:font-medium [&_h2]:text-foreground',
    panel
      ? '[&_h3]:mb-1.5 [&_h3]:mt-3 [&_h3]:text-[14px] [&_h3]:font-medium [&_h3]:text-foreground'
      : '[&_h3]:mb-2 [&_h3]:mt-4 [&_h3]:text-[15px] [&_h3]:font-medium [&_h3]:text-foreground',
    panel
      ? '[&_p]:my-2.5 [&_p]:text-foreground first:[&_p]:mt-0 last:[&_p]:mb-0'
      : '[&_p]:my-3 [&_p]:text-foreground',
    panel
      ? '[&_ul]:my-2.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2.5 [&_ol]:list-decimal [&_ol]:pl-5'
      : '[&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-5',
    panel ? '[&_li]:my-0.5' : '[&_li]:my-1',
    panel
      ? '[&_blockquote]:my-2.5 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground'
      : '[&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground',
    '[&_code]:rounded-md [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[12px] [&_code]:text-foreground',
    panel
      ? '[&_pre]:my-2.5 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:border [&_pre]:border-border [&_pre]:bg-muted/60 [&_pre]:p-2.5'
      : '[&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:border [&_pre]:border-border [&_pre]:bg-muted/60 [&_pre]:p-3',
    '[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-[12px] [&_pre_code]:text-foreground',
    panel
      ? '[&_table]:my-3 [&_table]:w-full [&_table]:border-collapse text-[12px]'
      : '[&_table]:my-4 [&_table]:w-full [&_table]:border-collapse [&_table]:text-left text-[12px]',
    '[&_th]:border [&_th]:border-border [&_th]:bg-muted/80 [&_th]:px-2 [&_th]:py-1.5 [&_th]:font-medium [&_th]:text-foreground',
    '[&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1.5',
    panel ? '[&_hr]:my-4 [&_hr]:border-border' : '[&_hr]:my-6 [&_hr]:border-border',
    '[&_strong]:font-semibold [&_strong]:text-foreground',
  );
}

export function MarkdownContent({
  children,
  className,
  density = 'docs',
  scroll = false,
}: {
  children: string;
  className?: string;
  density?: MarkdownProseDensity;
  scroll?: boolean;
}) {
  return (
    <article className={cn(markdownProseClassName({ density, scroll }), className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </article>
  );
}
