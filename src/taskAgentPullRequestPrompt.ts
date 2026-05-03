import type { Task } from './types';
import { effectiveTaskSourceBranchShort } from './taskBranches';

export type TaskAgentPullRequestPromptParams = {
  taskId: string;
  taskTitle: string;
  /** Flux task work branch (session head), e.g. `flux/task-…`. */
  headBranch: string;
  /** Resolved PR base branch (task source branch or project default). */
  baseBranch: string;
  /** Optional PR title; defaults to task title. */
  prTitle?: string;
  /** Optional PR body. */
  prBody?: string;
  /** Absolute path to Flux-written `create-pr.md` (project-level, outside the worktree). */
  instructionsAbsolutePath: string;
};

/**
 * Static PR workflow written to `<projectDir>/agent-instructions/create-pr.md`.
 * Per-task values (id, branches, title, body) are in the short chat prompt only.
 */
export function buildCreatePrInstructionsMarkdown(): string {
  return [
    '# Flux: GitHub pull request from the task agent',
    '',
    "Use this task's git worktree as cwd. The user asked Flux to delegate PR creation to you (the task agent), not to run `gh pr create` from the Flux app.",
    '',
    'The Flux prompt that referenced this file includes the **task id**, **task title**, **head branch**, **PR base branch**, and suggested PR title/body. Use those values for the steps below.',
    '',
    '## What to do',
    '1. Inspect the repo: `git status`, and `git diff` / `git diff --staged` as needed.',
    '2. Commit any changes that belong to this task with a clear message. Skip files that look like secrets, credentials, or local-only noise.',
    '3. Push the head branch to `origin` (e.g. `git push -u origin HEAD` or equivalent for this branch). Do **not** force-push or use other destructive git commands unless the user has explicitly approved them in this session.',
    '4. Create a GitHub pull request targeting the base branch from the Flux message, e.g. `gh pr create --base <base> --head <head> --title ... --body ...` (adjust flags to match the repo; `gh` must already be authenticated).',
    '5. When finished, reply with the **PR URL** so the user can open it. If something blocks you (no `gh`, auth, push rejected, wrong branch), explain briefly and say what they should fix.',
    '',
    '## Constraints',
    '- Do not commit secrets, API keys, `.env` with real credentials, or large generated artifacts unless they are clearly intended for the repo.',
    '- Avoid `git push --force`, `git reset --hard` on shared history, or other destructive operations unless the user explicitly asked for them in this chat.',
  ].join('\n');
}

/**
 * Resolves head/base for the GitHub PR the task agent should open, using the
 * same source-branch rules as Flux's PR automation (`effectiveTaskSourceBranchShort`).
 */
export function resolveAgentPullRequestBranchContext(params: {
  task: Pick<Task, 'sourceBranch'>;
  projectDefaultBranchShort: string;
  sessionBranch: string;
}): { baseBranch: string; headBranch: string } {
  const head = params.sessionBranch.trim();
  const base = effectiveTaskSourceBranchShort(
    params.task,
    params.projectDefaultBranchShort,
  );
  return { baseBranch: base, headBranch: head };
}

/**
 * Short user message injected into the task agent session when the user requests
 * a new GitHub PR from the board. Full steps live in `instructionsAbsolutePath`
 * (avoids Cursor truncating long pastes in its input viewport).
 */
export function buildTaskAgentPullRequestPrompt(p: TaskAgentPullRequestPromptParams): string {
  const title = (p.prTitle ?? p.taskTitle).trim() || p.taskTitle.trim();
  const body =
    (p.prBody ?? '').trim() ||
    `_Task_: ${p.taskTitle.trim() || p.taskId}`;
  const titleEscaped = title.replace(/`/g, "'");
  const instructionsPath = p.instructionsAbsolutePath.trim();

  return [
    '## Flux: open a GitHub pull request for this task',
    '',
    '- **Task id:** `' + p.taskId + '`',
    '- **Task title:** ' + (p.taskTitle.trim() || '(untitled)'),
    '- **Head branch (push from here):** `' + p.headBranch + '`',
    '- **PR base branch (GitHub `--base`):** `' + p.baseBranch + '`',
    '- **Suggested PR title:** `' + titleEscaped + '`',
    '- **Suggested PR body (edit if needed):**',
    '',
    '```',
    body,
    '```',
    '',
    'Read the full instructions at `' + instructionsPath + '` and follow them to commit, push, and open the PR. Reply with the **PR URL** when done.',
    '',
    '**Constraints:** Do not commit secrets, API keys, `.env` with real credentials, or large generated artifacts unless clearly intended for the repo.',
  ].join('\n');
}

/**
 * Single-line PR ask for **Cursor agent** PTY injection. Cursor often collapses multiline
 * bracketed pastes to `[Pasted N lines]`, after which Enter may not submit the real buffer;
 * full details remain in {@link buildCreatePrInstructionsMarkdown} at `instructionsAbsolutePath`.
 */
export function buildTaskAgentPullRequestPromptCursorCompact(p: TaskAgentPullRequestPromptParams): string {
  const title = (p.prTitle ?? p.taskTitle).trim() || p.taskTitle.trim();
  const titleShort = title.length > 200 ? `${title.slice(0, 200)}…` : title;
  const titleEscaped = titleShort.replace(/`/g, "'");
  const path = p.instructionsAbsolutePath.trim();
  return (
    `Flux: Open a GitHub PR for task \`${p.taskId}\` — ${titleEscaped}. ` +
    `Head \`${p.headBranch}\`, base \`${p.baseBranch}\`. ` +
    `Read \`${path}\` for full steps (commit, push, gh pr create). Reply with the PR URL. ` +
    `Constraints: do not commit secrets or real .env credentials; no force-push unless the user asked in this session.`
  );
}
