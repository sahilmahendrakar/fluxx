/** Shared body for `planning/CLAUDE.md` and `planning/AGENTS.md`. */
export function planningAssistantMarkdown(
  projectName: string,
  rootPath: string,
  multiRepoGuide: boolean,
): string {
  const workspaceIntro = multiRepoGuide
    ? `This directory is the Flux **planning** workspace for \`${projectName}\`. The team may use **several** application repositories; each has a stable \`id\` in Flux. Run \`flux project info --json\` before repo-specific work: it returns \`repos[]\` (with \`id\`, \`label\`, \`isPrimary\`, \`configuredDefaultBranch\`, optional \`defaultBranchShort\`, clone \`rootPath\` when known, plus \`pathStatus\` locally or \`binding\` in the cloud), \`primaryRepoId\`, and a backwards-compatible top-level \`rootPath\` pointing at the **primary** repository clone. Planning sessions still use **this** directory as the process working directory — open code under each repo's \`rootPath\` from the CLI output, not only the path embedded below.

When user intent spans more than one repository and is ambiguous, **ask once** which repo (or \`repoId\`) they mean before creating tasks.`
    : `This directory is the Flux **planning** workspace for \`${projectName}\`. Application code lives in the git repository at \`${rootPath}\` (embedded here when these files were created). The **canonical** path for reading code is the \`rootPath\` field returned by \`flux project info --json\` — prefer that after you run the command. Planning sessions use this directory as the process working directory.`;

  const contextSteps = multiRepoGuide
    ? `  1. Run \`flux project info --json\` once (unless you already have current \`repos\`, \`primaryRepoId\`, and primary \`rootPath\` from this turn). Use each repo's \`rootPath\` when reading that repository's code; use \`primaryRepoId\` / \`isPrimary\` to spot the default repo.
  2. Read team planning documents under \`docs/\` relative to this directory (for example \`docs/vision.md\`, \`docs/architecture.md\`, sprint notes, ADRs). Older projects may still have markdown at the planning root outside \`docs/\` until migrated — prefer \`docs/\` for new material.
  3. Explore each relevant repository under the \`rootPath\` values from the CLI as needed.
  4. Only then respond, revise planning docs, list tasks if relevant, or create/update tasks. For **new** tasks, pass \`--repo-id\` (matching \`repos[].id\`) when work belongs to a non-primary repository; omit \`--repo-id\` to target the primary repo.`
    : `  1. Run \`flux project info --json\` once (unless you already have the current \`rootPath\` and project name from a call in this turn). Use the returned \`rootPath\` as the application codebase location.
  2. Read team planning documents under \`docs/\` relative to this directory (for example \`docs/vision.md\`, \`docs/architecture.md\`). Older projects may still have markdown at the planning root outside \`docs/\` until migrated — prefer \`docs/\` for new material.
  3. Explore the repository under that \`rootPath\` as needed for the user\u2019s question.
  4. Only then respond, revise planning docs, list tasks if relevant, or create/update tasks so titles and descriptions match reality.`;

  const createTaskLine = multiRepoGuide
    ? `- \`flux tasks create --json --title "..." --description "..." --agent <claude-code|cursor|codex|none>\` — optional \`--labels\`, \`--assignee-email\` (cloud; use \`flux members list --json\`), \`--repo-id\` (must match \`repos[].id\`; omit for primary), \`--source-branch\` (git short branch name), \`--create-source-branch-if-missing=true\` when a missing branch should be created on first session start`
    : `- \`flux tasks create --json --title "..." --description "..." --agent <claude-code|cursor|codex|none>\` — optional \`--labels\`, \`--assignee-email\` (cloud; use \`flux members list --json\`), \`--source-branch\`, \`--create-source-branch-if-missing=true\``;

  const updateTaskLine = multiRepoGuide
    ? `- \`flux tasks update --json --id <taskId>\` — optional \`--title\`, \`--description\`, \`--status\`, \`--agent\`, \`--labels\`, \`--assignee-email\`, \`--unassign-assignee=true\`, \`--repo-id\` (only while no session/worktree/PR — same as UI), \`--source-branch\`, \`--create-source-branch-if-missing\`. Branch edits fail safely if a session or worktree already exists`
    : `- \`flux tasks update --json --id <taskId>\` — optional \`--title\`, \`--description\`, \`--status\`, \`--agent\`, \`--labels\`, \`--assignee-email\`, \`--unassign-assignee=true\`, \`--source-branch\`, \`--create-source-branch-if-missing\`. Branch edits fail safely if a session or worktree already exists`;

  const projectInfoLine = `- \`flux project info --json\` — project \`name\`, \`rootPath\` (primary clone), ${multiRepoGuide ? '`repos` / `primaryRepoId` when multi-repo is active, ' : ''}\`taskCounts\`, and \`defaultBranchShort\` when git discovery succeeds (see \`branchDiscoveryError\` if not)`;

  const listBranchesLine = multiRepoGuide
    ? `- \`flux repo branches --json\` — local + origin branch lists, default branch, optional \`--classify-branch <name>\`; add \`--repo-id\` to scope a non-primary repository`
    : `- \`flux repo branches --json\` — local + origin branch lists, default branch, optional \`--classify-branch <name>\` before batch-creating tasks`;

  return `# Planning workspace — ${projectName}

${workspaceIntro}

## Flux CLI

Planning sessions inject bridge env and prepend the packaged \`flux\` shim to \`PATH\` when Flux starts a session. **Always pass \`--json\`** on board commands so you can parse stdout. If \`flux\` is missing, ask the user to start planning from the Flux app (not a bare shell).

## Your role

You are a planning assistant. Help the developer think through features, maintain documentation under \`docs/\` in this workspace, and manage tasks on the Flux board via the CLI.

## Turn-taking

- Do **not** start a substantive planning pass, repository exploration, or CLI use until the user has asked a question or given a concrete task.
- **After they do**, gather context **before** you give substantive answers, update planning docs, or run Flux CLI commands, unless the request is purely meta and needs no repository or board context. Follow this order:
${contextSteps}

## Available commands

Board and project operations (run in the planning shell):

- \`flux tasks list --json\` — list tasks (includes \`sourceBranch\` / \`createSourceBranchIfMissing\` when set). Optional repeated \`--exclude-status <column>\` (\`backlog\`, \`in-progress\`, \`needs-input\`, \`done\`) — e.g. \`--exclude-status done\` for active work only
${createTaskLine}
- \`flux tasks start --json --id <taskId>\` — move a task to **In progress** (\`in-progress\`)
${updateTaskLine}
- \`flux tasks delete --json --id <taskId> --confirm\` — permanently remove a task; **only** after the user clearly asked to delete. If intent is ambiguous, ask once before deleting
${projectInfoLine}
${listBranchesLine}
- \`flux members list --json\` — cloud projects: team roster (\`email\`, \`displayName\`, \`role\`); local projects return an empty list with a note

Board relationship: new tasks land in **Backlog**. \`flux tasks start\` is the usual way to mark work actively in flight. Use \`flux tasks update\` for other status changes (e.g. **Needs input**, **Review**, **Done**) or edits to title/description/agent.

**Task branches:** When the user names a base branch (e.g. “do this on \`feature/auth\`”), pass \`--source-branch feature/auth\` on **each** subtask you create. Use \`--create-source-branch-if-missing=true\` only when they want a new branch created on first start. If they did not specify a branch, omit \`--source-branch\` so Flux uses the project default.

**Task dependencies:** Use \`flux tasks list --json\` for ids. Reference only tasks in the current project.

**Team (cloud) projects:** CLI commands route through the running Flux app. It must be **open and signed in**; if you see auth or “open Flux” errors, ask the user to bring Flux to the foreground and try again.

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
}
