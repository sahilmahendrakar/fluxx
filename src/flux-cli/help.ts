const TASK_CREATE_FLAGS = `Usage: fluxx tasks create [--json] --title <text> [options]

Required:
  --title <text>                 Task title

Optional:
  --description <text>
  --agent <claude-code|cursor|codex|none>
  --label <name>                 Repeat for multiple labels (also --labels)
  --depends-on-task-id <taskId>  Repeat; task is blocked until listed tasks finish
                                 (aliases: --blocked-by-task-id, --depends-on, --blocked-by)
  --source-branch <git-branch>   Feature / base branch (alias: --feature-branch, --branch)
  --create-source-branch-if-missing=true|false
  --repo-id <id>                 Multi-repo projects only (alias: --repo)
  --assignee-email <email>       Cloud projects; resolve uid via fluxx members list
  --attach-doc <relativePath>    Repeat; planning markdown path (e.g. docs/plan.md)
                                 (aliases: --attach-docs, --attach-planning-doc)
  --agent-model <model>
  --agent-yolo=true|false
  --json                         JSON on stdout`;

const TASK_UPDATE_FLAGS = `Usage: fluxx tasks update [--json] --id <taskId> [options]

Required:
  --id <taskId>

Optional:
  --title <text>
  --description <text>
  --status <backlog|in-progress|needs-input|review|done>
  --agent <claude-code|cursor|codex|none>
  --label <name>                 Replaces all labels when any --label is passed
  --clear-labels                 Remove all labels
  --depends-on-task-id <taskId>  Replaces all dependencies when any dependency flag is passed
  --clear-dependencies           Remove all dependencies (aliases: --clear-blocked-by)
  --attach-doc <relativePath>    Replaces all attachments when any --attach-doc is passed
                                 (aliases: --attach-docs, --attach-planning-doc)
  --clear-attached-docs          Remove all planning doc attachments (alias: --clear-attach-docs)
  --source-branch <git-branch>   Alias: --feature-branch, --branch
  --create-source-branch-if-missing=true|false
  --repo-id <id>                 Only before session/worktree/PR exists
  --assignee-email <email>
  --unassign-assignee=true
  --auto-start-on-unblock=true|false
  --json`;

const TASK_LIST_FLAGS = `Usage: fluxx tasks list [--json] [options]

Optional:
  --exclude-status <column>      Repeat: backlog, in-progress, needs-input, done
  --json`;

const TASK_START_FLAGS = `Usage: fluxx tasks start [--json] --id <taskId>

  --json`;

const TASK_DELETE_FLAGS = `Usage: fluxx tasks delete [--json] --id <taskId> --confirm

  --confirm                      Required; only after explicit user intent to delete
  --json`;

const COORDINATION_REGISTER_FLAGS = `Usage: fluxx coordination register-overseer [--json] --source-branch <branch> [options]

Required:
  --source-branch <branch>       Feature line for overseer review (alias: --feature-branch, --branch)

Optional:
  --repo-id <id>                 Multi-repo projects (alias: --repo); defaults to primary
  --planning-session-id <id>     Flux planning session id (alias: --session-id)
  --json`;

const COORDINATION_SUBMIT_FLAGS = `Usage: fluxx coordination submit-handoff [--json] --task-id <id> --handoff-json <json>

Required:
  --task-id <id>                 Task to submit (alias: --id)
  --handoff-json <json>          Worker handoff object (alias: --handoff)

Handoff fields: outcome (complete|blocked|partial), summary, optional filesChanged[],
checks[], blockers[], reviewNotes. Max ${32_768} bytes JSON.

  --json`;

const COORDINATION_APPROVE_FLAGS = `Usage: fluxx coordination approve-handoff [--json] --task-id <id> [options]

Required:
  --task-id <id>

Optional:
  --notes <text>
  --json`;

const COORDINATION_REWORK_FLAGS = `Usage: fluxx coordination request-rework [--json] --task-id <id> --instructions <text> [options]

Required:
  --task-id <id>
  --instructions <text>          Rework instructions for the worker (alias: --rework-instructions)

Optional:
  --notes <text>
  --json`;

const TOP_LEVEL = `Fluxx CLI — board automation for planning sessions

Usage:
  fluxx project info [--json]
  fluxx tasks list|create|update|start|delete [--json] ...
  fluxx coordination register-overseer|submit-handoff|approve-handoff|request-rework [--json] ...
  fluxx members list [--json]
  fluxx repo branches [--json] [--repo-id <id>] [--classify-branch <name>]

Global:
  --json                         Print structured JSON on stdout
  -h, --help                     Show command help

Run \`fluxx <command> --help\` for subcommand flags (e.g. fluxx tasks create --help).`;

function helpForCoordinationAction(action: string | undefined): string | null {
  switch (action) {
    case 'register-overseer':
      return COORDINATION_REGISTER_FLAGS;
    case 'submit-handoff':
      return COORDINATION_SUBMIT_FLAGS;
    case 'approve-handoff':
      return COORDINATION_APPROVE_FLAGS;
    case 'request-rework':
      return COORDINATION_REWORK_FLAGS;
    case undefined:
      return `Usage: fluxx coordination <register-overseer|submit-handoff|approve-handoff|request-rework> [options]

Subcommands:
  register-overseer   Bind a planning session as overseer for a feature branch
  submit-handoff        Worker submits structured completion handoff (moves task to review)
  approve-handoff       Overseer approves the handoff
  request-rework        Overseer requests rework with instructions

Run \`fluxx coordination <subcommand> --help\` for flags.`;
    default:
      return null;
  }
}

function helpForTasksAction(action: string | undefined): string | null {
  switch (action) {
    case 'create':
      return TASK_CREATE_FLAGS;
    case 'update':
      return TASK_UPDATE_FLAGS;
    case 'list':
      return TASK_LIST_FLAGS;
    case 'start':
      return TASK_START_FLAGS;
    case 'delete':
      return TASK_DELETE_FLAGS;
    case undefined:
      return `Usage: fluxx tasks <list|create|update|start|delete> [options]

Subcommands:
  list     List tasks on the board
  create   Create a task (supports labels, dependencies, feature branch at create time)
  update   Update a task (including labels, dependencies, feature branch)
  start    Move task to in-progress and start agent session
  delete   Permanently delete (--confirm required)

Run \`fluxx tasks <subcommand> --help\` for flags.`;
    default:
      return null;
  }
}

/**
 * If argv requests help, print the matching usage text and return true.
 */
export function printFluxCliHelp(argv: string[]): boolean {
  const helpIndex = argv.findIndex((a) => a === '--help' || a === '-h');
  if (helpIndex < 0) {
    return false;
  }

  const positional = argv.filter((a) => a !== '--json' && a !== '--help' && a !== '-h');
  const [domain, action] = positional;

  let text: string;
  if (!domain) {
    text = TOP_LEVEL;
  } else if (domain === 'project') {
    text = 'Usage: fluxx project info [--json]\n\n  --json';
  } else if (domain === 'members') {
    text = 'Usage: fluxx members list [--json]\n\n  --json';
  } else if (domain === 'repo') {
    text =
      'Usage: fluxx repo branches [--json] [--repo-id <id>] [--classify-branch <name>]\n\n  --json';
  } else if (domain === 'tasks') {
    const sub = helpForTasksAction(action);
    text = sub ?? `Unknown tasks subcommand. ${helpForTasksAction(undefined) ?? ''}`;
  } else if (domain === 'coordination') {
    const sub = helpForCoordinationAction(action);
    text = sub ?? `Unknown coordination subcommand. ${helpForCoordinationAction(undefined) ?? ''}`;
  } else {
    text = TOP_LEVEL;
  }

  process.stdout.write(`${text}\n`);
  return true;
}
