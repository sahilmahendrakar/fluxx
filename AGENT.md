# Fluxx repository — agent notes

## MCP `flux__list_tasks`

`flux__list_tasks` supports optional **`excludeStatuses`**: an array of board column ids (`backlog`, `in-progress`, `needs-input`, `done`). Tasks in those statuses are omitted from the tool result. Omit the field (or pass an empty array) to return the full board—the previous default. Example: `{ "excludeStatuses": ["done"] }` for active work only. Filtering happens in the Fluxx desktop app after tasks are loaded, for both local and cloud projects.

Planning workspaces created by Fluxx also ship `planning/AGENTS.md` (and `planning/CLAUDE.md`) with the same tool list; keep those aligned when editing assistant guidance.
