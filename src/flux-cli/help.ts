const TASK_CREATE_FLAGS = `Usage: flux tasks create [--json] --title <text> [options]

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
  --assignee-email <email>       Cloud projects; resolve uid via flux members list
  --agent-model <model>
  --agent-yolo=true|false
  --json                         JSON on stdout`;

const TASK_UPDATE_FLAGS = `Usage: flux tasks update [--json] --id <taskId> [options]

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
  --source-branch <git-branch>   Alias: --feature-branch, --branch
  --create-source-branch-if-missing=true|false
  --repo-id <id>                 Only before session/worktree/PR exists
  --assignee-email <email>
  --unassign-assignee=true
  --auto-start-on-unblock=true|false
  --json`;

const TASK_LIST_FLAGS = `Usage: flux tasks list [--json] [options]

Optional:
  --exclude-status <column>      Repeat: backlog, in-progress, needs-input, done
  --json`;

const TASK_START_FLAGS = `Usage: flux tasks start [--json] --id <taskId>

  --json`;

const TASK_DELETE_FLAGS = `Usage: flux tasks delete [--json] --id <taskId> --confirm

  --confirm                      Required; only after explicit user intent to delete
  --json`;

const TOP_LEVEL = `Flux CLI — board automation for planning sessions

Usage:
  flux project info [--json]
  flux tasks list|create|update|start|delete [--json] ...
  flux members list [--json]
  flux repo branches [--json] [--repo-id <id>] [--classify-branch <name>]

Global:
  --json                         Print structured JSON on stdout
  -h, --help                     Show command help

Run \`flux <command> --help\` for subcommand flags (e.g. flux tasks create --help).`;

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
      return `Usage: flux tasks <list|create|update|start|delete> [options]

Subcommands:
  list     List tasks on the board
  create   Create a task (supports labels, dependencies, feature branch at create time)
  update   Update a task (including labels, dependencies, feature branch)
  start    Move task to in-progress and start agent session
  delete   Permanently delete (--confirm required)

Run \`flux tasks <subcommand> --help\` for flags.`;
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
    text = 'Usage: flux project info [--json]\n\n  --json';
  } else if (domain === 'members') {
    text = 'Usage: flux members list [--json]\n\n  --json';
  } else if (domain === 'repo') {
    text =
      'Usage: flux repo branches [--json] [--repo-id <id>] [--classify-branch <name>]\n\n  --json';
  } else if (domain === 'tasks') {
    const sub = helpForTasksAction(action);
    text = sub ?? `Unknown tasks subcommand. ${helpForTasksAction(undefined) ?? ''}`;
  } else {
    text = TOP_LEVEL;
  }

  process.stdout.write(`${text}\n`);
  return true;
}
