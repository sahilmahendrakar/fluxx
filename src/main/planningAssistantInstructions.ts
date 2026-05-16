import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { migrateLegacyPlanningMarkdownIntoUserDocsDir } from '../planningDocs/planningUserDocsLegacyMigration';
import {
  planningMarkdownEquivalentForSeededInstructions,
  readFluxPlanningTemplateVersionFromManagedBody,
} from '../planningDocs/cloudPlanningDocsMigration';
import {
  FLUX_PLANNING_INSTRUCTIONS_BEGIN,
  FLUX_PLANNING_INSTRUCTIONS_END,
  PLANNING_INSTRUCTIONS_STATE_BASENAME,
} from '../planningDocs/planningInstructionMarkers';

export { PLANNING_INSTRUCTIONS_STATE_BASENAME } from '../planningDocs/planningInstructionMarkers';

/** Bumps when `planningAssistantMarkdown` prose meaningfully changes (used with embedded version tag). */
export const PLANNING_ASSISTANT_TEMPLATE_VERSION = 2;

export type PlanningInstructionFileName = 'CLAUDE.md' | 'AGENTS.md';

const FLUX_INSTRUCTIONS_SCHEMA_VERSION = 1 as const;

export interface FluxPlanningInstructionsStateFile {
  schemaVersion: typeof FLUX_INSTRUCTIONS_SCHEMA_VERSION;
  templateVersion: number;
  files: Partial<
    Record<
      PlanningInstructionFileName,
      {
        lastAppliedManagedContentHash: string;
      }
    >
  >;
}

function errnoCode(err: unknown): string | undefined {
  return err && typeof err === 'object' && 'code' in err
    ? (err as NodeJS.ErrnoException).code
    : undefined;
}

function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

export function fluxPlanningTemplateVersionLine(): string {
  return `<!-- flux-planning-template ${PLANNING_ASSISTANT_TEMPLATE_VERSION} -->`;
}

export function wrapPlanningInstructionsManagedBlock(managedInner: string): string {
  return `${FLUX_PLANNING_INSTRUCTIONS_BEGIN}\n${managedInner}\n${FLUX_PLANNING_INSTRUCTIONS_END}\n`;
}

export type ParsedPlanningInstructionBlocks =
  | {
      kind: 'managed-markers';
      userPrefix: string;
      managedInner: string;
      userSuffix: string;
    }
  | { kind: 'no-markers'; fullBody: string };

export function parsePlanningInstructionFileForUpdate(raw: string): ParsedPlanningInstructionBlocks {
  const text = raw.replace(/\r\n/g, '\n');
  const beginIdx = text.indexOf(FLUX_PLANNING_INSTRUCTIONS_BEGIN);
  const endIdx = text.indexOf(FLUX_PLANNING_INSTRUCTIONS_END);
  if (beginIdx === -1 || endIdx === -1 || endIdx <= beginIdx) {
    return { kind: 'no-markers', fullBody: text };
  }
  const afterBegin = beginIdx + FLUX_PLANNING_INSTRUCTIONS_BEGIN.length;
  const inner = text.slice(afterBegin, endIdx);
  return {
    kind: 'managed-markers',
    userPrefix: text.slice(0, beginIdx),
    managedInner: inner.replace(/^\n+/, '').replace(/\n+$/, ''),
    userSuffix: text.slice(endIdx + FLUX_PLANNING_INSTRUCTIONS_END.length),
  };
}

function assembleInstructionFileWithMarkers(
  userPrefix: string,
  managedInner: string,
  userSuffix: string,
): string {
  const p = userPrefix.replace(/\s+$/u, '');
  const s = userSuffix.replace(/^\s+/u, '');
  const mid = wrapPlanningInstructionsManagedBlock(managedInner);
  if (p && s) return `${p}\n\n${mid}\n${s}\n`;
  if (p) return `${p}\n\n${mid}`;
  if (s) return `${mid}\n${s}\n`;
  return mid;
}

async function readUtf8IfExists(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (e: unknown) {
    if (errnoCode(e) === 'ENOENT') return null;
    throw e;
  }
}

async function writeFluxInstructionsState(
  planningDir: string,
  state: FluxPlanningInstructionsStateFile,
): Promise<void> {
  const p = path.join(planningDir, PLANNING_INSTRUCTIONS_STATE_BASENAME);
  const tmp = `${p}.tmp`;
  const payload = `${JSON.stringify(state, null, 2)}\n`;
  await fs.writeFile(tmp, payload, 'utf8');
  if (process.platform === 'win32') {
    try {
      await fs.unlink(p);
    } catch (e: unknown) {
      if (errnoCode(e) !== 'ENOENT') throw e;
    }
  }
  await fs.rename(tmp, p);
}

/** Shared body for `planning/CLAUDE.md` and `planning/AGENTS.md` (same text, two filenames). */
export function planningAssistantMarkdown(
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
  2. Read team planning documents under \`docs/\` relative to this directory (for example \`docs/vision.md\`, \`docs/architecture.md\`, sprint notes, ADRs). Older projects may still have markdown at the planning root outside \`docs/\` until migrated — prefer \`docs/\` for new material.
  3. Explore each relevant repository under the \`rootPath\` values from the tool as needed.
  4. Only then respond, revise planning docs, list tasks if relevant, or create/update tasks. For **new** tasks, pass \`repoId\` (a string matching \`repos[].id\`) when work belongs to a non-primary repository; omit \`repoId\` to target the primary repo.`
    : `  1. Call \`flux__get_project_info\` once (unless you already have the current \`rootPath\` and project name from a call in this turn). Use the returned \`rootPath\` as the application codebase location.
  2. Read team planning documents under \`docs/\` relative to this directory (for example \`docs/vision.md\`, \`docs/architecture.md\`). Older projects may still have markdown at the planning root outside \`docs/\` until migrated — prefer \`docs/\` for new material.
  3. Explore the repository under that \`rootPath\` as needed for the user\u2019s question.
  4. Only then respond, revise planning docs, list tasks if relevant, or create/update tasks so titles and descriptions match reality.`;

  const createTaskLine = multiRepoGuide
    ? `- \`flux__create_task\` — create a new task with title, description, and agent; optional \`blockedByTaskIds\`, optional \`labels\` (feature tags; normalized: trim, empty dropped, case-insensitive dedupe), optional \`assigneeEmail\` (cloud projects only; use \`flux__list_members\` to find member emails), optional \`repoId\` (must match \`flux__get_project_info.repos[].id\`; omit for the primary repository), optional \`sourceBranch\` (git short branch name; defaults like the app UI when omitted), and optional \`createSourceBranchIfMissing\` (when \`true\`, Flux may create a missing \`sourceBranch\` from the project default on first session start), and optional \`attachedPlanningDocs\` (array of \`{ relativePath }\` for existing planning markdown such as \`docs/plan.md\` or \`notes/plan.md\`; MCP rejects missing/invalid paths)`
    : `- \`flux__create_task\` — create a new task with title, description, and agent; optional \`blockedByTaskIds\`, optional \`labels\` (feature tags; normalized: trim, empty dropped, case-insensitive dedupe), optional \`assigneeEmail\` (cloud projects only; use \`flux__list_members\` to find member emails), optional \`sourceBranch\` (git short branch name; defaults like the app UI when omitted), and optional \`createSourceBranchIfMissing\` (when \`true\`, Flux may create a missing \`sourceBranch\` from the project default on first session start), and optional \`attachedPlanningDocs\` (array of \`{ relativePath }\` for existing planning markdown such as \`docs/plan.md\` or \`notes/plan.md\`; MCP rejects missing/invalid paths)`;

  const updateTaskLine = multiRepoGuide
    ? `- \`flux__update_task\` — update an existing task's title, description, status, agent, \`blockedByTaskIds\`, \`labels\`, \`assigneeEmail\`, \`unassignAssignee\`, optional \`repoId\` (only while the task has no Flux workspace/session or linked PR — same rules as the UI), optional \`attachedPlanningDocs\` (replace the full list; \`null\` or \`[]\` clears; MCP validates paths), and/or source-branch fields (any column transition; passing \`blockedByTaskIds: []\` clears dependencies; \`labels: []\` clears tags). Use \`assigneeEmail\` to assign/reassign by member email, or \`unassignAssignee: true\` to remove the assignee. Branch edits fail safely if a session or worktree already exists`
    : `- \`flux__update_task\` — update an existing task's title, description, status, agent, \`blockedByTaskIds\`, \`labels\`, \`assigneeEmail\`, \`unassignAssignee\`, optional \`attachedPlanningDocs\` (replace the full list; \`null\` or \`[]\` clears; MCP validates paths), and/or source-branch fields (any column transition; passing \`blockedByTaskIds: []\` clears dependencies; \`labels: []\` clears tags). Use \`assigneeEmail\` to assign/reassign by member email, or \`unassignAssignee: true\` to remove the assignee. Branch edits fail safely if a session or worktree already exists`;

  const projectInfoLine = multiRepoGuide
    ? `- \`flux__get_project_info\` — returns project \`name\`, top-level \`rootPath\` (primary clone), \`repos\` / \`primaryRepoId\` when multi-repo is active, \`taskCounts\`, and \`defaultBranchShort\` for the primary repo when git discovery succeeds (see \`branchDiscoveryError\` if not)`
    : `- \`flux__get_project_info\` — returns project \`name\`, canonical \`rootPath\` (read application code here), \`taskCounts\`, and \`defaultBranchShort\` when git discovery succeeds (see \`branchDiscoveryError\` if not)`;

  const listBranchesLine = multiRepoGuide
    ? `- \`flux__list_repo_branches\` — full local + origin remote branch lists, default branch, and optional \`classifyBranch\`; pass \`repoId\` to scope discovery to a specific repository (see \`flux__get_project_info\`)`
    : `- \`flux__list_repo_branches\` — full local + origin remote branch lists, default branch, and optional \`classifyBranch\` to see whether a name exists or is missing-but-creatable before batch-creating tasks`;

  const body = `# Planning workspace — ${projectName}

${workspaceIntro}

## Your role

You are a planning assistant. Help the developer think through features, maintain documentation under \`docs/\` in this workspace, and manage tasks on the Flux board.

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

**Planning doc attachments:** When you turn a broad plan into concrete board tasks, add \`attachedPlanningDocs: [{ "relativePath": "docs/your-plan.md" }]\` (or another existing path under the planning docs tree, e.g. \`notes/plan.md\`) so implementers see the full write-up in Flux. Each task \`description\` should still spell out only that task's slice of work (acceptance, files, edge cases)—do not replace descriptions with a pointer to the plan alone.

**Task branches:** When the user names a base branch (e.g. “do this on \`feature/auth\`”), pass that as \`sourceBranch\` on **each** subtask you create so work stays on their branch. Use \`createSourceBranchIfMissing: true\` only when they want a new branch created on first start. If they did not specify a branch, omit \`sourceBranch\` so Flux uses the project default.

**Task dependencies:** \`blockedByTaskIds\` means “this task is blocked until these prerequisite tasks are addressed.” Use \`flux__list_tasks\` to get ids. Only reference tasks in the current project; invalid or cyclic graphs are rejected (local and cloud).

**Team (cloud) projects:** the Flux task tools route through the running Flux app for cloud projects. The app must be **open and signed in** for tools to work; if you see \`Sign in to Flux to use cloud project tools\` or \`Open the Flux app to enable cloud project tools\`, ask the user to bring Flux to the foreground and try again.

## Files in this workspace

Maintain team planning markdown under \`docs/\` (relative to this directory) as living documents:
- \`docs/vision.md\` — long-term project goals and direction
- \`docs/architecture.md\` — technical decisions and system design
- \`docs/YYYY-MM-sprint.md\` — time-boxed planning (create as needed)
- \`CLAUDE.md\` and \`AGENTS.md\` **in this directory** (not under \`docs/\`) — agent instructions for this workspace (keep them aligned if you edit one)

## Guidelines

- Do not create, update, start, or delete tasks until the context pass above is done (when the question touches the codebase or board).
- Update planning documents under \`docs/\` when decisions are made
- Create tasks for concrete, actionable work items
- Keep \`docs/vision.md\` and \`docs/architecture.md\` up to date as the project evolves
`;

  return `${fluxPlanningTemplateVersionLine()}\n\n${body}`;
}

function computeNextInstructionFile(
  relativePath: PlanningInstructionFileName,
  previous: string | null,
  managedInner: string,
): { nextBody: string; wroteManaged: boolean } {
  if (previous === null || previous.trim() === '') {
    return { nextBody: wrapPlanningInstructionsManagedBlock(managedInner), wroteManaged: true };
  }

  const parsed = parsePlanningInstructionFileForUpdate(previous);
  if (parsed.kind === 'managed-markers') {
    const v = readFluxPlanningTemplateVersionFromManagedBody(parsed.managedInner);
    if (v < PLANNING_ASSISTANT_TEMPLATE_VERSION) {
      return {
        nextBody: assembleInstructionFileWithMarkers(
          parsed.userPrefix,
          managedInner,
          parsed.userSuffix,
        ),
        wroteManaged: true,
      };
    }
    if (parsed.managedInner === managedInner) {
      return { nextBody: previous, wroteManaged: true };
    }
    if (planningMarkdownEquivalentForSeededInstructions(relativePath, parsed.managedInner, managedInner)) {
      return {
        nextBody: assembleInstructionFileWithMarkers(
          parsed.userPrefix,
          managedInner,
          parsed.userSuffix,
        ),
        wroteManaged: true,
      };
    }
    return { nextBody: previous, wroteManaged: false };
  }

  const full = parsed.fullBody;
  if (planningMarkdownEquivalentForSeededInstructions(relativePath, full, managedInner)) {
    return { nextBody: wrapPlanningInstructionsManagedBlock(managedInner), wroteManaged: true };
  }

  return { nextBody: full, wroteManaged: false };
}

/**
 * Idempotently creates or upgrades `planning/CLAUDE.md` and `planning/AGENTS.md`.
 * Flux-managed regions are delimited by HTML comments; user text outside those markers is preserved.
 */
export async function ensurePlanningAssistantMarkdownFiles(
  planningDir: string,
  projectName: string,
  rootPath: string,
  options?: { multiRepoGuide?: boolean },
): Promise<void> {
  await fs.mkdir(path.join(planningDir, 'docs'), { recursive: true });
  await migrateLegacyPlanningMarkdownIntoUserDocsDir(planningDir);
  const resolvedRoot = path.resolve(rootPath);
  const multiRepoGuide = options?.multiRepoGuide ?? true;
  const managedInner = planningAssistantMarkdown(projectName, resolvedRoot, multiRepoGuide);
  const managedHash = sha256Hex(managedInner);

  const paths = {
    'CLAUDE.md': path.join(planningDir, 'CLAUDE.md'),
    'AGENTS.md': path.join(planningDir, 'AGENTS.md'),
  } as const;

  const previousContent: Record<PlanningInstructionFileName, string | null> = {
    'CLAUDE.md': await readUtf8IfExists(paths['CLAUDE.md']),
    'AGENTS.md': await readUtf8IfExists(paths['AGENTS.md']),
  };

  const claude = computeNextInstructionFile('CLAUDE.md', previousContent['CLAUDE.md'], managedInner);
  const agents = computeNextInstructionFile('AGENTS.md', previousContent['AGENTS.md'], managedInner);

  if (claude.nextBody !== previousContent['CLAUDE.md']) {
    await fs.writeFile(paths['CLAUDE.md'], claude.nextBody, 'utf8');
  }
  if (agents.nextBody !== previousContent['AGENTS.md']) {
    await fs.writeFile(paths['AGENTS.md'], agents.nextBody, 'utf8');
  }

  const files: FluxPlanningInstructionsStateFile['files'] = {};
  if (claude.wroteManaged) {
    files['CLAUDE.md'] = { lastAppliedManagedContentHash: managedHash };
  }
  if (agents.wroteManaged) {
    files['AGENTS.md'] = { lastAppliedManagedContentHash: managedHash };
  }

  await writeFluxInstructionsState(planningDir, {
    schemaVersion: FLUX_INSTRUCTIONS_SCHEMA_VERSION,
    templateVersion: PLANNING_ASSISTANT_TEMPLATE_VERSION,
    files,
  });
}
