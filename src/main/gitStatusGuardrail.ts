import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);

const MAX_DIFF_STAT_LINES = 80;

export type GitStatusGuardrailSnapshot = {
  porcelain: string;
  capturedAt: string;
};

export type GitStatusGuardrailComparison = {
  pre: GitStatusGuardrailSnapshot;
  post: GitStatusGuardrailSnapshot;
  driftDetected: boolean;
  /** Human-readable note when pre/post porcelain differ. */
  driftSummary?: string;
};

async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFile('git', args, {
    cwd,
    maxBuffer: 512 * 1024,
    timeout: 30_000,
  });
  return stdout;
}

/** Captures `git status --porcelain` for validation guardrails. */
export async function captureGitStatusPorcelain(cwd: string): Promise<GitStatusGuardrailSnapshot> {
  try {
    const porcelain = (await runGit(cwd, ['status', '--porcelain'])).trimEnd();
    return { porcelain, capturedAt: new Date().toISOString() };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      porcelain: `(git status failed: ${message})`,
      capturedAt: new Date().toISOString(),
    };
  }
}

function normalizePorcelainForCompare(raw: string): string[] {
  return raw
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .sort();
}

export function compareGitStatusPorcelain(
  pre: GitStatusGuardrailSnapshot,
  post: GitStatusGuardrailSnapshot,
): GitStatusGuardrailComparison {
  const preLines = normalizePorcelainForCompare(pre.porcelain);
  const postLines = normalizePorcelainForCompare(post.porcelain);
  const driftDetected =
    preLines.join('\n') !== postLines.join('\n') ||
    pre.porcelain.startsWith('(git status failed') ||
    post.porcelain.startsWith('(git status failed');
  if (!driftDetected) {
    return { pre, post, driftDetected: false };
  }
  const added = postLines.filter((l) => !preLines.includes(l));
  const removed = preLines.filter((l) => !postLines.includes(l));
  const parts: string[] = ['Git working tree changed during validation.'];
  if (added.length > 0) {
    parts.push(`New/changed entries (${added.length}):`);
    parts.push(...added.slice(0, 20).map((l) => `- ${l}`));
    if (added.length > 20) parts.push(`- … and ${added.length - 20} more`);
  }
  if (removed.length > 0) {
    parts.push(`Removed entries (${removed.length}):`);
    parts.push(...removed.slice(0, 20).map((l) => `- ${l}`));
    if (removed.length > 20) parts.push(`- … and ${removed.length - 20} more`);
  }
  return { pre, post, driftDetected: true, driftSummary: parts.join('\n') };
}

/** Summarizes changed files and diff stats for the validator prompt. */
export async function captureWorktreeChangeSummary(cwd: string): Promise<string> {
  const sections: string[] = [];
  try {
    const status = (await runGit(cwd, ['status', '--porcelain'])).trimEnd();
    sections.push('### `git status --porcelain`', '', status.length > 0 ? status : '_(clean)_', '');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sections.push('### `git status --porcelain`', '', `_(failed: ${message})_`, '');
  }

  for (const [label, args] of [
    ['Unstaged diff stat', ['diff', '--stat']],
    ['Staged diff stat', ['diff', '--cached', '--stat']],
  ] as const) {
    try {
      const stat = (await runGit(cwd, args)).trimEnd();
      sections.push(`### ${label}`, '', stat.length > 0 ? stat : '_(none)_', '');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sections.push(`### ${label}`, '', `_(failed: ${message})_`, '');
    }
  }

  const body = sections.join('\n');
  const lines = body.split('\n');
  if (lines.length <= MAX_DIFF_STAT_LINES) return body;
  return `${lines.slice(0, MAX_DIFF_STAT_LINES).join('\n')}\n\n_(truncated)_`;
}
