# Fluxx

> AI-native project management for software development.

---

## What is Fluxx?

Fluxx is a desktop app that lets you manage software development tasks and run AI coding agents (Claude Code, Codex, Cursor, and others) against them — all from a single interface.

Instead of juggling multiple terminal windows and losing track of what each agent is doing, Fluxx gives you a kanban board where every task has its own isolated agent session, its own git worktree, and a clear status. A built-in planning assistant helps you break down features into agent-ready tasks and assign them intelligently.

Think of it as the project management layer that AI-assisted development has been missing.

---

## Core concepts

**Tasks** are the unit of work. Each task has a title, description, acceptance criteria, and an assigned agent. Tasks move through four states: `Backlog → In Progress → Needs Input → Done`.

**Sessions** are agent processes attached to tasks. When you start a session, Fluxx spawns the chosen agent CLI in an isolated git worktree and attaches a terminal to it. You can watch it work, interrupt it, or redirect it — all without leaving Fluxx.

**Worktrees** give each task its own branch and working directory via `git worktree`. Agents working in parallel never touch the same files.

**The planning assistant** is a conversational AI that reads your repo and helps you decompose features into concrete, agent-executable tasks. Describe what you want to build; it proposes tasks with agent assignments that you can add to the board in one click.

---

## Features

### MVP
- Kanban board with four columns: Backlog, In Progress, Needs Input, Done
- Create and edit tasks with title, description, and acceptance criteria
- Assign an agent (Claude Code, Codex CLI, Cursor) per task
- For **Cursor Agent** and **Claude Code** tasks, the task detail pane uses **friendly model presets** (still stored as real CLI model ids) plus **Add model…** to save extra ids in local storage; optional **YOLO** (Cursor) / **skip permission checks** (Claude) map to each CLI’s flags
- Launch a native terminal session for each task inside an isolated git worktree
- Manual "needs input" flagging to move tasks into the attention queue
- Desktop notifications when tasks are flagged
- Planning assistant powered by Claude API

---

## Architecture

Fluxx is a standard two-process Electron app:

**Renderer process** — the React UI. Three main views: the kanban board, the task detail/terminal view, and the planning assistant. Communicates with the main process exclusively over a typed IPC layer.

**Main process** — Node.js services:
- `TaskStore` — SQLite-backed CRUD for tasks and session metadata
- `SessionManager` — spawns and manages `node-pty` processes per task
- `WorktreeService` — creates and tears down `git worktree` branches per task
- `PlanningService` — calls the Anthropic API with repo context to generate task proposals
- `NotificationService` — fires OS desktop notifications

Each agent runs as a child process inside its own git worktree directory. Fluxx does not intercept or parse agent I/O in the MVP — agents run natively in embedded terminals and the user interacts with them directly.

---

## Design principles

**Local-first.** All data lives on your machine. No accounts, no sync, no cloud dependency. Your codebase and your tasks stay yours.

**Agent-agnostic.** Fluxx doesn't care which agent you use. If it runs in a terminal, it works with Fluxx. First-class support for Claude Code, Codex CLI, and Cursor — with more adapters planned.

**Minimal interruption.** Fluxx should stay out of your way. The board is a glanceable overview, not a workflow you manage. Agents do the work; Fluxx tracks it.

**Worktree isolation by default.** Every task gets its own branch and directory. Agents working in parallel never interfere with each other or with your main branch.

---

## Development

```
pnpm install
cp .env.example .env   # optional — only needed to enable Google sign-in
pnpm start
```

Sign-in is optional. Without the env vars set, Fluxx runs fully local (open local projects, run agents). To enable Google sign-in, create a Firebase project + a Google OAuth "Desktop app" client and fill in the `.env` values documented in `.env.example`.

### Planning assistant and Fluxx CLI

When you start a planning session, Fluxx injects automation bridge env vars, writes `.fluxx/cli-bridge.json` under the project directory (legacy `.flux/cli-bridge.json` is still read), and prepends the packaged `fluxx` shim to the PTY `PATH` (dev builds use `.vite/build`; the `flux` command remains a one-release alias). Planning agents run board commands in the shell, for example `fluxx project info --json` and `fluxx tasks list --json`.

Seeded `planning/CLAUDE.md` and `planning/AGENTS.md` document the CLI surface for all planning agents. Always pass `--json` on board commands. When the user names a git branch for work, pass `--source-branch` on each related `fluxx tasks create`. `fluxx tasks delete` requires `--confirm` after explicit user intent.

Planning automation uses the loopback HTTP bridge and packaged `fluxx` CLI only (no built-in Fluxx MCP server on port 47432). Project MCP config remains available for external provider servers, such as Datadog or Atlassian: Project Config → MCP servers → Add MCP accepts either a full `{ "mcpServers": { ... } }` config or a single `"name": { ... }` server entry. Fluxx does not inject a reserved board MCP server into `mcp.json`; planning agents use the CLI for Fluxx board operations.

---

## License

MIT
