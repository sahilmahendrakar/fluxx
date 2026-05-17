import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { migrateLegacyPlanningMarkdownIntoUserDocsDir } from '../planningDocs/planningUserDocsLegacyMigration';
import {
  planningMarkdownEquivalentForSeededInstructions,
  readFluxPlanningTemplateVersionFromManagedBody,
} from '../planningDocs/cloudPlanningDocsMigration';
import {
  FLUXX_PLANNING_INSTRUCTIONS_BEGIN,
  FLUXX_PLANNING_INSTRUCTIONS_END,
  findPlanningInstructionMarkerBounds,
  PLANNING_INSTRUCTIONS_STATE_BASENAME,
} from '../planningDocs/planningInstructionMarkers';

export { PLANNING_INSTRUCTIONS_STATE_BASENAME } from '../planningDocs/planningInstructionMarkers';

/** Bumps when `planningAssistantMarkdown` prose meaningfully changes (used with embedded version tag). */
export const PLANNING_ASSISTANT_TEMPLATE_VERSION = 6;

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

export function fluxxPlanningTemplateVersionLine(): string {
  return `<!-- fluxx-planning-template ${PLANNING_ASSISTANT_TEMPLATE_VERSION} -->`;
}

/** @deprecated Use {@link fluxxPlanningTemplateVersionLine}. */
export const fluxPlanningTemplateVersionLine = fluxxPlanningTemplateVersionLine;

export function wrapPlanningInstructionsManagedBlock(managedInner: string): string {
  return `${FLUXX_PLANNING_INSTRUCTIONS_BEGIN}\n${managedInner}\n${FLUXX_PLANNING_INSTRUCTIONS_END}\n`;
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
  const bounds = findPlanningInstructionMarkerBounds(text);
  if (!bounds) {
    return { kind: 'no-markers', fullBody: text };
  }
  const afterBegin = bounds.beginIdx + bounds.beginMarkerLen;
  const inner = text.slice(afterBegin, bounds.endIdx);
  return {
    kind: 'managed-markers',
    userPrefix: text.slice(0, bounds.beginIdx),
    managedInner: inner.replace(/^\n+/, '').replace(/\n+$/, ''),
    userSuffix: text.slice(bounds.endIdx + bounds.endMarkerLen),
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

function isGeneratedPlanningAssistantMarkdownWithoutMarkers(body: string): boolean {
  return (
    body.includes('# Planning workspace —') &&
    (body.includes('## Fluxx CLI') ||
      body.includes('## Flux CLI') ||
      (body.includes('You have access to the following Flux') &&
        body.includes('flux__get_project_info')) ||
      body.includes('fluxx project info --json') ||
      body.includes('flux project info --json'))
  );
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
    ? `This directory is the Fluxx **planning** workspace for \`${projectName}\`. The team may use **several** application repositories; each has a stable \`id\` in Fluxx. Run \`fluxx project info --json\` before repo-specific work: it returns \`repos[]\` (with \`id\`, \`label\`, \`isPrimary\`, \`configuredDefaultBranch\`, optional \`defaultBranchShort\`, clone \`rootPath\` when known, plus \`pathStatus\` locally or \`binding\` in the cloud), \`primaryRepoId\`, and a backwards-compatible top-level \`rootPath\` pointing at the **primary** repository clone. Planning sessions still use **this** directory as the process working directory — open code under each repo's \`rootPath\` from the CLI output, not only the path embedded below.

When user intent spans more than one repository and is ambiguous, **ask once** which repo (or \`repoId\`) they mean before creating tasks.`
    : `This directory is the Fluxx **planning** workspace for \`${projectName}\`. Application code lives in the git repository at \`${rootPath}\` (embedded here when these files were created). The **canonical** path for reading code is the \`rootPath\` field returned by \`fluxx project info --json\` — prefer that after you run the command. Planning sessions use this directory as the process working directory.`;

  const contextSteps = multiRepoGuide
    ? `  1. Run \`fluxx project info --json\` once (unless you already have current \`repos\`, \`primaryRepoId\`, and primary \`rootPath\` from this turn). Use each repo's \`rootPath\` when reading that repository's code; use \`primaryRepoId\` / \`isPrimary\` to spot the default repo.
  2. Read team planning documents under \`docs/\` relative to this directory (for example \`docs/vision.md\`, \`docs/architecture.md\`, sprint notes, ADRs). Older projects may still have markdown at the planning root outside \`docs/\` until migrated — prefer \`docs/\` for new material.
  3. Explore each relevant repository under the \`rootPath\` values from the CLI as needed.
  4. Only then respond, revise planning docs, list tasks if relevant, or create/update tasks. For **new** tasks, pass \`--repo-id\` (matching \`repos[].id\`) when work belongs to a non-primary repository; omit \`--repo-id\` to target the primary repo.`
    : `  1. Run \`fluxx project info --json\` once (unless you already have the current \`rootPath\` and project name from a command in this turn). Use the returned \`rootPath\` as the application codebase location.
  2. Read team planning documents under \`docs/\` relative to this directory (for example \`docs/vision.md\`, \`docs/architecture.md\`). Older projects may still have markdown at the planning root outside \`docs/\` until migrated — prefer \`docs/\` for new material.
  3. Explore the repository under that \`rootPath\` as needed for the user’s question.
  4. Only then respond, revise planning docs, list tasks if relevant, or create/update tasks so titles and descriptions match reality.`;

  const createTaskLine = multiRepoGuide
    ? `- \`fluxx tasks create --json --title "..." --description "..." --agent <claude-code|cursor|codex|none>\` — optional repeated \`--label <label>\`, repeated \`--depends-on-task-id <taskId>\`, repeated \`--attach-doc <relativePath>\` (planning markdown, e.g. \`docs/plan.md\`), \`--assignee-email\` (cloud; use \`fluxx members list --json\`), \`--repo-id <repos[].id>\` (omit for primary), \`--source-branch <git-branch>\` (alias: \`--feature-branch\`), \`--create-source-branch-if-missing=true\` when a missing branch should be created on first session start`
    : `- \`fluxx tasks create --json --title "..." --description "..." --agent <claude-code|cursor|codex|none>\` — optional repeated \`--label <label>\`, repeated \`--depends-on-task-id <taskId>\`, repeated \`--attach-doc <relativePath>\` (planning markdown, e.g. \`docs/plan.md\`), \`--assignee-email\` (cloud; use \`fluxx members list --json\`), \`--source-branch <git-branch>\` (alias: \`--feature-branch\`), \`--create-source-branch-if-missing=true\``;

  const updateTaskLine = multiRepoGuide
    ? `- \`fluxx tasks update --json --id <taskId>\` — optional \`--title\`, \`--description\`, \`--status\`, \`--agent\`, repeated \`--label <label>\` (replace labels), \`--clear-labels\`, repeated \`--depends-on-task-id <taskId>\` (replace dependencies), \`--clear-dependencies\`, repeated \`--attach-doc <relativePath>\` (replace attachments), \`--clear-attached-docs\`, \`--assignee-email\`, \`--unassign-assignee=true\`, \`--repo-id <repos[].id>\` (only while no session/worktree/PR — same as UI), \`--source-branch <git-branch>\` (alias: \`--feature-branch\`), \`--create-source-branch-if-missing\`. Branch edits fail safely if a session or worktree already exists`
    : `- \`fluxx tasks update --json --id <taskId>\` — optional \`--title\`, \`--description\`, \`--status\`, \`--agent\`, repeated \`--label <label>\` (replace labels), \`--clear-labels\`, repeated \`--depends-on-task-id <taskId>\` (replace dependencies), \`--clear-dependencies\`, repeated \`--attach-doc <relativePath>\` (replace attachments), \`--clear-attached-docs\`, \`--assignee-email\`, \`--unassign-assignee=true\`, \`--source-branch <git-branch>\` (alias: \`--feature-branch\`), \`--create-source-branch-if-missing\`. Branch edits fail safely if a session or worktree already exists`;

  const projectInfoLine = `- \`fluxx project info --json\` — project \`name\`, \`rootPath\` (primary clone), ${multiRepoGuide ? '`repos` / `primaryRepoId` when multi-repo is active, ' : ''}\`taskCounts\`, and \`defaultBranchShort\` when git discovery succeeds (see \`branchDiscoveryError\` if not)`;

  const listBranchesLine = multiRepoGuide
    ? `- \`fluxx repos branches --json\` — local + origin branch lists, default branch, optional \`--classify-branch <name>\`; add \`--repo-id\` to scope a non-primary repository`
    : `- \`fluxx repos branches --json\` — local + origin branch lists, default branch, optional \`--classify-branch <name>\` before batch-creating tasks`;

  const body = `# Planning workspace — ${projectName}

${workspaceIntro}

## Fluxx CLI

Planning sessions inject bridge env and prepend the packaged \`fluxx\` shim to \`PATH\` when Fluxx starts a session. Use the command as \`fluxx ...\`; do **not** create a \`FLUXX_BIN\` variable, paste the absolute shim path, or run \`which fluxx\` except when troubleshooting a missing command. **Always pass \`--json\`** on board commands so you can parse stdout. Run \`fluxx tasks create --help\` or \`fluxx tasks update --help\` for the full flag list. If \`fluxx\` is missing, ask the user to start planning from the Fluxx app (not a bare shell).

## Your role

You are a planning assistant. Help the developer think through features, maintain documentation under \`docs/\` in this workspace, and manage tasks on the Fluxx board via the CLI.

## Turn-taking

- Do **not** start a substantive planning pass, repository exploration, or CLI use until the user has asked a question or given a concrete task.
- **After they do**, gather context **before** you give substantive answers, update planning docs, or run Fluxx CLI commands, unless the request is purely meta and needs no repository or board context. Follow this order:
${contextSteps}

## Available commands

Board and project operations (run in the planning shell):

- \`fluxx tasks list --json\` — list tasks (includes \`sourceBranch\` / \`createSourceBranchIfMissing\` when set). Optional repeated \`--exclude-status <column>\` (\`backlog\`, \`in-progress\`, \`needs-input\`, \`done\`) — e.g. \`--exclude-status done\` for active work only
${createTaskLine}
- \`fluxx tasks start --json --id <taskId>\` — move a task to **In progress** (\`in-progress\`)
${updateTaskLine}
- \`fluxx tasks delete --json --id <taskId> --confirm\` — permanently remove a task; **only** after the user clearly asked to delete. If intent is ambiguous, ask once before deleting
${projectInfoLine}
${listBranchesLine}
- \`fluxx members list --json\` — cloud projects: team roster (\`email\`, \`displayName\`, \`role\`); local projects return an empty list with a note

Board relationship: new tasks land in **Backlog**. \`fluxx tasks start\` is the usual way to mark work actively in flight. Use \`fluxx tasks update\` for other status changes (e.g. **Needs input**, **Review**, **Done**) or edits to title/description/agent.

**Planning doc attachments:** When you turn a broad plan into concrete board tasks, pass repeated \`--attach-doc <relativePath>\` on \`fluxx tasks create\` (or \`fluxx tasks update\` to replace attachments) so implementers see the full write-up in Fluxx — paths are relative to the planning docs tree, e.g. \`docs/your-plan.md\` or \`notes/plan.md\` (\`.md\` only). Example: \`fluxx tasks create --json --title "..." --attach-doc docs/your-plan.md ...\`. Each task \`description\` should still spell out only that task's slice of work (acceptance, files, edge cases)—do not replace descriptions with a pointer to the plan alone.

## Multi-task features (required)

When you split one user-facing feature or initiative into **two or more** board tasks, treat them as a single feature batch. **Do this on every \`fluxx tasks create\` in the batch — not in a follow-up \`fluxx tasks update\`:**

1. **Feature branch** — Choose one git branch (e.g. \`feature/list-view\`). Pass \`--source-branch <branch> --create-source-branch-if-missing=true\` on **each** task in the batch. If the user named a branch, use it; otherwise derive a short \`feature/<slug>\` from the feature name.
2. **Labels** — Pass at least two repeated \`--label\` flags on **each** create: one area (e.g. \`frontend\`, \`backend\`, \`planning\`) and one kind (e.g. \`enhancement\`, \`bugfix\`). Add a feature slug label when helpful (e.g. \`list-view\`).
3. **Dependencies** — The CLI supports \`--depends-on-task-id\` on **create and update** (aliases: \`--blocked-by-task-id\`). Create foundation tasks first; for later tasks in the batch, pass \`--depends-on-task-id <id>\` for each prerequisite using ids from \`fluxx tasks list --json\` or from earlier creates in the same turn. Typical order: toggle/shell → core component → sorting → polish. Do **not** tell the user dependencies are UI-only.

**Single-task requests:** Still add sensible \`--label\` flags. Use \`--source-branch\` when the user names a branch or the work clearly belongs on a named feature branch.

**Task branches (all creates):** \`--source-branch\` / \`--feature-branch\` set the git branch for agent sessions. \`--create-source-branch-if-missing=true\` creates the branch on first session start when it does not exist yet.

**Task labels, dependencies, and planning docs:** Use repeated flags, not JSON: \`--label frontend --label enhancement\`, \`--depends-on-task-id <taskId>\` (repeat per blocker), \`--attach-doc docs/plan.md\` (repeat per doc), \`--clear-labels\`, \`--clear-dependencies\`, \`--clear-attached-docs\` on update. Reference only tasks in the current project.

**Team (cloud) projects:** CLI commands route through the running Fluxx app. It must be **open and signed in**; if you see auth or “open Fluxx” errors, ask the user to bring Fluxx to the foreground and try again.

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

  return `${fluxxPlanningTemplateVersionLine()}\n\n${body}`;
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
  if (isGeneratedPlanningAssistantMarkdownWithoutMarkers(full)) {
    return { nextBody: wrapPlanningInstructionsManagedBlock(managedInner), wroteManaged: true };
  }
  if (planningMarkdownEquivalentForSeededInstructions(relativePath, full, managedInner)) {
    return { nextBody: wrapPlanningInstructionsManagedBlock(managedInner), wroteManaged: true };
  }

  return { nextBody: full, wroteManaged: false };
}

/**
 * Idempotently creates or upgrades `planning/CLAUDE.md` and `planning/AGENTS.md`.
 * Fluxx-managed regions are delimited by HTML comments; user text outside those markers is preserved.
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
