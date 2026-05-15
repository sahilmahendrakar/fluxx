import { createHash } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { validateStoredTaskSourceBranchName } from '../taskBranches';

const execFile = promisify(execFileCallback);

/**
 * Human-readable Flux task work branches use `git config user.name` (and
 * fallbacks) from the **repository** that owns the worktree (`cwd` = git root),
 * normalized to a single path segment. There is no separate Flux setting yet;
 * add one later and thread it through {@link resolveFluxAuthorSlugForBranches}
 * before calling {@link chooseFluxTaskWorkBranchName}.
 */
export async function resolveFluxAuthorSlugForBranches(gitRoot: string): Promise<string> {
  const trimmedRoot = gitRoot?.trim();
  if (!trimmedRoot) return 'flux-user';

  const readCfg = async (key: string): Promise<string> => {
    try {
      const { stdout } = await execFile('git', ['config', '--get', key], {
        cwd: trimmedRoot,
        encoding: 'utf8',
      });
      return stdout.trim();
    } catch {
      return '';
    }
  };

  const name = await readCfg('user.name');
  const fromName = slugifySingleBranchSegment(name, 40);
  if (fromName) return fromName;

  const email = await readCfg('user.email');
  const local = email.includes('@') ? email.split('@')[0]! : email;
  const fromEmail = slugifySingleBranchSegment(local, 40);
  if (fromEmail) return fromEmail;

  return 'flux-user';
}

/** Maps a Flux work branch to nested directories under `<project>/worktrees/<repoId>/`. */
export function worktreePathSegmentsForFluxBranch(branchShort: string): string[] {
  const n = branchShort.trim();
  if (!n) return [];
  return n.split('/').filter((s) => s.length > 0);
}

function stripDiacritics(input: string): string {
  return input.normalize('NFKD').replace(/\p{M}/gu, '');
}

/**
 * Lowercase slug: ASCII letters, digits, hyphens only; no leading/trailing `-`.
 * Empty input returns ''.
 */
export function slugifySingleBranchSegment(raw: string, maxLen: number): string {
  const ascii = stripDiacritics(raw)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!ascii) return '';
  if (ascii.length <= maxLen) return ascii;
  return ascii.slice(0, maxLen).replace(/-+$/g, '');
}

const TITLE_FALLBACK_MAX = 12;
const MAX_TOTAL_BRANCH_CHARS = 200;

function titleFallbackSlug(taskId: string): string {
  const h = createHash('sha256').update(taskId, 'utf8').digest('hex').slice(0, TITLE_FALLBACK_MAX);
  return `task-${h}`;
}

function branchLooksValid(shortName: string): boolean {
  return validateStoredTaskSourceBranchName(shortName).ok;
}

/**
 * Picks `authorSlug/titleSlug` with optional `-2`, `-3`, … suffix on the title
 * segment, then a short hash suffix, ensuring the result passes git ref rules.
 */
export function chooseFluxTaskWorkBranchName(input: {
  authorSlug: string;
  taskTitle: string;
  taskId: string;
  takenShortNames: ReadonlySet<string>;
}): string {
  const author = slugifySingleBranchSegment(input.authorSlug, 40) || 'flux-user';
  const rawTitle = input.taskTitle?.trim() || '';
  let titleBase =
    slugifySingleBranchSegment(rawTitle, MAX_TOTAL_BRANCH_CHARS) || titleFallbackSlug(input.taskId);

  while (
    titleBase.length > 0 &&
    !branchLooksValid(`${author}/${titleBase}`)
  ) {
    titleBase = titleBase.slice(0, -1).replace(/-+$/g, '');
  }
  if (!titleBase) {
    titleBase = titleFallbackSlug(input.taskId);
  }

  const taken = (name: string) => {
    const n = name.toLowerCase();
    return input.takenShortNames.has(n) || input.takenShortNames.has(name);
  };

  const tryName = (titlePart: string): string | null => {
    const candidate = `${author}/${titlePart}`;
    if (!branchLooksValid(candidate)) return null;
    if (candidate.length > MAX_TOTAL_BRANCH_CHARS) return null;
    if (taken(candidate)) return null;
    return candidate;
  };

  const first = tryName(titleBase);
  if (first) return first;

  for (let n = 2; n <= 99; n++) {
    const suffix = `-${n}`;
    const maxTitle =
      MAX_TOTAL_BRANCH_CHARS - author.length - 1 - suffix.length;
    const truncated = titleBase.slice(0, Math.max(1, maxTitle));
    const withNum = tryName(`${truncated}${suffix}`);
    if (withNum) return withNum;
  }

  const h = createHash('sha256').update(`${input.taskId}:${titleBase}`, 'utf8').digest('hex').slice(0, 7);
  const hashSuffix = `-${h}`;
  const maxTitleForHash = MAX_TOTAL_BRANCH_CHARS - author.length - 1 - hashSuffix.length;
  const truncatedForHash = titleBase.slice(0, Math.max(1, maxTitleForHash));
  const hashed = tryName(`${truncatedForHash}${hashSuffix}`);
  if (hashed) return hashed;

  return `${author}/${titleFallbackSlug(input.taskId)}`;
}

export async function collectTakenFluxWorkBranchNames(gitRoot: string): Promise<Set<string>> {
  const cwd = gitRoot.trim();
  const out = new Set<string>();
  if (!cwd) return out;

  const add = (raw: string) => {
    const s = raw.trim();
    if (s) out.add(s.toLowerCase());
  };

  try {
    const { stdout } = await execFile('git', ['branch', '--list', '--format=%(refname:short)'], {
      cwd,
      encoding: 'utf8',
    });
    for (const line of stdout.split('\n')) add(line);
  } catch {
    /* ignore */
  }

  try {
    const { stdout } = await execFile('git', ['worktree', 'list', '--porcelain'], {
      cwd,
      encoding: 'utf8',
    });
    for (const block of stdout.split(/\n\n+/)) {
      let branchLine: string | null = null;
      for (const line of block.split('\n')) {
        if (line.startsWith('branch ')) {
          const ref = line.slice('branch '.length).trim();
          if (ref.startsWith('refs/heads/')) {
            branchLine = ref.slice('refs/heads/'.length);
          }
        }
      }
      if (branchLine) add(branchLine);
    }
  } catch {
    /* ignore */
  }

  return out;
}
