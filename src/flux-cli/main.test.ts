import { describe, expect, it, vi, afterEach } from 'vitest';
import { EXIT_ERROR, EXIT_OK, EXIT_PROJECT_OR_AUTH, EXIT_USAGE, runFluxCli } from './main';

describe('runFluxCli', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns usage exit for unknown command', async () => {
    const code = await runFluxCli(['nope']);
    expect(code).toBe(EXIT_USAGE);
  });

  it('returns error when bridge config is missing', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const code = await runFluxCli(['project', 'info', '--json']);
    expect(code).toBe(EXIT_ERROR);
  });

  it('returns project/auth exit for mismatch response', async () => {
    process.env.FLUX_AUTOMATION_URL = 'http://127.0.0.1:9';
    process.env.FLUX_AUTOMATION_TOKEN = 'tok';
    process.env.FLUX_AUTOMATION_EXPECTED_ACTIVE_KEY = JSON.stringify({
      kind: 'local',
      id: 'p1',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        status: 409,
        json: async () => ({
          ok: false,
          error: 'Active project does not match this planning shell',
          code: 'PROJECT_KIND_MISMATCH',
        }),
      })),
    );
    const code = await runFluxCli(['project', 'info', '--json']);
    delete process.env.FLUX_AUTOMATION_URL;
    delete process.env.FLUX_AUTOMATION_TOKEN;
    delete process.env.FLUX_AUTOMATION_EXPECTED_ACTIVE_KEY;
    expect(code).toBe(EXIT_PROJECT_OR_AUTH);
  });

  it('returns ok on successful invoke', async () => {
    process.env.FLUX_AUTOMATION_URL = 'http://127.0.0.1:9';
    process.env.FLUX_AUTOMATION_TOKEN = 'tok';
    process.env.FLUX_AUTOMATION_EXPECTED_ACTIVE_KEY = JSON.stringify({
      kind: 'local',
      id: 'p1',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        status: 200,
        json: async () => ({ ok: true, data: { name: 'Demo' } }),
      })),
    );
    const code = await runFluxCli(['project', 'info', '--json']);
    delete process.env.FLUX_AUTOMATION_URL;
    delete process.env.FLUX_AUTOMATION_TOKEN;
    delete process.env.FLUX_AUTOMATION_EXPECTED_ACTIVE_KEY;
    expect(code).toBe(EXIT_OK);
  });

  it('sends structured task create payload for repo, branch, labels, and dependencies', async () => {
    process.env.FLUX_AUTOMATION_URL = 'http://127.0.0.1:9';
    process.env.FLUX_AUTOMATION_TOKEN = 'tok';
    process.env.FLUX_AUTOMATION_EXPECTED_ACTIVE_KEY = JSON.stringify({
      kind: 'local',
      id: 'p1',
    });
    const fetchMock = vi.fn(async () => ({
      status: 200,
      json: async () => ({ ok: true, data: { id: 't1' } }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const code = await runFluxCli([
      'tasks',
      'create',
      '--json',
      '--title',
      'Task',
      '--repo-id',
      'api',
      '--source-branch',
      'feature/api',
      '--label',
      'mcp-to-cli',
      '--depends-on-task-id',
      'parent',
    ]);

    delete process.env.FLUX_AUTOMATION_URL;
    delete process.env.FLUX_AUTOMATION_TOKEN;
    delete process.env.FLUX_AUTOMATION_EXPECTED_ACTIVE_KEY;
    expect(code).toBe(EXIT_OK);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
      op: string;
      payload: Record<string, unknown>;
    };
    expect(body.op).toBe('tasks.create');
    expect(body.payload).toMatchObject({
      title: 'Task',
      repoId: 'api',
      sourceBranch: 'feature/api',
      labels: ['mcp-to-cli'],
      blockedByTaskIds: ['parent'],
    });
  });

  it('sends attachedPlanningDocs on task create and update', async () => {
    process.env.FLUX_AUTOMATION_URL = 'http://127.0.0.1:9';
    process.env.FLUX_AUTOMATION_TOKEN = 'tok';
    process.env.FLUX_AUTOMATION_EXPECTED_ACTIVE_KEY = JSON.stringify({
      kind: 'local',
      id: 'p1',
    });
    const fetchMock = vi.fn(async () => ({
      status: 200,
      json: async () => ({ ok: true, data: { id: 't1' } }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const createCode = await runFluxCli([
      'tasks',
      'create',
      '--json',
      '--title',
      'Task',
      '--attach-doc',
      'docs/plan.md',
    ]);
    expect(createCode).toBe(EXIT_OK);
    const createBody = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
      op: string;
      payload: Record<string, unknown>;
    };
    expect(createBody.op).toBe('tasks.create');
    expect(createBody.payload).toMatchObject({
      title: 'Task',
      attachedPlanningDocs: [{ relativePath: 'docs/plan.md' }],
    });

    fetchMock.mockClear();
    const updateCode = await runFluxCli([
      'tasks',
      'update',
      '--json',
      '--id',
      't1',
      '--clear-attached-docs',
    ]);
    expect(updateCode).toBe(EXIT_OK);
    const updateBody = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
      op: string;
      payload: Record<string, unknown>;
    };
    expect(updateBody.op).toBe('tasks.update');
    expect(updateBody.payload).toMatchObject({
      id: 't1',
      attachedPlanningDocs: null,
    });

    delete process.env.FLUX_AUTOMATION_URL;
    delete process.env.FLUX_AUTOMATION_TOKEN;
    delete process.env.FLUX_AUTOMATION_EXPECTED_ACTIVE_KEY;
  });
});
