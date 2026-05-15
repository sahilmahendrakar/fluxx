import path from 'node:path';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);

/**
 * Resolves the local branch short name checked out at `worktreePath` for `gitRoot`,
 * using `git worktree list --porcelain`. Returns null when detached or unknown.
 */
export async function resolveLocalBranchShortForWorktreePath(
  gitRoot: string,
  worktreePath: string,
): Promise<string | null> {
  const cwd = gitRoot?.trim();
  if (!cwd || !worktreePath?.trim()) return null;
  const want = path.resolve(worktreePath);
  try {
    const { stdout } = await execFile('git', ['worktree', 'list', '--porcelain'], {
      cwd,
      encoding: 'utf8',
    });
    for (const block of stdout.split(/\n\n+/)) {
      let wtLine: string | null = null;
      let branchShort: string | null = null;
      for (const line of block.split('\n')) {
        if (line.startsWith('worktree ')) {
          wtLine = line.slice('worktree '.length).trim();
        } else if (line.startsWith('branch ')) {
          const ref = line.slice('branch '.length).trim();
          if (ref.startsWith('refs/heads/')) {
            branchShort = ref.slice('refs/heads/'.length);
          }
        }
      }
      if (wtLine && branchShort) {
        const absWt = path.isAbsolute(wtLine) ? path.resolve(wtLine) : path.resolve(cwd, wtLine);
        if (absWt === want) {
          return branchShort;
        }
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** Best-effort current branch for a checkout directory (before the folder is removed). */
export async function readHeadBranchShortAtPath(worktreePath: string): Promise<string | null> {
  const cwd = worktreePath?.trim();
  if (!cwd) return null;
  try {
    const { stdout } = await execFile('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd,
      encoding: 'utf8',
    });
    const b = stdout.trim();
    if (!b || b === 'HEAD') return null;
    return b;
  } catch {
    return null;
  }
}
