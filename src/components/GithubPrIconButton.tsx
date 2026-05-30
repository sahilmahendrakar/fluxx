import { GitMerge, GitPullRequest, GitPullRequestCreate, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TaskGithubPr } from '../types';
import { shouldShowGithubPrIconButton } from '../gitUiGating';

export interface GithubPrIconButtonProps {
  githubPr?: TaskGithubPr | null;
  taskId: string;
  /** Same gate as board `TaskCard` (session path or resolved disk worktree). */
  hasWorktree: boolean;
  /** When false, the control is hidden (gitless project). Defaults to on. */
  gitEnabled?: boolean;
  onTaskPrClick?: (taskId: string) => void;
  prLoading?: boolean;
  /** After delegating PR creation to the agent; amber styling until a PR URL is linked (icon stays create). */
  prAgentAwaiting?: boolean;
}

/**
 * Compact PR control aligned with `TaskCard`: open / merged / closed / create,
 * shared aria-label and title strings, loading state.
 */
export function GithubPrIconButton({
  githubPr,
  taskId,
  hasWorktree,
  gitEnabled = true,
  onTaskPrClick,
  prLoading = false,
  prAgentAwaiting = false,
}: GithubPrIconButtonProps) {
  if (!shouldShowGithubPrIconButton({ gitEnabled, hasWorktree, onTaskPrClick })) return null;
  const onPrClick = onTaskPrClick!;

  const prUrl = githubPr?.url?.trim() ?? '';
  const prState = githubPr?.state;
  const prMergedAt = githubPr?.mergedAt?.trim() ?? '';
  const prMerged = prState === 'merged' || prMergedAt.length > 0;
  const prIsOpen = prState === 'open';
  const prIsClosed = prState === 'closed';
  const prLinked = Boolean(prUrl) && !prMerged;
  const prAwaitingAgent = Boolean(prAgentAwaiting) && !prUrl && !prLoading;

  return (
    <button
      type="button"
      disabled={prLoading}
      onClick={() => onPrClick(taskId)}
      className={cn(
        '-m-0.5 flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded transition disabled:cursor-not-allowed disabled:opacity-60',
        prMerged
          ? 'text-purple-600 hover:bg-purple-500/12 hover:text-purple-700 dark:text-purple-400/85 dark:hover:text-purple-300/90'
          : prIsOpen
            ? 'text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-700 dark:text-emerald-500/75 dark:hover:text-emerald-400/85'
            : prLinked
              ? 'text-muted-foreground hover:bg-muted hover:text-foreground'
              : prAwaitingAgent
                ? 'text-amber-600 hover:bg-amber-500/10 hover:text-amber-700 dark:text-amber-400/80 dark:hover:text-amber-300/85'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
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
                  : prAwaitingAgent
                    ? 'Pull request requested from agent; click to send creation prompt again'
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
                  : prAwaitingAgent
                    ? 'PR creation was sent to the agent — click to send again, or wait for automatic checks'
                    : 'Create GitHub pull request'
      }
    >
      {prLoading ? (
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" aria-hidden />
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
