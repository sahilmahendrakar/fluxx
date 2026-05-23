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

const VALIDATION_RUN_FLAGS = `Usage: fluxx validation run [--json] --task-id <taskId> [options]

Required:
  --task-id <taskId>             Task to validate (alias: --task)

Optional:
  --pack <packId>                Validation pack (default: electron-playwright)
  --validator-agent <agent>      claude-code | codex | cursor (default: cursor)
  --no-launch                    Create the run record only (do not start validator agent)
  --json`;

const VALIDATION_LAUNCH_FLAGS = `Usage: fluxx validation launch [--json] --run-id <runId> [options]

Required:
  --run-id <runId>               Queued validation run to launch (alias: --run)

Optional:
  --task-id <taskId>             Task id when disambiguation is needed (alias: --task)
  --json`;

const VALIDATION_LIST_FLAGS = `Usage: fluxx validation list [--json] --task-id <taskId>

Required:
  --task-id <taskId>             Task whose runs to list (alias: --task)
  --json`;

const VALIDATION_SHOW_FLAGS = `Usage: fluxx validation show [--json] --run-id <runId>

Required:
  --run-id <runId>               Validation run id (alias: --run)

Notes:
  Ingests verdict.json when the run is not terminal and the file is present.
  --json`;

const VALIDATION_ARTIFACTS_FLAGS = `Usage: fluxx validation artifacts [--json] --run-id <runId>

Required:
  --run-id <runId>               Validation run id (alias: --run)

Notes:
  Ingests verdict.json when the run is not terminal and the file is present.
  --json`;

const VALIDATION_INGEST_FLAGS = `Usage: fluxx validation ingest [--json] --run-id <runId>

Required:
  --run-id <runId>               Validation run id (alias: --run)

Reads <artifactDir>/verdict.json, registers artifacts, and updates run status.
  --json`;

const VALIDATION_FINISH_FLAGS = `Usage: fluxx validation finish [--json] --run-id <runId>

Required:
  --run-id <runId>               Validation run id (alias: --run)

Finalizes a validation run after the validator writes verdict.json. Registers artifacts,
updates run status, and refreshes the Fluxx UI. Keep the validator session open for follow-up.
  --json`;

const TOP_LEVEL = `Fluxx CLI — board automation for planning sessions

Usage:
  fluxx project info [--json]
  fluxx tasks list|create|update|start|delete [--json] ...
  fluxx validation run|launch|list|show|artifacts|ingest|finish [--json] ...
  fluxx members list [--json]
  fluxx repo branches [--json] [--repo-id <id>] [--classify-branch <name>]

Global:
  --json                         Print structured JSON on stdout
  -h, --help                     Show command help

Run \`fluxx <command> --help\` for subcommand flags (e.g. fluxx tasks create --help).`;

function helpForValidationAction(action: string | undefined): string | null {
  switch (action) {
    case 'run':
      return VALIDATION_RUN_FLAGS;
    case 'launch':
      return VALIDATION_LAUNCH_FLAGS;
    case 'list':
      return VALIDATION_LIST_FLAGS;
    case 'show':
      return VALIDATION_SHOW_FLAGS;
    case 'artifacts':
      return VALIDATION_ARTIFACTS_FLAGS;
    case 'ingest':
      return VALIDATION_INGEST_FLAGS;
    case 'finish':
      return VALIDATION_FINISH_FLAGS;
    case undefined:
      return `Usage: fluxx validation <run|launch|list|show|artifacts|ingest|finish> [options]

Subcommands:
  run        Create a validation run and start the validator agent (use --no-launch to skip)
  launch     Start the validator agent for an existing queued run
  list       List validation runs for a task
  show       Show one run (ingests verdict when applicable)
  artifacts  List artifacts for a run (ingests verdict when applicable)
  ingest     Parse verdict.json and update run status
  finish     Finalize a validation run after verdict.json is written (preferred for validators)

Run \`fluxx validation <subcommand> --help\` for flags.`;
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
  } else if (domain === 'validation') {
    const sub = helpForValidationAction(action);
    text = sub ?? `Unknown validation subcommand. ${helpForValidationAction(undefined) ?? ''}`;
  } else {
    text = TOP_LEVEL;
  }

  process.stdout.write(`${text}\n`);
  return true;
}
