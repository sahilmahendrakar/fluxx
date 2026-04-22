import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { Agent, LocalProject } from '../types';

const DEFAULT_AGENT: Agent = 'claude-code';

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
  const p = parsed as Partial<ConfigFile>;
  if (
    typeof p.id !== 'string' ||
    typeof p.name !== 'string' ||
    typeof p.rootPath !== 'string' ||
    typeof p.addedAt !== 'string'
  ) {
    return null;
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
- **After they do**, gather context **before** you give substantive answers, update planning docs, or call \`flux__create_task\` / \`flux__update_task\`, unless the request is purely meta and needs no repository or board context. Follow this order:
  1. Call \`flux__get_project_info\` once (unless you already have the current \`rootPath\` and project name from a call in this turn). Use the returned \`rootPath\` as the application codebase location.
  2. Read planning documents in **this** directory (\`vision.md\`, \`architecture.md\`, sprint files, etc.).
  3. Explore the repository under that \`rootPath\` as needed for the user’s question.
  4. Only then respond, revise planning docs, list tasks if relevant, or create/update tasks so titles and descriptions match reality.

## Available tools

You have access to the following Flux tools for task management:
- \`flux__list_tasks\` — list all current tasks on the board
- \`flux__create_task\` — create a new task with title, description, and agent
- \`flux__update_task\` — update an existing task's title, description, status, or agent
- \`flux__get_project_info\` — returns project \`name\`, canonical \`rootPath\` (read application code here), and \`taskCounts\`; call early after the user engages so task and planning work targets the correct repo

## Files in this directory

Maintain these files as living documents:
- \`vision.md\` — long-term project goals and direction
- \`architecture.md\` — technical decisions and system design
- \`YYYY-MM-sprint.md\` — time-boxed planning (create as needed)
- \`CLAUDE.md\` and \`AGENTS.md\` — agent instructions for this workspace (keep them aligned if you edit one)

## Guidelines

- Do not create or update tasks until the context pass above is done (when the question touches the codebase or board).
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
    const configPath = path.join(this.projectDir, 'config.json');
    const raw = await fs.readFile(configPath, 'utf8');
    const parsed = parseConfig(raw);
    if (!parsed) {
      throw new Error(`Invalid config.json at ${configPath}`);
    }
    const next: ConfigFile = { ...parsed, planningAgent: agent };
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
      };
    } else {
      config = {
        ...config,
        rootPath: resolvedRoot,
        name: projectName,
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
