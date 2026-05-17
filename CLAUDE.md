# Fluxx repository — agent notes

## MCP `fluxx__list_tasks`

`fluxx__list_tasks` supports optional **`excludeStatuses`**: an array of board column ids (`backlog`, `in-progress`, `needs-input`, `done`). Tasks in those statuses are omitted from the tool result. Omit the field (or pass an empty array) to return the full board—the previous default. Example: `{ "excludeStatuses": ["done"] }` for active work only. Filtering happens in the Fluxx desktop app after tasks are loaded, for both local and cloud projects.

Planning workspaces created by Fluxx also ship `planning/AGENTS.md` (and `planning/CLAUDE.md`) with the same tool list; user planning markdown for the Docs UI and cloud sync lives under `planning/docs/**`. Keep assistant files aligned when editing guidance.

## Cloud planning-docs sync (maintainer model)

**Goal:** Cloud projects mirror team planning markdown from Firestore into `planning/docs/**` under the same on-disk `planning/` tree the planning agent uses for its cwd, with optimistic concurrency and recoverable conflicts.

**Authoritative source:** For cloud workspaces, Firestore collection `projects/{projectId}/planningDocs/{docId}` is the shared source of truth once migration completes. The desktop app writes mirrored `.md` under the worktree `planning/docs/` folder (legacy top-level markdown under `planning/` may still appear until migrated). Local-only projects never touch Firestore; they keep using disk as today.

**Provider selection:** `planningDocsProviderForActiveProject` in `src/planningDocs/selectPlanningDocsProvider.ts` routes IPC list/read to `FilesystemPlanningDocsProvider` (`local-disk`) for local keys and `CloudMirrorPlanningDocsProvider` (`cloud-workspace-mirror-disk`) for cloud keys. The mirror still reads the filesystem; hydration + pushes keep disk aligned with Firestore.

**Main IPC (see `src/main.ts`):** `planningDocs:list`, `planningDocs:read`, `planningDocs:applyFirestoreSnapshot`, push helpers (`planningDocs:listPushCandidates`, `planningDocs:recordPushSuccess`, `planningDocs:persistConflict`, `planningDocs:resolveConflict`), migration handles, and `planningDocs:revealSyncFolder`. The main process broadcasts `planningDocs:changed` after snapshot apply, conflict resolution, and migration hydration (`PlanningDocsWatcher` debounces filesystem events on the same channel).

**Disk sync metadata:** `planning/.fluxx-docs-sync/state.json` tracks per-path `remoteRevision`, `lastSyncedContentHash`, optional `pausedPushPaths` after a push conflict, and timestamps (legacy `.flux-docs-sync/` is still read when present). A one-time `planning/.fluxx-planning-user-docs-root-migration-v1.json` records when legacy top-level markdown was moved under `planning/docs/`. Conflict JSON artifacts live under `planning/.fluxx-docs-sync/conflicts/`. First-run backups / seed flow use `_flux_unsynced/` and persisted migration state (`src/planningDocs/cloudPlanningDocsMigration.ts`, `src/main/planningDocsMigrationDisk.ts`).

**Loop prevention / overwrite safety:** `applyFirestorePlanningDocsSnapshot` (`src/main/planningDocsFirestoreHydrate.ts`) only applies remote body when the file is missing, matches the last synced hash, or has no prior sync row—so a user’s unpushed local edits are not clobbered by a snapshot. Push candidates are discovered only under `planning/docs/**`; `.fluxx-docs-sync/` (and legacy `.flux-docs-sync/`), `_flux_unsynced/`, and paths paused for conflict are excluded (`src/main/planningDocsFirestorePush.ts`).

**Revision / conflicts:** Remote revisions are derived from `updatedAt` (`src/planningDocs/firestoreRevision.ts`). Renderer pushes use `runTransaction` with a base revision (`src/renderer/planningDocs/firestorePlanningDocs.ts`). Mismatches surface as recoverable conflicts (local artifact + paused push + optional Firestore `conflicts` subcollection append).

**Firestore security:** Rules for `planningDocs` live in `firestore.rules` (member read/write, `relativePath` immutable on update, size caps). **Indexes:** `firestore.indexes.json` has no extra composite indexes for `planningDocs`; the client loads the subcollection with defaults.

**Parsing:** Firestore row validation for bulk reads and push snapshot fields is centralized in `src/planningDocs/firestorePlanningDocParse.ts` (unit-tested).

### Release QA checklist (manual)

1. **Two teammates:** User A edits planning markdown (agent or editor); user B sees updates in the in-app Docs UI and on disk under `planning/docs/` after sync.
2. **Same-base conflict:** Two users edit the same file from the same revision; one push wins, the other gets a conflict with recovery (take remote / resume / mark merged).
3. **First-run:** (a) Empty Firestore + existing local docs → seed / migration path. (b) Populated Firestore + stale local → hydrate / `_flux_unsynced` backups as designed. (c) New teammate, empty local `planning/` → receives cloud docs only.
4. **Local projects unchanged:** No Firestore traffic; planning docs behave as plain disk.
5. **Scope:** Only user planning markdown under `planning/docs/**` participates in sync (legacy files directly under `planning/` are read/list compatible but not push roots); other files under `.flux/<project>/` are not uploaded as planning docs (push listing skips sync internals; non-`.md` is ignored by list providers).
