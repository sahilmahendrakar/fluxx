import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type {
  Agent,
  AgentSessionModelDefaults,
  AgentSpawnDefaultsPatch,
  LocalProject,
  RepoConfig,
  RepoSettingsPatch,
} from '../types';
import {
  deriveRepoIdForRootPath,
  deriveStablePrimaryRepoIdForProject,
} from '../repoIdentity';

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
  planningModels?: AgentSessionModelDefaults;
  planningAgentYolo?: boolean;
  taskDefaultModels?: AgentSessionModelDefaults;
  defaultTaskAgentYolo?: boolean;
  autoStartSessionOnInProgress: boolean;
  autoStartWhenUnblocked: boolean;
  autoCleanupWorkspaceWhenDone: boolean;
  autoMarkDoneWhenPrMerged: boolean;
  autoMoveToReviewWhenPrOpen: boolean;
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

async function assertGitRepoRoot(rootPath: string): Promise<void> {
  await fs.access(path.join(path.resolve(rootPath), '.git'));
}

function parseAgentSessionModelDefaultsField(raw: unknown): AgentSessionModelDefaults | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const out: AgentSessionModelDefaults = {};
  if (typeof o['claude-code'] === 'string') {
    out['claude-code'] = o['claude-code'];
  }
  if (typeof o.cursor === 'string') {
    out.cursor = o.cursor;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function configToLocalProject(c: ConfigFile): LocalProject {
  const lp: LocalProject = {
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
    autoMarkDoneWhenPrMerged: c.autoMarkDoneWhenPrMerged === true,
    autoMoveToReviewWhenPrOpen: c.autoMoveToReviewWhenPrOpen === true,
    repos: c.repos,
  };
  if (c.planningModels && Object.keys(c.planningModels).length > 0) {
    lp.planningModels = { ...c.planningModels };
  }
  if (c.planningAgentYolo === true) {
    lp.planningAgentYolo = true;
  }
  if (c.taskDefaultModels && Object.keys(c.taskDefaultModels).length > 0) {
    lp.taskDefaultModels = { ...c.taskDefaultModels };
  }
  if (c.defaultTaskAgentYolo === true) {
    lp.defaultTaskAgentYolo = true;
  }
  return lp;
}

/** Parses a single `repos[]` entry; `id`/`name` may be filled later by `backfillRepoIdentities`. */
type ParsedRepoConfig = Omit<RepoConfig, 'id'> & { id?: string };

function parseRepoConfig(value: unknown): ParsedRepoConfig | null {
  if (!value || typeof value !== 'object') return null;
  const r = value as Partial<RepoConfig>;
  if (typeof r.rootPath !== 'string') return null;
  return {
    ...(typeof r.id === 'string' && r.id.length > 0 ? { id: r.id } : {}),
    ...(typeof r.name === 'string' && r.name.length > 0 ? { name: r.name } : {}),
    rootPath: r.rootPath,
    baseBranch: typeof r.baseBranch === 'string' && r.baseBranch.length > 0
      ? r.baseBranch
      : DEFAULT_BASE_BRANCH,
    setupScript: typeof r.setupScript === 'string' ? r.setupScript : undefined,
    env: typeof r.env === 'string' ? r.env : undefined,
  };
}

/**
 * `multi-repo2` migration: legacy `repos[]` entries persisted before this
 * model didn’t carry `id`/`name`. We fill them deterministically — the
 * primary repo (matching the project's own `rootPath`) gets a stable id
 * from the project id, and any extras get a stable id derived from their
 * own rootPath. Names default to `basename(rootPath)`.
 *
 * Pure / idempotent: feeding an already-migrated config returns
 * `mutated: false` and the same shape.
 */
export function backfillRepoIdentities(params: {
  projectId: string;
  primaryRootPath: string;
  repos: ReadonlyArray<ParsedRepoConfig | RepoConfig>;
}): { repos: RepoConfig[]; mutated: boolean } {
  const seenIds = new Set<string>();
  const seenRoots = new Map<string, number>();
  let mutated = false;
  const out = params.repos.map((r) => {
    const isPrimary = path.resolve(r.rootPath) === path.resolve(params.primaryRootPath);
    let id = r.id;
    if (!id || id.length === 0) {
      mutated = true;
      const roots = seenRoots.get(path.resolve(r.rootPath)) ?? 0;
      id = isPrimary
        ? deriveStablePrimaryRepoIdForProject({
            projectId: params.projectId,
            rootPath: r.rootPath,
          })
        : deriveRepoIdForRootPath({
            projectId: params.projectId,
            rootPath: r.rootPath,
            salt: roots > 0 ? `dup-${roots}` : '',
          });
    }
    while (seenIds.has(id)) {
      mutated = true;
      id = createHash('sha256').update(`${id}:dup`).digest('hex');
    }
    seenIds.add(id);
    seenRoots.set(path.resolve(r.rootPath), (seenRoots.get(path.resolve(r.rootPath)) ?? 0) + 1);

    let name = r.name;
    if (!name || name.length === 0) {
      mutated = true;
      const base = path.basename(path.resolve(r.rootPath));
      name = base && base !== '.' ? base : `repo:${id.slice(0, 7)}`;
    }
    return {
      id,
      name,
      rootPath: r.rootPath,
      baseBranch: r.baseBranch,
      ...(r.setupScript !== undefined ? { setupScript: r.setupScript } : {}),
      ...(r.env !== undefined ? { env: r.env } : {}),
    } satisfies RepoConfig;
  });
  return { repos: out, mutated };
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
  const planningModels = parseAgentSessionModelDefaultsField(
    (p as { planningModels?: unknown }).planningModels,
  );
  const taskDefaultModels = parseAgentSessionModelDefaultsField(
    (p as { taskDefaultModels?: unknown }).taskDefaultModels,
  );
  const py = (p as { planningAgentYolo?: unknown }).planningAgentYolo;
  const ty = (p as { defaultTaskAgentYolo?: unknown }).defaultTaskAgentYolo;
  const parsedRepos: ParsedRepoConfig[] = Array.isArray(p.repos)
    ? p.repos.map(parseRepoConfig).filter((r): r is ParsedRepoConfig => r !== null)
    : [];
  if (parsedRepos.length === 0) {
    parsedRepos.push({ rootPath: p.rootPath, baseBranch: DEFAULT_BASE_BRANCH });
  } else if (!parsedRepos.some((r) => r.rootPath === p.rootPath)) {
    parsedRepos.unshift({ rootPath: p.rootPath, baseBranch: DEFAULT_BASE_BRANCH });
  }
  const { repos } = backfillRepoIdentities({
    projectId: p.id,
    primaryRootPath: p.rootPath,
    repos: parsedRepos,
  });
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
    autoMarkDoneWhenPrMerged: p.autoMarkDoneWhenPrMerged === true,
    autoMoveToReviewWhenPrOpen: p.autoMoveToReviewWhenPrOpen === true,
    repos,
    ...(planningModels ? { planningModels } : {}),
    ...(py === true ? { planningAgentYolo: true } : {}),
    ...(taskDefaultModels ? { taskDefaultModels } : {}),
    ...(ty === true ? { defaultTaskAgentYolo: true } : {}),
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
function planningAssistantMarkdown(
  projectName: string,
  rootPath: string,
  multiRepoGuide: boolean,
): string {
  const workspaceIntro = multiRepoGuide
    ? `This directory is the Flux **planning** workspace for \`${projectName}\`. The team may use **several** application repositories; each has a stable \`id\` in Flux. Call \`flux__get_project_info\` before repo-specific work: it returns \`repos[]\` (with \`id\`, \`label\`, \`isPrimary\`, \`configuredDefaultBranch\`, optional \`defaultBranchShort\`, clone \`rootPath\` when known, plus \`pathStatus\` locally or \`binding\` in the cloud), \`primaryRepoId\`, and a backwards-compatible top-level \`rootPath\` pointing at the **primary** repository clone. Planning sessions still use **this** directory as the process working directory — open code under each repo's \`rootPath\` from the tool response, not only the path embedded below.

When user intent spans more than one repository and is ambiguous, **ask once** which repo (or \`repoId\`) they mean before creating tasks.`
    : `This directory is the Flux **planning** workspace for \`${projectName}\`. Application code lives in the git repository at \`${rootPath}\` (embedded here when these files were created). The **canonical** path for reading code is the \`rootPath\` field returned by \`flux__get_project_info\` — prefer that after you call the tool. Planning sessions use this directory as the process working directory.`;

  const contextSteps = multiRepoGuide
    ? `  1. Call \`flux__get_project_info\` once (unless you already have current \`repos\`, \`primaryRepoId\`, and primary \`rootPath\` from this turn). Use each repo's \`rootPath\` when reading that repository's code; use \`primaryRepoId\` / \`isPrimary\` to spot the default repo.
  2. Read planning documents in **this** directory (\`vision.md\`, \`architecture.md\`, sprint files, etc.).
  3. Explore each relevant repository under the \`rootPath\` values from the tool as needed.
  4. Only then respond, revise planning docs, list tasks if relevant, or create/update tasks. For **new** tasks, pass \`repoId\` (a string matching \`repos[].id\`) when work belongs to a non-primary repository; omit \`repoId\` to target the primary repo.`
    : `  1. Call \`flux__get_project_info\` once (unless you already have the current \`rootPath\` and project name from a call in this turn). Use the returned \`rootPath\` as the application codebase location.
  2. Read planning documents in **this** directory (\`vision.md\`, \`architecture.md\`, sprint files, etc.).
  3. Explore the repository under that \`rootPath\` as needed for the user\u2019s question.
  4. Only then respond, revise planning docs, list tasks if relevant, or create/update tasks so titles and descriptions match reality.`;

  const createTaskLine = multiRepoGuide
    ? `- \`flux__create_task\` — create a new task with title, description, and agent; optional \`blockedByTaskIds\`, optional \`labels\` (feature tags; normalized: trim, empty dropped, case-insensitive dedupe), optional \`assigneeEmail\` (cloud projects only; use \`flux__list_members\` to find member emails), optional \`repoId\` (must match \`flux__get_project_info.repos[].id\`; omit for the primary repository), optional \`sourceBranch\` (git short branch name; defaults like the app UI when omitted), and optional \`createSourceBranchIfMissing\` (when \`true\`, Flux may create a missing \`sourceBranch\` from the project default on first session start)`
    : `- \`flux__create_task\` — create a new task with title, description, and agent; optional \`blockedByTaskIds\`, optional \`labels\` (feature tags; normalized: trim, empty dropped, case-insensitive dedupe), optional \`assigneeEmail\` (cloud projects only; use \`flux__list_members\` to find member emails), optional \`sourceBranch\` (git short branch name; defaults like the app UI when omitted), and optional \`createSourceBranchIfMissing\` (when \`true\`, Flux may create a missing \`sourceBranch\` from the project default on first session start)`;

  const updateTaskLine = multiRepoGuide
    ? `- \`flux__update_task\` — update an existing task's title, description, status, agent, \`blockedByTaskIds\`, \`labels\`, \`assigneeEmail\`, \`unassignAssignee\`, optional \`repoId\` (only while the task has no Flux workspace/session or linked PR — same rules as the UI), and/or source-branch fields (any column transition; passing \`blockedByTaskIds: []\` clears dependencies; \`labels: []\` clears tags). Use \`assigneeEmail\` to assign/reassign by member email, or \`unassignAssignee: true\` to remove the assignee. Branch edits fail safely if a session or worktree already exists`
    : `- \`flux__update_task\` — update an existing task's title, description, status, agent, \`blockedByTaskIds\`, \`labels\`, \`assigneeEmail\`, \`unassignAssignee\`, and/or source-branch fields (any column transition; passing \`blockedByTaskIds: []\` clears dependencies; \`labels: []\` clears tags). Use \`assigneeEmail\` to assign/reassign by member email, or \`unassignAssignee: true\` to remove the assignee. Branch edits fail safely if a session or worktree already exists`;

  const projectInfoLine = multiRepoGuide
    ? `- \`flux__get_project_info\` — returns project \`name\`, top-level \`rootPath\` (primary clone), \`repos\` / \`primaryRepoId\` when multi-repo is active, \`taskCounts\`, and \`defaultBranchShort\` for the primary repo when git discovery succeeds (see \`branchDiscoveryError\` if not)`
    : `- \`flux__get_project_info\` — returns project \`name\`, canonical \`rootPath\` (read application code here), \`taskCounts\`, and \`defaultBranchShort\` when git discovery succeeds (see \`branchDiscoveryError\` if not)`;

  const listBranchesLine = multiRepoGuide
    ? `- \`flux__list_repo_branches\` — full local + origin remote branch lists, default branch, and optional \`classifyBranch\`; pass \`repoId\` to scope discovery to a specific repository (see \`flux__get_project_info\`)`
    : `- \`flux__list_repo_branches\` — full local + origin remote branch lists, default branch, and optional \`classifyBranch\` to see whether a name exists or is missing-but-creatable before batch-creating tasks`;

  return `# Planning workspace — ${projectName}

${workspaceIntro}

## Your role

You are a planning assistant. Help the developer think through features, maintain documentation in this directory, and manage tasks on the Flux board.

## Turn-taking

- Do **not** start a substantive planning pass, repository exploration, or tool use until the user has asked a question or given a concrete task.
- **After they do**, gather context **before** you give substantive answers, update planning docs, or call Flux task tools, unless the request is purely meta and needs no repository or board context. Follow this order:
${contextSteps}

## Available tools

You have access to the following Flux tools for task management:
- \`flux__list_tasks\` — list tasks on the board (each task includes \`sourceBranch\` / \`createSourceBranchIfMissing\` when set). Optional \`excludeStatuses\`: array of column ids (\`backlog\`, \`in-progress\`, \`needs-input\`, \`done\`) to omit—e.g. \`["done"]\` returns only non-completed tasks; omit the field for the full board
${createTaskLine}
- \`flux__start_task\` — move a task to the **In progress** column (\`status: "in-progress"\`); use when the user wants to pull work from backlog into active development on the board
${updateTaskLine}
- \`flux__delete_task\` — permanently remove a task from the board for this project; **only** after the user clearly asked to delete it, then call with \`confirm: true\`. If intent is ambiguous, ask once before deleting
${projectInfoLine}
${listBranchesLine}
- \`flux__list_members\` — cloud projects only: team roster (\`email\`, \`displayName\`, \`role\`) for assignee lookup; local projects return an empty list with a note

Board relationship: new tasks land in **Backlog**. \`flux__start_task\` is the usual way to mark work as actively in flight (\`in-progress\`). Use \`flux__update_task\` for other status changes (e.g. **Needs input**, **Review**, **Done**) or edits to title/description/agent.

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
  options?: { multiRepoGuide?: boolean },
): Promise<void> {
  const resolvedRoot = path.resolve(rootPath);
  const multiRepoGuide = options?.multiRepoGuide ?? true;
  const md = planningAssistantMarkdown(projectName, resolvedRoot, multiRepoGuide);
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

    // multi-repo2 migration: persist deterministic repo id/name once when a
    // legacy config that lacked them has been backfilled by parseConfig.
    let needsRewrite = false;
    try {
      const onDisk = JSON.parse(raw) as { repos?: Array<Partial<RepoConfig>> };
      const diskRepos = Array.isArray(onDisk.repos) ? onDisk.repos : [];
      const missing =
        diskRepos.length !== parsed.repos.length ||
        diskRepos.some((r, i) => {
          const target = parsed.repos[i];
          if (!target) return true;
          return (
            typeof r.id !== 'string' ||
            r.id !== target.id ||
            typeof r.name !== 'string' ||
            r.name !== target.name
          );
        });
      needsRewrite = missing;
    } catch {
      needsRewrite = false;
    }
    if (needsRewrite) {
      try {
        await atomicWriteFile(configPath, `${JSON.stringify(parsed, null, 2)}\n`);
      } catch (err) {
        console.warn('[ProjectStore] failed to persist multi-repo2 migration', err);
      }
    }
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

  /** Merge planning/task model strings and YOLO defaults into config.json. */
  async patchAgentSpawnDefaults(patch: AgentSpawnDefaultsPatch): Promise<void> {
    if (!this.projectDir || !this.project) {
      throw new Error('ProjectStore: no active local project');
    }
    await this.mutateConfig((c) => {
      const next: ConfigFile = { ...c };
      if (patch.planningModels !== undefined) {
        next.planningModels = { ...(c.planningModels ?? {}), ...patch.planningModels };
      }
      if (patch.planningAgentYolo !== undefined) {
        if (patch.planningAgentYolo) {
          next.planningAgentYolo = true;
        } else {
          delete next.planningAgentYolo;
        }
      }
      if (patch.taskDefaultModels !== undefined) {
        next.taskDefaultModels = { ...(c.taskDefaultModels ?? {}), ...patch.taskDefaultModels };
      }
      if (patch.defaultTaskAgentYolo !== undefined) {
        if (patch.defaultTaskAgentYolo) {
          next.defaultTaskAgentYolo = true;
        } else {
          delete next.defaultTaskAgentYolo;
        }
      }
      return next;
    });
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
   * Cloud multi-repo2: overwrite `repos[]` and the layout `rootPath` from shared
   * repo metadata + `localBindings.json` machine paths. Other config keys persist.
   */
  async applyCloudRepoBindings(
    projectDir: string,
    primaryRootPath: string,
    nextRepos: RepoConfig[],
  ): Promise<void> {
    const configPath = path.join(projectDir, 'config.json');
    const raw = await fs.readFile(configPath, 'utf8');
    const parsed = parseConfig(raw);
    if (!parsed) throw new Error(`Invalid config.json at ${configPath}`);
    const resolvedPrimary = path.resolve(primaryRootPath);
    const prevById = new Map(parsed.repos.map((r) => [r.id, r]));
    const mergedRepos = nextRepos.map((nr) => {
      const old = prevById.get(nr.id);
      if (!old) return nr;
      return {
        ...nr,
        ...(old.setupScript !== undefined ? { setupScript: old.setupScript } : {}),
        ...(old.env !== undefined ? { env: old.env } : {}),
      };
    });
    const next: ConfigFile = {
      ...parsed,
      rootPath: resolvedPrimary,
      repos: mergedRepos,
    };
    await atomicWriteFile(configPath, `${JSON.stringify(next, null, 2)}\n`);
    if (this.projectDir === projectDir && this.project) {
      this.project = configToLocalProject(next);
    }
  }

  /**
   * Persist a patch to the repo identified by `rootPath` inside `projectDir`.
   * Updates the in-memory active project only when `projectDir` matches.
   */
  async updateRepoAt(
    projectDir: string,
    rootPath: string,
    patch: RepoSettingsPatch,
  ): Promise<RepoConfig[]> {
    const configPath = path.join(projectDir, 'config.json');
    const raw = await fs.readFile(configPath, 'utf8');
    const parsed = parseConfig(raw);
    if (!parsed) throw new Error(`Invalid config.json at ${configPath}`);
    const repos = parsed.repos.map((r) => {
      if (path.resolve(r.rootPath) !== path.resolve(rootPath)) return r;
      return ProjectStore.applyRepoSettingsPatch(r, patch);
    });
    const next: ConfigFile = { ...parsed, repos };
    await atomicWriteFile(configPath, `${JSON.stringify(next, null, 2)}\n`);
    if (this.projectDir === projectDir && this.project) {
      this.project = configToLocalProject(next);
    }
    return repos;
  }

  /**
   * Persist repo settings for the entry identified by {@link RepoConfig.id}.
   */
  async updateRepoByIdAt(
    projectDir: string,
    repoId: string,
    patch: RepoSettingsPatch,
  ): Promise<RepoConfig[]> {
    const configPath = path.join(projectDir, 'config.json');
    const raw = await fs.readFile(configPath, 'utf8');
    const parsed = parseConfig(raw);
    if (!parsed) throw new Error(`Invalid config.json at ${configPath}`);
    let found = false;
    const repos = parsed.repos.map((r) => {
      if (r.id !== repoId) return r;
      found = true;
      return ProjectStore.applyRepoSettingsPatch(r, patch);
    });
    if (!found) {
      throw new Error(`Unknown repository id: ${repoId}`);
    }
    const next: ConfigFile = { ...parsed, repos };
    await atomicWriteFile(configPath, `${JSON.stringify(next, null, 2)}\n`);
    if (this.projectDir === projectDir && this.project) {
      this.project = configToLocalProject(next);
    }
    return repos;
  }

  private static applyRepoSettingsPatch(
    r: RepoConfig,
    patch: RepoSettingsPatch,
  ): RepoConfig {
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
    if (patch.name !== undefined) {
      const trimmed = patch.name.trim();
      if (trimmed.length === 0) {
        delete next.name;
      } else {
        next.name = trimmed;
      }
    }
    return next;
  }

  /**
   * Append a git working tree to `repos[]`. Id/name are assigned via
   * {@link backfillRepoIdentities}.
   */
  async addRepoAt(projectDir: string, rootPath: string): Promise<RepoConfig[]> {
    const resolved = path.resolve(rootPath);
    await assertGitRepoRoot(resolved);
    const configPath = path.join(projectDir, 'config.json');
    const raw = await fs.readFile(configPath, 'utf8');
    const parsed = parseConfig(raw);
    if (!parsed) throw new Error(`Invalid config.json at ${configPath}`);
    if (parsed.repos.some((r) => path.resolve(r.rootPath) === resolved)) {
      throw new Error('That git repository is already part of this project');
    }
    const extra: ParsedRepoConfig = {
      rootPath: resolved,
      baseBranch: DEFAULT_BASE_BRANCH,
    };
    const { repos } = backfillRepoIdentities({
      projectId: parsed.id,
      primaryRootPath: parsed.rootPath,
      repos: [...parsed.repos, extra],
    });
    const next: ConfigFile = { ...parsed, repos };
    await atomicWriteFile(configPath, `${JSON.stringify(next, null, 2)}\n`);
    if (this.projectDir === projectDir && this.project) {
      this.project = configToLocalProject(next);
    }
    return repos;
  }

  /**
   * Removes a repo from `repos[]` and updates {@link ConfigFile.rootPath}
   * when the primary entry was removed.
   */
  async removeRepoAt(projectDir: string, repoId: string): Promise<RepoConfig[]> {
    const configPath = path.join(projectDir, 'config.json');
    const raw = await fs.readFile(configPath, 'utf8');
    const parsed = parseConfig(raw);
    if (!parsed) throw new Error(`Invalid config.json at ${configPath}`);
    const idx = parsed.repos.findIndex((r) => r.id === repoId);
    if (idx === -1) {
      throw new Error(`Unknown repository id: ${repoId}`);
    }
    if (parsed.repos.length <= 1) {
      throw new Error('Cannot remove the last repository from a project');
    }
    const nextRepos = parsed.repos.filter((r) => r.id !== repoId);
    const primaryWasRemoved = idx === 0;
    const nextRoot = primaryWasRemoved ? nextRepos[0].rootPath : parsed.rootPath;
    const next: ConfigFile = {
      ...parsed,
      rootPath: nextRoot,
      repos: nextRepos,
    };
    await atomicWriteFile(configPath, `${JSON.stringify(next, null, 2)}\n`);
    if (this.projectDir === projectDir && this.project) {
      this.project = configToLocalProject(next);
    }
    return nextRepos;
  }

  /** Moves the chosen repo to index 0 and syncs project `rootPath` to its clone. */
  async setPrimaryRepoAt(projectDir: string, repoId: string): Promise<RepoConfig[]> {
    const configPath = path.join(projectDir, 'config.json');
    const raw = await fs.readFile(configPath, 'utf8');
    const parsed = parseConfig(raw);
    if (!parsed) throw new Error(`Invalid config.json at ${configPath}`);
    const idx = parsed.repos.findIndex((r) => r.id === repoId);
    if (idx === -1) {
      throw new Error(`Unknown repository id: ${repoId}`);
    }
    if (idx === 0) {
      return parsed.repos;
    }
    const chosen = parsed.repos[idx];
    const nextRepos = [
      chosen,
      ...parsed.repos.slice(0, idx),
      ...parsed.repos.slice(idx + 1),
    ];
    const next: ConfigFile = {
      ...parsed,
      rootPath: chosen.rootPath,
      repos: nextRepos,
    };
    await atomicWriteFile(configPath, `${JSON.stringify(next, null, 2)}\n`);
    if (this.projectDir === projectDir && this.project) {
      this.project = configToLocalProject(next);
    }
    return nextRepos;
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

  async getAutoMarkDoneWhenPrMergedAt(projectDir: string): Promise<boolean> {
    const configPath = path.join(projectDir, 'config.json');
    const raw = await fs.readFile(configPath, 'utf8');
    const parsed = parseConfig(raw);
    if (!parsed) throw new Error(`Invalid config.json at ${configPath}`);
    return parsed.autoMarkDoneWhenPrMerged === true;
  }

  async setAutoMarkDoneWhenPrMergedAt(
    projectDir: string,
    enabled: boolean,
  ): Promise<boolean> {
    const configPath = path.join(projectDir, 'config.json');
    const raw = await fs.readFile(configPath, 'utf8');
    const parsed = parseConfig(raw);
    if (!parsed) throw new Error(`Invalid config.json at ${configPath}`);
    const next: ConfigFile = {
      ...parsed,
      autoMarkDoneWhenPrMerged: enabled === true,
    };
    await atomicWriteFile(configPath, `${JSON.stringify(next, null, 2)}\n`);
    if (this.projectDir === projectDir && this.project) {
      this.project = configToLocalProject(next);
    }
    return next.autoMarkDoneWhenPrMerged;
  }

  async getAutoMoveToReviewWhenPrOpenAt(projectDir: string): Promise<boolean> {
    const configPath = path.join(projectDir, 'config.json');
    const raw = await fs.readFile(configPath, 'utf8');
    const parsed = parseConfig(raw);
    if (!parsed) throw new Error(`Invalid config.json at ${configPath}`);
    return parsed.autoMoveToReviewWhenPrOpen === true;
  }

  async setAutoMoveToReviewWhenPrOpenAt(
    projectDir: string,
    enabled: boolean,
  ): Promise<boolean> {
    const configPath = path.join(projectDir, 'config.json');
    const raw = await fs.readFile(configPath, 'utf8');
    const parsed = parseConfig(raw);
    if (!parsed) throw new Error(`Invalid config.json at ${configPath}`);
    const next: ConfigFile = {
      ...parsed,
      autoMoveToReviewWhenPrOpen: enabled === true,
    };
    await atomicWriteFile(configPath, `${JSON.stringify(next, null, 2)}\n`);
    if (this.projectDir === projectDir && this.project) {
      this.project = configToLocalProject(next);
    }
    return next.autoMoveToReviewWhenPrOpen;
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

  /**
   * Cloud projects must not share the local-project directory derived from the
   * repo basename. The Firestore project id is the stable namespace.
   */
  async ensureCloudLayoutForRoot(
    cloudProjectId: string,
    rootPath: string,
  ): Promise<{ projectDir: string; project: LocalProject }> {
    const safeId = cloudProjectId.replace(/[^A-Za-z0-9_-]/g, '_');
    return this.materialiseProjectDir(rootPath, path.join('cloud-projects', safeId));
  }

  async create(rootPath: string): Promise<{ project: LocalProject; projectDir: string }> {
    const { projectDir, project } = await this.materialiseProjectDir(rootPath);
    this.projectDir = projectDir;
    this.project = project;
    return { project, projectDir };
  }

  private async materialiseProjectDir(
    rootPath: string,
    projectDirName?: string,
  ): Promise<{ projectDir: string; project: LocalProject }> {
    const resolvedRoot = path.resolve(rootPath);
    const projectName = path.basename(resolvedRoot);
    const projectDir = path.join(this.fluxBaseDir, projectDirName ?? projectName);

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
      const newProjectId = stableProjectIdForPath(resolvedRoot);
      const primaryRepoId = deriveStablePrimaryRepoIdForProject({
        projectId: newProjectId,
        rootPath: resolvedRoot,
      });
      config = {
        id: newProjectId,
        name: projectName,
        rootPath: resolvedRoot,
        addedAt: now,
        planningAgent: DEFAULT_AGENT,
        defaultTaskAgent: DEFAULT_AGENT,
        autoStartSessionOnInProgress: false,
        autoStartWhenUnblocked: false,
        autoCleanupWorkspaceWhenDone: false,
        autoMarkDoneWhenPrMerged: false,
        autoMoveToReviewWhenPrOpen: false,
        repos: [
          {
            id: primaryRepoId,
            name: projectName,
            rootPath: resolvedRoot,
            baseBranch: DEFAULT_BASE_BRANCH,
          },
        ],
      };
    } else {
      const previousRootPath = config.rootPath;
      const remapped = config.repos.map((r) =>
        r.rootPath === previousRootPath ? { ...r, rootPath: resolvedRoot } : r,
      );
      if (!remapped.some((r) => r.rootPath === resolvedRoot)) {
        remapped.unshift({
          id: deriveStablePrimaryRepoIdForProject({
            projectId: config.id,
            rootPath: resolvedRoot,
          }),
          name: projectName,
          rootPath: resolvedRoot,
          baseBranch: DEFAULT_BASE_BRANCH,
        });
      }
      const { repos } = backfillRepoIdentities({
        projectId: config.id,
        primaryRootPath: resolvedRoot,
        repos: remapped,
      });
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
