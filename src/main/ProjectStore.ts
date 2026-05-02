import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { Agent, LocalProject, RepoConfig } from '../types';

const DEFAULT_AGENT: Agent = 'claude-code';
const DEFAULT_BASE_BRANCH = 'main';

const MCP_JSON = `{
  "mcpServers": {
    "flux": {
      "type": "sse",
      "url": "http://localhost:47432/sse"
    }
  }
}
`;

interface ConfigFile {
  id: string;
  name: string;
  rootPath: string;
  addedAt: string;
  planningAgent: Agent;
  defaultTaskAgent: Agent;
  autoStartSessionOnInProgress: boolean;
  autoStartWhenUnblocked: boolean;
  autoCleanupWorkspaceWhenDone: boolean;
  repos: RepoConfig[];
}

function stableProjectIdForPath(rootPath: string): string {
  return createHash('sha256').update(path.resolve(rootPath)).digest('hex');
}

function errnoCode(err: unknown): string | undefined {
  return err && typeof err === 'object' && 'code' in err
    ? (err as NodeJS.ErrnoException).code
    : undefined;
}

function configToLocalProject(c: ConfigFile): LocalProject {
  return {
    id: c.id,
    kind: 'local',
    name: c.name,
    rootPath: c.rootPath,
    addedAt: c.addedAt,
    planningAgent: c.planningAgent ?? DEFAULT_AGENT,
    defaultTaskAgent: c.defaultTaskAgent ?? DEFAULT_AGENT,
    autoStartSessionOnInProgress: c.autoStartSessionOnInProgress === true,
    autoStartWhenUnblocked: c.autoStartWhenUnblocked === true,
    autoCleanupWorkspaceWhenDone: c.autoCleanupWorkspaceWhenDone === true,
    repos: c.repos,
  };
}

function parseRepoConfig(value: unknown): RepoConfig | null {
  if (!value || typeof value !== 'object') return null;
  const r = value as Partial<RepoConfig>;
  if (typeof r.rootPath !== 'string') return null;
  return {
    rootPath: r.rootPath,
    baseBranch: typeof r.baseBranch === 'string' && r.baseBranch.length > 0
      ? r.baseBranch
      : DEFAULT_BASE_BRANCH,
    setupScript: typeof r.setupScript === 'string' ? r.setupScript : undefined,
    env: typeof r.env === 'string' ? r.env : undefined,
  };
}

function parseConfig(raw: string): ConfigFile | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const p = parsed as Partial<ConfigFile> & { repos?: unknown };
  if (
    typeof p.id !== 'string' ||
    typeof p.name !== 'string' ||
    typeof p.rootPath !== 'string' ||
    typeof p.addedAt !== 'string'
  ) {
    return null;
  }
  const repos: RepoConfig[] = Array.isArray(p.repos)
    ? p.repos.map(parseRepoConfig).filter((r): r is RepoConfig => r !== null)
    : [];
  if (repos.length === 0) {
    repos.push({ rootPath: p.rootPath, baseBranch: DEFAULT_BASE_BRANCH });
  } else if (!repos.some((r) => r.rootPath === p.rootPath)) {
    repos.unshift({ rootPath: p.rootPath, baseBranch: DEFAULT_BASE_BRANCH });
  }
  return {
    id: p.id,
    name: p.name,
    rootPath: p.rootPath,
    addedAt: p.addedAt,
    planningAgent:
      p.planningAgent === 'claude-code' ||
      p.planningAgent === 'codex' ||
      p.planningAgent === 'cursor'
        ? p.planningAgent
        : DEFAULT_AGENT,
    defaultTaskAgent:
      p.defaultTaskAgent === 'claude-code' ||
      p.defaultTaskAgent === 'codex' ||
      p.defaultTaskAgent === 'cursor'
        ? p.defaultTaskAgent
        : DEFAULT_AGENT,
    autoStartSessionOnInProgress: p.autoStartSessionOnInProgress === true,
    autoStartWhenUnblocked: p.autoStartWhenUnblocked === true,
    autoCleanupWorkspaceWhenDone:
      p.autoCleanupWorkspaceWhenDone === true ||
      (p as { autoDeleteTaskWhenDone?: boolean }).autoDeleteTaskWhenDone === true,
    repos,
  };
}

async function atomicWriteFile(filePath: string, payload: string): Promise<void> {
  const tmpPath = `${filePath}.tmp`;
  await fs.writeFile(tmpPath, payload, 'utf8');
  if (process.platform === 'win32') {
    try {
      await fs.unlink(filePath);
    } catch (e: unknown) {
      if (errnoCode(e) !== 'ENOENT') throw e;
    }
  }
  await fs.rename(tmpPath, filePath);
}

/** Shared body for \`planning/CLAUDE.md\` and \`planning/AGENTS.md\` (same text, two filenames). */
function planningAssistantMarkdown(projectName: string, rootPath: string): string {
  return `# Planning workspace — ${projectName}

This directory is the Flux **planning** workspace for \`${projectName}\`. Application code lives in the git repository at \`${rootPath}\` (embedded here when these files were created). The **canonical** path for reading code is the \`rootPath\` field returned by \`flux__get_project_info\` — prefer that after you call the tool. Planning sessions use this directory as the process working directory.

## Your role

You are a planning assistant. Help the developer think through features, maintain documentation in this directory, and manage tasks on the Flux board.

## Turn-taking

- Do **not** start a substantive planning pass, repository exploration, or tool use until the user has asked a question or given a concrete task.
- **After they do**, gather context **before** you give substantive answers, update planning docs, or call Flux task tools, unless the request is purely meta and needs no repository or board context. Follow this order:
  1. Call \`flux__get_project_info\` once (unless you already have the current \`rootPath\` and project name from a call in this turn). Use the returned \`rootPath\` as the application codebase location.
  2. Read planning documents in **this** directory (\`vision.md\`, \`architecture.md\`, sprint files, etc.).
  3. Explore the repository under that \`rootPath\` as needed for the user’s question.
  4. Only then respond, revise planning docs, list tasks if relevant, or create/update tasks so titles and descriptions match reality.

## Available tools

You have access to the following Flux tools for task management:
- \`flux__list_tasks\` — list all current tasks on the board (each task includes \`sourceBranch\` / \`createSourceBranchIfMissing\` when set)
- \`flux__create_task\` — create a new task with title, description, and agent; optional \`blockedByTaskIds\`, optional \`labels\` (feature tags; normalized: trim, empty dropped, case-insensitive dedupe), optional \`assigneeEmail\` (cloud projects only; use \`flux__list_members\` to find member emails), optional \`sourceBranch\` (git short branch name; defaults like the app UI when omitted), and optional \`createSourceBranchIfMissing\` (when \`true\`, Flux may create a missing \`sourceBranch\` from the project default on first session start)
- \`flux__start_task\` — move a task to the **In progress** column (\`status: "in-progress"\`); use when the user wants to pull work from backlog into active development on the board
- \`flux__update_task\` — update an existing task's title, description, status, agent, \`blockedByTaskIds\`, \`labels\`, \`assigneeEmail\`, \`unassignAssignee\`, and/or source-branch fields (any column transition; passing \`blockedByTaskIds: []\` clears dependencies; \`labels: []\` clears tags). Use \`assigneeEmail\` to assign/reassign by member email, or \`unassignAssignee: true\` to remove the assignee. Branch edits fail safely if a session or worktree already exists
- \`flux__delete_task\` — permanently remove a task from the board for this project; **only** after the user clearly asked to delete it, then call with \`confirm: true\`. If intent is ambiguous, ask once before deleting
- \`flux__get_project_info\` — returns project \`name\`, canonical \`rootPath\` (read application code here), \`taskCounts\`, and \`defaultBranchShort\` when git discovery succeeds (see \`branchDiscoveryError\` if not)
- \`flux__list_repo_branches\` — full local + origin remote branch lists, default branch, and optional \`classifyBranch\` to see whether a name exists or is missing-but-creatable before batch-creating tasks
- \`flux__list_members\` — cloud projects only: team roster (\`email\`, \`displayName\`, \`role\`) for assignee lookup; local projects return an empty list with a note

Board relationship: new tasks land in **Backlog**. \`flux__start_task\` is the usual way to mark work as actively in flight (\`in-progress\`). Use \`flux__update_task\` for other status changes (e.g. **Needs input**, **Done**) or edits to title/description/agent.

**Task branches:** When the user names a base branch (e.g. “do this on \`feature/auth\`”), pass that as \`sourceBranch\` on **each** subtask you create so work stays on their branch. Use \`createSourceBranchIfMissing: true\` only when they want a new branch created on first start. If they did not specify a branch, omit \`sourceBranch\` so Flux uses the project default.

**Task dependencies:** \`blockedByTaskIds\` means “this task is blocked until these prerequisite tasks are addressed.” Use \`flux__list_tasks\` to get ids. Only reference tasks in the current project; invalid or cyclic graphs are rejected (local and cloud).

**Team (cloud) projects:** the Flux task tools route through the running Flux app for cloud projects. The app must be **open and signed in** for tools to work; if you see \`Sign in to Flux to use cloud project tools\` or \`Open the Flux app to enable cloud project tools\`, ask the user to bring Flux to the foreground and try again.

## Files in this directory

Maintain these files as living documents:
- \`vision.md\` — long-term project goals and direction
- \`architecture.md\` — technical decisions and system design
- \`YYYY-MM-sprint.md\` — time-boxed planning (create as needed)
- \`CLAUDE.md\` and \`AGENTS.md\` — agent instructions for this workspace (keep them aligned if you edit one)

## Guidelines

- Do not create, update, start, or delete tasks until the context pass above is done (when the question touches the codebase or board).
- Update planning documents when decisions are made
- Create tasks for concrete, actionable work items
- Keep vision.md and architecture.md up to date as the project evolves
`;
}

/** Creates \`CLAUDE.md\` and/or \`AGENTS.md\` only when missing (does not overwrite user edits). */
export async function ensurePlanningAssistantMarkdownFiles(
  planningDir: string,
  projectName: string,
  rootPath: string,
): Promise<void> {
  const resolvedRoot = path.resolve(rootPath);
  const md = planningAssistantMarkdown(projectName, resolvedRoot);
  for (const fileName of ['CLAUDE.md', 'AGENTS.md'] as const) {
    const filePath = path.join(planningDir, fileName);
    try {
      await fs.access(filePath);
    } catch (err: unknown) {
      if (errnoCode(err) === 'ENOENT') {
        await fs.writeFile(filePath, md, 'utf8');
      } else {
        throw err;
      }
    }
  }
}

export class ProjectStore {
  private projectDir: string | null = null;
  private project: LocalProject | null = null;

  constructor(private fluxBaseDir: string) {}

  async init(projectDir: string): Promise<void> {
    const configPath = path.join(projectDir, 'config.json');
    const raw = await fs.readFile(configPath, 'utf8');
    const parsed = parseConfig(raw);
    if (!parsed) {
      throw new Error(`Invalid config.json at ${configPath}`);
    }
    this.projectDir = projectDir;
    this.project = configToLocalProject(parsed);
  }

  get(): LocalProject | null {
    return this.project;
  }

  getProjectDir(): string | null {
    return this.projectDir;
  }

  /** Updates `planningAgent` in config.json and the in-memory active project. */
  async setPlanningAgent(agent: Agent): Promise<void> {
    if (!this.projectDir || !this.project) {
      throw new Error('ProjectStore: no active local project');
    }
    if (agent !== 'claude-code' && agent !== 'codex' && agent !== 'cursor') {
      throw new Error('ProjectStore: invalid planning agent');
    }
    await this.mutateConfig((c) => ({ ...c, planningAgent: agent }));
  }

  /** Updates `defaultTaskAgent` in config.json and the in-memory active project. */
  async setDefaultTaskAgent(agent: Agent): Promise<void> {
    if (!this.projectDir || !this.project) {
      throw new Error('ProjectStore: no active local project');
    }
    if (agent !== 'claude-code' && agent !== 'codex' && agent !== 'cursor') {
      throw new Error('ProjectStore: invalid default task agent');
    }
    await this.mutateConfig((c) => ({ ...c, defaultTaskAgent: agent }));
  }

  /**
   * Returns repos[] for the project living at `projectDir` by reading config.json.
   * Works for both local projects and cloud-project bindings (both materialise
   * a local config via `ensureLayoutForRoot` / `create`).
   */
  async getReposAt(projectDir: string): Promise<RepoConfig[]> {
    const configPath = path.join(projectDir, 'config.json');
    const raw = await fs.readFile(configPath, 'utf8');
    const parsed = parseConfig(raw);
    if (!parsed) throw new Error(`Invalid config.json at ${configPath}`);
    return parsed.repos;
  }

  /**
   * Persist a patch to the repo identified by `rootPath` inside `projectDir`.
   * Updates the in-memory active project only when `projectDir` matches.
   */
  async updateRepoAt(
    projectDir: string,
    rootPath: string,
    patch: Partial<Pick<RepoConfig, 'baseBranch' | 'setupScript' | 'env'>>,
  ): Promise<RepoConfig[]> {
    const configPath = path.join(projectDir, 'config.json');
    const raw = await fs.readFile(configPath, 'utf8');
    const parsed = parseConfig(raw);
    if (!parsed) throw new Error(`Invalid config.json at ${configPath}`);
    const repos = parsed.repos.map((r) => {
      if (r.rootPath !== rootPath) return r;
      const next: RepoConfig = { ...r };
      if (patch.baseBranch !== undefined) {
        const trimmed = patch.baseBranch.trim();
        next.baseBranch = trimmed.length > 0 ? trimmed : DEFAULT_BASE_BRANCH;
      }
      if (patch.setupScript !== undefined) {
        next.setupScript =
          patch.setupScript.length > 0 ? patch.setupScript : undefined;
      }
      if (patch.env !== undefined) {
        next.env = patch.env.length > 0 ? patch.env : undefined;
      }
      return next;
    });
    const next: ConfigFile = { ...parsed, repos };
    await atomicWriteFile(configPath, `${JSON.stringify(next, null, 2)}\n`);
    if (this.projectDir === projectDir && this.project) {
      this.project = configToLocalProject(next);
    }
    return repos;
  }

  async getAutoStartSessionOnInProgressAt(projectDir: string): Promise<boolean> {
    const configPath = path.join(projectDir, 'config.json');
    const raw = await fs.readFile(configPath, 'utf8');
    const parsed = parseConfig(raw);
    if (!parsed) throw new Error(`Invalid config.json at ${configPath}`);
    return parsed.autoStartSessionOnInProgress;
  }

  async setAutoStartSessionOnInProgressAt(
    projectDir: string,
    enabled: boolean,
  ): Promise<boolean> {
    const configPath = path.join(projectDir, 'config.json');
    const raw = await fs.readFile(configPath, 'utf8');
    const parsed = parseConfig(raw);
    if (!parsed) throw new Error(`Invalid config.json at ${configPath}`);
    const next: ConfigFile = {
      ...parsed,
      autoStartSessionOnInProgress: enabled === true,
    };
    await atomicWriteFile(configPath, `${JSON.stringify(next, null, 2)}\n`);
    if (this.projectDir === projectDir && this.project) {
      this.project = configToLocalProject(next);
    }
    return next.autoStartSessionOnInProgress;
  }

  async getAutoStartWhenUnblockedAt(projectDir: string): Promise<boolean> {
    const configPath = path.join(projectDir, 'config.json');
    const raw = await fs.readFile(configPath, 'utf8');
    const parsed = parseConfig(raw);
    if (!parsed) throw new Error(`Invalid config.json at ${configPath}`);
    return parsed.autoStartWhenUnblocked === true;
  }

  async setAutoStartWhenUnblockedAt(
    projectDir: string,
    enabled: boolean,
  ): Promise<boolean> {
    const configPath = path.join(projectDir, 'config.json');
    const raw = await fs.readFile(configPath, 'utf8');
    const parsed = parseConfig(raw);
    if (!parsed) throw new Error(`Invalid config.json at ${configPath}`);
    const next: ConfigFile = {
      ...parsed,
      autoStartWhenUnblocked: enabled === true,
    };
    await atomicWriteFile(configPath, `${JSON.stringify(next, null, 2)}\n`);
    if (this.projectDir === projectDir && this.project) {
      this.project = configToLocalProject(next);
    }
    return next.autoStartWhenUnblocked;
  }

  async getAutoCleanupWorkspaceWhenDoneAt(projectDir: string): Promise<boolean> {
    const configPath = path.join(projectDir, 'config.json');
    const raw = await fs.readFile(configPath, 'utf8');
    const parsed = parseConfig(raw);
    if (!parsed) throw new Error(`Invalid config.json at ${configPath}`);
    return parsed.autoCleanupWorkspaceWhenDone === true;
  }

  async setAutoCleanupWorkspaceWhenDoneAt(
    projectDir: string,
    enabled: boolean,
  ): Promise<boolean> {
    const configPath = path.join(projectDir, 'config.json');
    const raw = await fs.readFile(configPath, 'utf8');
    const parsed = parseConfig(raw);
    if (!parsed) throw new Error(`Invalid config.json at ${configPath}`);
    const next: ConfigFile = {
      ...parsed,
      autoCleanupWorkspaceWhenDone: enabled === true,
    };
    await atomicWriteFile(configPath, `${JSON.stringify(next, null, 2)}\n`);
    if (this.projectDir === projectDir && this.project) {
      this.project = configToLocalProject(next);
    }
    return next.autoCleanupWorkspaceWhenDone;
  }

  private async mutateConfig(
    fn: (c: ConfigFile) => ConfigFile,
  ): Promise<void> {
    if (!this.projectDir || !this.project) {
      throw new Error('ProjectStore: no active local project');
    }
    const configPath = path.join(this.projectDir, 'config.json');
    const raw = await fs.readFile(configPath, 'utf8');
    const parsed = parseConfig(raw);
    if (!parsed) {
      throw new Error(`Invalid config.json at ${configPath}`);
    }
    const next = fn(parsed);
    await atomicWriteFile(configPath, `${JSON.stringify(next, null, 2)}\n`);
    this.project = configToLocalProject(next);
  }

  /**
   * Ensures ~/.flux/<basename>/ layout and config exist for a repo root.
   * Does not update the store's active project — use for cloud worktrees.
   */
  async ensureLayoutForRoot(rootPath: string): Promise<{ projectDir: string; project: LocalProject }> {
    return this.materialiseProjectDir(rootPath);
  }

  async create(rootPath: string): Promise<{ project: LocalProject; projectDir: string }> {
    const { projectDir, project } = await this.materialiseProjectDir(rootPath);
    this.projectDir = projectDir;
    this.project = project;
    return { project, projectDir };
  }

  private async materialiseProjectDir(
    rootPath: string,
  ): Promise<{ projectDir: string; project: LocalProject }> {
    const resolvedRoot = path.resolve(rootPath);
    const projectName = path.basename(resolvedRoot);
    const projectDir = path.join(this.fluxBaseDir, projectName);

    await fs.mkdir(projectDir, { recursive: true });
    await fs.mkdir(path.join(projectDir, 'planning'), { recursive: true });
    await fs.mkdir(path.join(projectDir, 'worktrees'), { recursive: true });

    const configPath = path.join(projectDir, 'config.json');
    let config: ConfigFile | null = null;
    try {
      const existingRaw = await fs.readFile(configPath, 'utf8');
      config = parseConfig(existingRaw);
    } catch (err: unknown) {
      if (errnoCode(err) !== 'ENOENT') throw err;
    }

    const now = new Date().toISOString();
    if (!config) {
      config = {
        id: stableProjectIdForPath(resolvedRoot),
        name: projectName,
        rootPath: resolvedRoot,
        addedAt: now,
        planningAgent: DEFAULT_AGENT,
        defaultTaskAgent: DEFAULT_AGENT,
        autoStartSessionOnInProgress: false,
        autoStartWhenUnblocked: false,
        autoCleanupWorkspaceWhenDone: false,
        repos: [{ rootPath: resolvedRoot, baseBranch: DEFAULT_BASE_BRANCH }],
      };
    } else {
      const previousRootPath = config.rootPath;
      const repos = config.repos.map((r) =>
        r.rootPath === previousRootPath ? { ...r, rootPath: resolvedRoot } : r,
      );
      if (!repos.some((r) => r.rootPath === resolvedRoot)) {
        repos.unshift({ rootPath: resolvedRoot, baseBranch: DEFAULT_BASE_BRANCH });
      }
      config = {
        ...config,
        rootPath: resolvedRoot,
        name: projectName,
        repos,
      };
    }

    await atomicWriteFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

    const mcpPath = path.join(projectDir, 'mcp.json');
    try {
      await fs.access(mcpPath);
    } catch (err: unknown) {
      if (errnoCode(err) === 'ENOENT') {
        await atomicWriteFile(mcpPath, MCP_JSON);
      } else {
        throw err;
      }
    }

    await ensurePlanningAssistantMarkdownFiles(
      path.join(projectDir, 'planning'),
      projectName,
      resolvedRoot,
    );

    return { projectDir, project: configToLocalProject(config) };
  }

  /** All valid ~/.flux/<name>/ projects (for the welcome list). */
  async listDiscovered(): Promise<LocalProject[]> {
    const out: LocalProject[] = [];
    let dirents;
    try {
      dirents = await fs.readdir(this.fluxBaseDir, { withFileTypes: true });
    } catch {
      return [];
    }
    for (const ent of dirents) {
      if (!ent.isDirectory()) continue;
      const projectDir = path.join(this.fluxBaseDir, ent.name);
      try {
        const raw = await fs.readFile(path.join(projectDir, 'config.json'), 'utf8');
        const c = parseConfig(raw);
        if (!c) continue;
        out.push(configToLocalProject(c));
      } catch {
        continue;
      }
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }

  async findProjectDirById(id: string): Promise<string | null> {
    let dirents;
    try {
      dirents = await fs.readdir(this.fluxBaseDir, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const ent of dirents) {
      if (!ent.isDirectory()) continue;
      const projectDir = path.join(this.fluxBaseDir, ent.name);
      try {
        const raw = await fs.readFile(path.join(projectDir, 'config.json'), 'utf8');
        const c = parseConfig(raw);
        if (c?.id === id) return projectDir;
      } catch {
        continue;
      }
    }
    return null;
  }

  async clear(): Promise<void> {
    this.project = null;
    this.projectDir = null;
  }
}
