# Flux repository — agent notes

## CLI `flux tasks list`

`flux tasks list --json` supports optional repeated **`--exclude-status`**: board column ids (`backlog`, `in-progress`, `needs-input`, `done`). Tasks in those statuses are omitted from the result. Omit the flag to return the full board. Example: `flux tasks list --json --exclude-status done` for active work only. Filtering happens in the Flux desktop app after tasks are loaded, for both local and cloud projects.

## CLI create/update flags

Run `flux tasks create --help` and `flux tasks update --help` for the full flag list. **`--depends-on-task-id`** (and `--blocked-by-task-id`) set task dependencies on create and update. Multi-task feature breakdowns must set **`--source-branch`**, **`--label`**, and dependencies on every `flux tasks create` — see `planning/AGENTS.md` § Multi-task features.

Planning workspaces created by Flux also ship `planning/AGENTS.md` (and `planning/CLAUDE.md`) with the same command list; keep assistant files aligned when editing guidance.
