import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assignRepoIdsForCreate,
  normalizeTeamInviteEmails,
  prepareLocalProjectCreateInput,
  PROJECT_NAME_MAX_LENGTH,
  projectCreateErrorMessage,
  validateLocalProjectCreateInput,
  validateProjectName,
} from './projectCreate';
import { deriveStablePrimaryRepoIdForProject } from './repoIdentity';
import { stableLocalProjectIdForRoot } from './repoIdentity';

describe('validateProjectName', () => {
  it('rejects empty and whitespace-only names', () => {
    expect(validateProjectName('')).toBe('NAME_REQUIRED');
    expect(validateProjectName('   ')).toBe('NAME_REQUIRED');
  });

  it('trims and accepts valid names', () => {
    const r = validateProjectName('  Payments  ');
    expect(r).toEqual({ ok: true, name: 'Payments' });
  });

  it('rejects names over the max length', () => {
    expect(validateProjectName('x'.repeat(PROJECT_NAME_MAX_LENGTH + 1))).toBe('NAME_TOO_LONG');
  });
});

describe('assignRepoIdsForCreate', () => {
  const projectId = 'proj-abc';

  it('orders primary first and assigns stable ids', () => {
    const a = path.resolve('/tmp/repo-a');
    const b = path.resolve('/tmp/repo-b');
    const primaryId = deriveStablePrimaryRepoIdForProject({ projectId, rootPath: a });
    const out = assignRepoIdsForCreate({
      projectId,
      repos: [
        { rootPath: b, name: 'B' },
        { rootPath: a, name: 'A' },
      ],
      primaryRepoId: primaryId,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.primaryRepoId).toBe(primaryId);
    expect(out.repos).toHaveLength(2);
    expect(out.repos[0].rootPath).toBe(a);
    expect(out.repos[0].id).toBe(primaryId);
    expect(out.repos[1].rootPath).toBe(b);
    expect(out.repos[1].id).not.toBe(primaryId);
  });

  it('defaults primary when exactly one repo', () => {
    const root = path.resolve('/tmp/solo');
    const out = assignRepoIdsForCreate({
      projectId,
      repos: [{ rootPath: root }],
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.repos).toHaveLength(1);
    expect(out.repos[0].id).toBe(
      deriveStablePrimaryRepoIdForProject({ projectId, rootPath: root }),
    );
  });

  it('requires primary when multiple repos', () => {
    const out = assignRepoIdsForCreate({
      projectId,
      repos: [{ rootPath: '/tmp/a' }, { rootPath: '/tmp/b' }],
    });
    expect(out).toEqual({ ok: false, error: 'PRIMARY_REPO_REQUIRED' });
  });
});

describe('validateLocalProjectCreateInput', () => {
  it('creates zero-repo projects with a random project id', async () => {
    const out = await validateLocalProjectCreateInput(
      { name: 'Planning only', repos: [], syncMode: 'local-only' },
      { isGitRepo: async () => true },
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.repos).toEqual([]);
    expect(out.value.name).toBe('Planning only');
    expect(out.value.projectId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('rejects duplicate repo paths', async () => {
    const root = path.resolve('/tmp/dup');
    const out = await validateLocalProjectCreateInput(
      {
        name: 'Dup',
        syncMode: 'local-only',
        repos: [{ rootPath: root }, { rootPath: root }],
      },
      { isGitRepo: async () => true },
    );
    expect(out).toEqual({ ok: false, error: 'DUPLICATE_REPO_PATH' });
  });

  it('uses stable project id from the primary repo root', async () => {
    const root = path.resolve('/tmp/primary-root');
    const out = await validateLocalProjectCreateInput(
      {
        name: 'With repo',
        syncMode: 'local-only',
        repos: [{ rootPath: root }],
      },
      { isGitRepo: async () => true },
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.projectId).toBe(stableLocalProjectIdForRoot(root));
    expect(out.value.repos).toHaveLength(1);
  });

  it('rejects non-git directories', async () => {
    const out = await validateLocalProjectCreateInput(
      {
        name: 'Bad',
        syncMode: 'local-only',
        repos: [{ rootPath: '/tmp/not-git' }],
      },
      { isGitRepo: async () => false },
    );
    expect(out).toEqual({ ok: false, error: 'NOT_GIT_REPO' });
  });
});

describe('prepareLocalProjectCreateInput', () => {
  it('builds local-only payload with primaryRepoId when repos exist', () => {
    const root = path.resolve('/tmp/wizard-primary');
    const input = prepareLocalProjectCreateInput({
      name: 'Wizard',
      repos: [{ rootPath: root }],
    });
    expect(input.syncMode).toBe('local-only');
    expect(input.primaryRepoId).toBe(
      deriveStablePrimaryRepoIdForProject({
        projectId: stableLocalProjectIdForRoot(root),
        rootPath: root,
      }),
    );
  });
});

describe('normalizeTeamInviteEmails', () => {
  it('dedupes case-insensitively', () => {
    expect(normalizeTeamInviteEmails(['A@b.com', 'a@b.com'])).toEqual({
      ok: true,
      emails: ['a@b.com'],
    });
  });
});

describe('projectCreateErrorMessage', () => {
  it('includes CREATE_FAILED detail when provided', () => {
    expect(projectCreateErrorMessage('CREATE_FAILED', 'disk full')).toBe('disk full');
  });
});
