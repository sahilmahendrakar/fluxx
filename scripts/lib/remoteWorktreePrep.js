'use strict';

/**
 * Mirrors {@link WorktreeService.prepareWorktreePath} for SSH remote helper worktrees.
 * Remote task paths are keyed by task id; when fluxxWorkBranch changes, reclaim stale dirs.
 */
function createRemoteWorktreePrep(deps) {
  const { gitRun, fs, path } = deps;

  function resolveLocalBranchShortForWorktreePath(gitRoot, worktreePath) {
    const cwd = gitRoot?.trim();
    const want = path.resolve(worktreePath);
    if (!cwd || !want) return null;
    const listed = gitRun(['worktree', 'list', '--porcelain'], { cwd });
    if (!listed.ok || !listed.stdout) return null;
    for (const block of listed.stdout.split(/\n\n+/)) {
      let wtLine = null;
      let branchShort = null;
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
    return null;
  }

  function readHeadBranchShortAtPath(worktreePath) {
    const cwd = worktreePath?.trim();
    if (!cwd) return null;
    const head = gitRun(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd });
    if (!head.ok || !head.stdout) return null;
    const b = head.stdout.trim();
    if (!b || b === 'HEAD') return null;
    return b;
  }

  function isGitWorktreeCheckout(dir) {
    const inside = gitRun(['rev-parse', '--is-inside-work-tree'], { cwd: dir });
    return inside.ok && inside.stdout.trim() === 'true';
  }

  function forceReclaimWorktreePath(worktreePath, gitRootResolved) {
    process.stderr.write(
      `[fluxx-remote-helper] reclaiming stale worktree: ${worktreePath}\n`,
    );
    gitRun(['worktree', 'remove', worktreePath, '--force'], { cwd: gitRootResolved });
    try {
      fs.rmSync(worktreePath, { recursive: true, force: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to remove stale worktree at ${worktreePath}: ${message}`);
    }
    gitRun(['worktree', 'prune'], { cwd: gitRootResolved });
  }

  /**
   * @returns {'absent' | 'healthy'}
   */
  function prepareWorktreePath(worktreePath, gitRootResolved, expectedBranch) {
    if (!fs.existsSync(worktreePath)) {
      gitRun(['worktree', 'prune'], { cwd: gitRootResolved });
      return 'absent';
    }

    const registeredBranch = resolveLocalBranchShortForWorktreePath(
      gitRootResolved,
      worktreePath,
    );
    if (registeredBranch === expectedBranch) {
      return 'healthy';
    }

    const headBranch = readHeadBranchShortAtPath(worktreePath);
    if (
      registeredBranch == null &&
      headBranch === expectedBranch &&
      isGitWorktreeCheckout(worktreePath)
    ) {
      return 'healthy';
    }

    forceReclaimWorktreePath(worktreePath, gitRootResolved);
    return 'absent';
  }

  return {
    prepareWorktreePath,
    forceReclaimWorktreePath,
    resolveLocalBranchShortForWorktreePath,
    readHeadBranchShortAtPath,
    isGitWorktreeCheckout,
  };
}

module.exports = { createRemoteWorktreePrep };
