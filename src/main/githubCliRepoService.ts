import { execFile as execFileCallback, type ExecFileOptions } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  GITHUB_COM_HOSTNAME,
  type GithubCliPrerequisites,
  type GithubCliRepoSummary,
  type GithubRepoCloneInput,
  type GithubRepoCreateInput,
  type GithubRepoListInput,
  type GithubRepoOnboardingError,
  type GithubRepoOnboardingErrorCode,
  type GithubRepoOnboardingResult,
  type GithubRepoVisibility,
} from '../githubRepoOnboarding/types';

const defaultExecFile = promisify(execFileCallback);

/** Fields requested from `gh repo list --json` (keep minimal for older gh). */
export const GH_REPO_LIST_JSON_FIELDS = [
  'nameWithOwner',
  'url',
  'sshUrl',
  'description',
  'visibility',
  'isPrivate',
  'defaultBranchRef',
  'updatedAt',
] as const;

const DEFAULT_REPO_LIST_LIMIT = 100;
const GH_EXEC_TIMEOUT_MS = 120_000;
const GH_VERSION_TIMEOUT_MS = 5_000;
const GH_AUTH_TIMEOUT_MS = 10_000;

export type GhExecFile = (
  file: string,
  args: readonly string[],
  options?: ExecFileOptions,
) => Promise<{ stdout: string; stderr: string }>;

function errnoCode(err: unknown): string | undefined {
  return err && typeof err === 'object' && 'code' in err
    ? (err as NodeJS.ErrnoException).code
    : undefined;
}

function stderrOf(err: unknown): string {
  if (err && typeof err === 'object' && 'stderr' in err) {
    const s = (err as { stderr?: Buffer | string }).stderr;
    if (Buffer.isBuffer(s)) return s.toString('utf8');
    if (typeof s === 'string') return s;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

function ghFailure(
  code: GithubRepoOnboardingErrorCode,
  message: string,
): GithubRepoOnboardingError {
  return { ok: false, code, message };
}

function normalizeRepoSlug(name: string, owner?: string): string | GithubRepoOnboardingError {
  const trimmed = name.trim();
  if (!trimmed) {
    return ghFailure('INVALID_INPUT', 'Repository name is required');
  }
  if (trimmed.includes('/')) {
    if (trimmed.startsWith('/') || trimmed.endsWith('/') || trimmed.split('/').length !== 2) {
      return ghFailure('INVALID_INPUT', 'Repository name must be `owner/name` or a short name');
    }
    return trimmed;
  }
  const ownerTrimmed = owner?.trim();
  if (ownerTrimmed) {
    return `${ownerTrimmed}/${trimmed}`;
  }
  return trimmed;
}

function visibilityFlag(visibility: GithubRepoVisibility): string {
  switch (visibility) {
    case 'public':
      return '--public';
    case 'private':
      return '--private';
    case 'internal':
      return '--internal';
    default:
      return '--private';
  }
}

function mapGhExecError(
  err: unknown,
  context: { notInstalledCode?: GithubRepoOnboardingErrorCode } = {},
): GithubRepoOnboardingError {
  if (errnoCode(err) === 'ENOENT') {
    return ghFailure(
      context.notInstalledCode ?? 'GH_NOT_INSTALLED',
      'GitHub CLI (gh) is not installed or not on PATH. Install from https://cli.github.com/ and try again.',
    );
  }
  const stderr = stderrOf(err).trim();
  const combined = stderr || (err instanceof Error ? err.message : String(err));
  if (isUnauthenticatedMessage(combined)) {
    return ghFailure(
      'GH_NOT_AUTHENTICATED',
      'GitHub CLI is not signed in for github.com. Run `gh auth login` and try again.',
    );
  }
  if (isPermissionDeniedMessage(combined)) {
    return ghFailure(
      'GH_PERMISSION_DENIED',
      combined || 'GitHub rejected this operation (insufficient permissions).',
    );
  }
  return ghFailure('GH_COMMAND_FAILED', combined || 'GitHub CLI command failed');
}

function isUnauthenticatedMessage(text: string): boolean {
  const t = text.toLowerCase();
  return (
    t.includes('not logged in') ||
    t.includes('not logged into') ||
    t.includes('authentication required') ||
    t.includes('gh auth login') ||
    t.includes('no auth token') ||
    t.includes('failed to authenticate') ||
    t.includes('401')
  );
}

function isPermissionDeniedMessage(text: string): boolean {
  const t = text.toLowerCase();
  return (
    t.includes('permission denied') ||
    t.includes('insufficient') ||
    t.includes('resource not accessible') ||
    t.includes('403') ||
    t.includes('must have admin rights') ||
    t.includes('sso')
  );
}

function isRepoCreateFailureMessage(text: string): boolean {
  const t = text.toLowerCase();
  return (
    t.includes('already exists') ||
    t.includes('name already exists') ||
    t.includes('repository creation failed') ||
    t.includes('failed to create')
  );
}

function isCloneFailureMessage(text: string): boolean {
  const t = text.toLowerCase();
  return (
    t.includes('fatal: destination path') ||
    t.includes('already exists and is not an empty directory') ||
    t.includes('clone failed') ||
    t.includes('could not clone')
  );
}

function parseGhVersion(stdout: string): string | undefined {
  const line = stdout
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return line || undefined;
}

export function parseGhRepoListJson(stdout: string): GithubCliRepoSummary[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const repos: GithubCliRepoSummary[] = [];
  for (const row of parsed) {
    if (!row || typeof row !== 'object') continue;
    const nameWithOwner = (row as { nameWithOwner?: unknown }).nameWithOwner;
    if (typeof nameWithOwner !== 'string' || nameWithOwner.trim() === '') continue;
    const summary: GithubCliRepoSummary = { nameWithOwner: nameWithOwner.trim() };
    const url = (row as { url?: unknown }).url;
    if (typeof url === 'string' && url.trim()) summary.url = url.trim();
    const sshUrl = (row as { sshUrl?: unknown }).sshUrl;
    if (typeof sshUrl === 'string' && sshUrl.trim()) summary.sshUrl = sshUrl.trim();
    const description = (row as { description?: unknown }).description;
    if (typeof description === 'string' && description.trim()) {
      summary.description = description.trim();
    }
    const visibility = (row as { visibility?: unknown }).visibility;
    if (typeof visibility === 'string' && visibility.trim()) {
      summary.visibility = visibility.trim();
    }
    const isPrivate = (row as { isPrivate?: unknown }).isPrivate;
    if (typeof isPrivate === 'boolean') summary.isPrivate = isPrivate;
    const defaultBranchRef = (row as { defaultBranchRef?: unknown }).defaultBranchRef;
    if (defaultBranchRef && typeof defaultBranchRef === 'object') {
      summary.defaultBranchRef = defaultBranchRef as GithubCliRepoSummary['defaultBranchRef'];
    }
    const updatedAt = (row as { updatedAt?: unknown }).updatedAt;
    if (typeof updatedAt === 'string' && updatedAt.trim()) summary.updatedAt = updatedAt.trim();
    repos.push(summary);
  }
  return repos;
}

function parseGhRepoCreateStdout(stdout: string, fallbackNameWithOwner: string): {
  nameWithOwner: string;
  url?: string;
} {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return { nameWithOwner: fallbackNameWithOwner };
  }
  try {
    const parsed = JSON.parse(trimmed) as {
      nameWithOwner?: string;
      url?: string;
    };
    if (typeof parsed.nameWithOwner === 'string' && parsed.nameWithOwner.trim()) {
      return {
        nameWithOwner: parsed.nameWithOwner.trim(),
        url: typeof parsed.url === 'string' ? parsed.url.trim() : undefined,
      };
    }
  } catch {
    // gh may print a single URL line
  }
  const urlMatch = trimmed.match(/^https?:\/\/\S+/);
  if (urlMatch) {
    const url = urlMatch[0];
    try {
      const u = new URL(url);
      const parts = u.pathname.replace(/^\//, '').split('/').filter(Boolean);
      if (parts.length >= 2) {
        return { nameWithOwner: `${parts[0]}/${parts[1]}`, url };
      }
    } catch {
      /* ignore */
    }
    return { nameWithOwner: fallbackNameWithOwner, url };
  }
  return { nameWithOwner: fallbackNameWithOwner };
}

export class GithubCliRepoService {
  constructor(private readonly execFile: GhExecFile = defaultExecFile) {}

  async checkPrerequisites(): Promise<
    GithubRepoOnboardingResult<{ prerequisites: GithubCliPrerequisites }>
  > {
    let version: string | undefined;
    try {
      const { stdout } = await this.execFile('gh', ['--version'], {
        timeout: GH_VERSION_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      });
      version = parseGhVersion(stdout);
      if (!version?.toLowerCase().includes('gh')) {
        return {
          ok: true,
          prerequisites: {
            installed: false,
            authenticated: false,
            message:
              'GitHub CLI (gh) did not return a version string. Install from https://cli.github.com/ and ensure it is on PATH.',
          },
        };
      }
    } catch (err: unknown) {
      if (errnoCode(err) === 'ENOENT') {
        return {
          ok: true,
          prerequisites: {
            installed: false,
            authenticated: false,
            message:
              'GitHub CLI (gh) was not found on PATH. Install from https://cli.github.com/ and try again.',
          },
        };
      }
      return {
        ok: true,
        prerequisites: {
          installed: false,
          authenticated: false,
          message: mapGhExecError(err).message,
        },
      };
    }

    try {
      await this.execFile(
        'gh',
        ['auth', 'status', '--hostname', GITHUB_COM_HOSTNAME],
        {
          timeout: GH_AUTH_TIMEOUT_MS,
          windowsHide: true,
          maxBuffer: 1024 * 1024,
        },
      );
      return {
        ok: true,
        prerequisites: {
          installed: true,
          version,
          authenticated: true,
        },
      };
    } catch (err: unknown) {
      if (errnoCode(err) === 'ENOENT') {
        return {
          ok: true,
          prerequisites: {
            installed: false,
            authenticated: false,
            message:
              'GitHub CLI (gh) was not found on PATH. Install from https://cli.github.com/ and try again.',
          },
        };
      }
      const stderr = stderrOf(err).trim();
      return {
        ok: true,
        prerequisites: {
          installed: true,
          version,
          authenticated: false,
          message:
            stderr ||
            'GitHub CLI is not signed in for github.com. Run `gh auth login` and try again.',
        },
      };
    }
  }

  async listRepos(input: GithubRepoListInput = {}): Promise<
    GithubRepoOnboardingResult<{ repos: GithubCliRepoSummary[] }>
  > {
    const prereq = await this.checkPrerequisites();
    if (!prereq.ok) return prereq;
    if (!prereq.prerequisites.installed) {
      return ghFailure(
        'GH_NOT_INSTALLED',
        prereq.prerequisites.message ??
          'GitHub CLI (gh) is not installed or not on PATH.',
      );
    }
    if (!prereq.prerequisites.authenticated) {
      return ghFailure(
        'GH_NOT_AUTHENTICATED',
        prereq.prerequisites.message ??
          'GitHub CLI is not signed in for github.com. Run `gh auth login`.',
      );
    }

    const limit =
      typeof input.limit === 'number' && Number.isFinite(input.limit) && input.limit > 0
        ? Math.min(Math.floor(input.limit), 1000)
        : DEFAULT_REPO_LIST_LIMIT;

    const args: string[] = ['repo', 'list'];
    const owner = input.owner?.trim();
    if (owner) args.push(owner);
    args.push('--json', GH_REPO_LIST_JSON_FIELDS.join(','), '--limit', String(limit));

    try {
      const { stdout } = await this.execFile('gh', args, {
        timeout: GH_EXEC_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: 10 * 1024 * 1024,
      });
      return { ok: true, repos: parseGhRepoListJson(stdout) };
    } catch (err: unknown) {
      return mapGhExecError(err);
    }
  }

  async createRepo(input: GithubRepoCreateInput): Promise<
    GithubRepoOnboardingResult<{ nameWithOwner: string; url?: string }>
  > {
    const slug = normalizeRepoSlug(input.name, input.owner);
    if (typeof slug !== 'string') return slug;

    const prereq = await this.checkPrerequisites();
    if (!prereq.ok) return prereq;
    if (!prereq.prerequisites.installed) {
      return ghFailure(
        'GH_NOT_INSTALLED',
        prereq.prerequisites.message ??
          'GitHub CLI (gh) is not installed or not on PATH.',
      );
    }
    if (!prereq.prerequisites.authenticated) {
      return ghFailure(
        'GH_NOT_AUTHENTICATED',
        prereq.prerequisites.message ??
          'GitHub CLI is not signed in for github.com. Run `gh auth login`.',
      );
    }

    const args = ['repo', 'create', slug, visibilityFlag(input.visibility), '--confirm'];
    const description = input.description?.trim();
    if (description) args.push('--description', description);

    try {
      const { stdout } = await this.execFile('gh', args, {
        timeout: GH_EXEC_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      });
      const created = parseGhRepoCreateStdout(stdout, slug);
      return { ok: true, ...created };
    } catch (err: unknown) {
      if (errnoCode(err) === 'ENOENT') {
        return mapGhExecError(err);
      }
      const stderr = stderrOf(err).trim();
      if (isUnauthenticatedMessage(stderr)) {
        return ghFailure(
          'GH_NOT_AUTHENTICATED',
          'GitHub CLI is not signed in for github.com. Run `gh auth login` and try again.',
        );
      }
      if (isPermissionDeniedMessage(stderr)) {
        return ghFailure(
          'GH_PERMISSION_DENIED',
          stderr || 'GitHub rejected repository creation (insufficient permissions).',
        );
      }
      if (isRepoCreateFailureMessage(stderr)) {
        return ghFailure(
          'GH_REPO_CREATE_FAILED',
          stderr || 'Could not create the GitHub repository.',
        );
      }
      return ghFailure(
        'GH_REPO_CREATE_FAILED',
        stderr || 'Could not create the GitHub repository.',
      );
    }
  }

  async checkCloneDestination(
    destination: string,
  ): Promise<GithubRepoOnboardingResult<{ available: true }>> {
    const dest = destination?.trim();
    if (!dest) {
      return ghFailure('INVALID_INPUT', 'Clone destination path is required');
    }
    const resolved = path.resolve(dest);
    try {
      await fs.access(resolved);
      return ghFailure(
        'CLONE_DESTINATION_EXISTS',
        `Clone destination already exists: ${resolved}. Choose a different path or use the local-folder flow to attach it.`,
      );
    } catch (err: unknown) {
      if (errnoCode(err) === 'ENOENT') {
        return { ok: true, available: true };
      }
      return ghFailure(
        'GH_COMMAND_FAILED',
        err instanceof Error ? err.message : 'Could not check clone destination',
      );
    }
  }

  async cloneRepo(input: GithubRepoCloneInput): Promise<
    GithubRepoOnboardingResult<{ destination: string; nameWithOwner: string }>
  > {
    const repo = input.repo?.trim();
    if (!repo || !repo.includes('/')) {
      return ghFailure('INVALID_INPUT', 'Repository must be `owner/name`');
    }
    const dest = input.destination?.trim();
    if (!dest) {
      return ghFailure('INVALID_INPUT', 'Clone destination path is required');
    }
    const resolvedDest = path.resolve(dest);

    const destCheck = await this.checkCloneDestination(resolvedDest);
    if (!destCheck.ok) return destCheck;

    const prereq = await this.checkPrerequisites();
    if (!prereq.ok) return prereq;
    if (!prereq.prerequisites.installed) {
      return ghFailure(
        'GH_NOT_INSTALLED',
        prereq.prerequisites.message ??
          'GitHub CLI (gh) is not installed or not on PATH.',
      );
    }
    if (!prereq.prerequisites.authenticated) {
      return ghFailure(
        'GH_NOT_AUTHENTICATED',
        prereq.prerequisites.message ??
          'GitHub CLI is not signed in for github.com. Run `gh auth login`.',
      );
    }

    try {
      await this.execFile('gh', ['repo', 'clone', repo, resolvedDest], {
        timeout: GH_EXEC_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: 10 * 1024 * 1024,
      });
      return { ok: true, destination: resolvedDest, nameWithOwner: repo };
    } catch (err: unknown) {
      if (errnoCode(err) === 'ENOENT') {
        return mapGhExecError(err);
      }
      const stderr = stderrOf(err).trim();
      if (isUnauthenticatedMessage(stderr)) {
        return ghFailure(
          'GH_NOT_AUTHENTICATED',
          'GitHub CLI is not signed in for github.com. Run `gh auth login` and try again.',
        );
      }
      if (
        isCloneFailureMessage(stderr) ||
        stderr.toLowerCase().includes('already exists')
      ) {
        return ghFailure(
          'CLONE_DESTINATION_EXISTS',
          stderr ||
            `Clone destination already exists: ${resolvedDest}. Choose a different path.`,
        );
      }
      return ghFailure(
        'GH_REPO_CLONE_FAILED',
        stderr || `Could not clone ${repo}.`,
      );
    }
  }
}

/** Shared main-process service instance for IPC and automation. */
export const githubCliRepoService = new GithubCliRepoService();
