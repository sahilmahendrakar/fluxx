import { GitMerge, GitPullRequest, GitPullRequestCreate, Loader2 } from 'lucide-react';
import type { TaskGithubPr } from '../types';

export interface GithubPrIconButtonProps {
  githubPr?: TaskGithubPr | null;
  taskId: string;
  /** Same gate as board `TaskCard` (session path or resolved disk worktree). */
  hasWorktree: boolean;
  onTaskPrClick?: (taskId: string) => void;
  prLoading?: boolean;
}

/**
 * Compact PR control aligned with `TaskCard`: open / merged / closed / create,
 * shared aria-label and title strings, loading state.
 */
export function GithubPrIconButton({
  githubPr,
  taskId,
  hasWorktree,
  onTaskPrClick,
  prLoading = false,
}: GithubPrIconButtonProps) {
  if (!hasWorktree || typeof onTaskPrClick !== 'function') return null;

  const prUrl = githubPr?.url?.trim() ?? '';
  const prState = githubPr?.state;
  const prMergedAt = githubPr?.mergedAt?.trim() ?? '';
  const prMerged = prState === 'merged' || prMergedAt.length > 0;
  const prIsOpen = prState === 'open';
  const prIsClosed = prState === 'closed';
  const prLinked = Boolean(prUrl) && !prMerged;

  return (
    <button
      type="button"
      disabled={prLoading}
      onClick={() => onTaskPrClick(taskId)}
      className={`-m-0.5 flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded transition disabled:cursor-not-allowed disabled:opacity-60 ${
        prMerged
          ? 'text-purple-400/85 hover:bg-purple-500/12 hover:text-purple-300/90'
          : prIsOpen
            ? 'text-emerald-500/75 hover:bg-emerald-500/10 hover:text-emerald-400/85'
            : prLinked
              ? 'text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-200'
              : 'text-zinc-500 hover:bg-white/[0.05] hover:text-zinc-300'
      }`}
      aria-label={
        prLoading
          ? 'Working with pull request…'
          : prMerged
            ? 'Open merged pull request'
            : prIsOpen
              ? 'Open pull request'
              : prIsClosed
                ? 'Open closed pull request'
                : prLinked
                  ? 'Open pull request'
                  : 'Create GitHub pull request'
      }
      title={
        prLoading
          ? 'Please wait…'
          : prMerged
            ? 'Open merged pull request'
            : prIsOpen
              ? 'Open pull request'
              : prIsClosed
                ? 'Open closed pull request'
                : prLinked
                  ? 'Open pull request'
                  : 'Create GitHub pull request'
      }
    >
      {prLoading ? (
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-zinc-400" aria-hidden />
      ) : prMerged ? (
        <GitMerge className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
      ) : prLinked ? (
        <GitPullRequest className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
      ) : (
        <GitPullRequestCreate className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
      )}
    </button>
  );
}
