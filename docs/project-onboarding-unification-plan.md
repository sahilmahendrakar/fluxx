# Project onboarding unification plan

> **Status:** Contract finalized (task 1 — implementation agents should not re-decide product flow).  
> **Feature label:** `project-onboarding`  
> **Feature branch:** `feature/project-onboarding`

## Goal

Fluxx exposes one **project** concept: named identity, optional repositories, optional team sync, board, and planning docs. Local-only and team-synced projects differ only in sync capabilities—not in creation shape or picker mental model.

Creation is **project-first** (name → repos → sync → optional invites → board), not folder-first.

---

## Implementation contract

Agents implementing onboarding MUST use this contract. Do not invent alternate wizard steps or required fields.

### `ProjectCreateInput` (renderer → main IPC)

```ts
/** Single creation payload for local-only and team-synced projects. */
export interface ProjectCreateInput {
  /** Required. 1–80 chars after trim; no leading/trailing whitespace stored. */
  name: string;

  /**
   * Local git repository roots selected during creation.
   * Each path must resolve to a directory containing `.git`.
   * May be empty — zero-repo projects are valid.
   */
  repos: ProjectCreateRepoInput[];

  /**
   * Required when `repos.length >= 1`.
   * Must match one of the stable `id` values assigned to entries in `repos`
   * (see {@link assignRepoIdsForCreate}).
   * Omitted when `repos` is empty.
   */
  primaryRepoId?: string;

  /** Whether the project syncs through Firestore or stays on this machine only. */
  syncMode: 'local-only' | 'team-synced';

  /**
   * Optional teammate emails when `syncMode === 'team-synced'`.
   * Invalid emails are rejected before create; duplicates are deduped.
   * Empty array and omission are equivalent (no invites sent).
   */
  teamInvites?: string[];

  /**
   * Agent / automation defaults. When omitted, use the same defaults as
   * {@link ProjectStore.materialiseProjectDir} today (claude-code, main branch, etc.).
   */
  planningDefaults?: ProjectPlanningDefaultsInput;
}

export interface ProjectCreateRepoInput {
  /** Absolute path to the git repo root on this machine. */
  rootPath: string;
  /** Optional display label; defaults to `basename(rootPath)`. */
  name?: string;
  /** Optional; defaults to `main`. */
  baseBranch?: string;
}

export interface ProjectPlanningDefaultsInput {
  planningAgent?: Agent;
  defaultTaskAgent?: Agent;
  // …same optional fields as ConfigFile agent prefs
}
```

### `ProjectCreateResult`

```ts
export type ProjectCreateResult =
  | { ok: true; project: LocalProject | CloudProject; projectDir: string }
  | { ok: false; error: ProjectCreateError };

export type ProjectCreateError =
  | 'NAME_REQUIRED'
  | 'NAME_TOO_LONG'
  | 'NOT_GIT_REPO'           // one of repos failed .git check
  | 'DUPLICATE_REPO_PATH'    // same rootPath twice in input
  | 'PRIMARY_REPO_REQUIRED'  // repos non-empty but primaryRepoId missing/invalid
  | 'AUTH_REQUIRED'          // team-synced without signed-in user
  | 'INVITE_INVALID_EMAIL'
  | 'CREATE_FAILED';         // unexpected; surface message
```

### Validation rules (normative)

| Rule | Behavior |
|------|----------|
| Name | Trim; reject empty; max 80 characters. |
| Repos | Each `rootPath` resolved; must pass `assertGitRepoRoot`. Dedupe by resolved path. |
| Primary | If `repos.length === 0`, `primaryRepoId` MUST be omitted. If `repos.length >= 1`, `primaryRepoId` MUST be set and MUST match a repo id after id assignment. |
| Default primary | If exactly one repo and `primaryRepoId` omitted, implementation MAY default to that repo’s id (UI should still send it explicitly). |
| Sync | `team-synced` requires authenticated Firebase user; creates Firestore `projects/{id}` + owner `members/{uid}`. |
| Invites | Only when `team-synced`; send after project doc exists; failures on individual invites do not roll back project create (surface partial success in UI). |
| Planning init | **Not** part of create input. Handled post-board (see below). |

### Repo id assignment at create

Use existing helpers — do not invent new id schemes:

- Local: `deriveStablePrimaryRepoIdForProject({ projectId, rootPath })` for the primary repo; `deriveRepoIdForRootPath` / `backfillRepoIdentities` for additional repos (`src/repoIdentity.ts`).
- Cloud shared repos: stable `id` per repo record in Firestore `projects/{id}.repos[]`; machine bindings in `localBindings.json` keyed by that id.

### Project identity vs repository bindings

| Concern | Local-only | Team-synced |
|---------|------------|-------------|
| Project id | Random UUID v4 in `config.json` when no repos at create; else retain `stableLocalProjectIdForRoot(primaryRoot)` for migration compatibility when the primary repo path is known at create. | Firestore auto-id (`addDoc`). |
| Display name | `config.json` `name` (user-provided). | Firestore `name`. |
| Repo list | `config.json` `repos[]` | Firestore `repos[]` (`CloudSharedRepo`) |
| Local clones | Paths inside `repos[].rootPath` | `localBindings.json` → `repoBindings[repoId].rootPath` |
| Materialization dir | `~/.fluxx/projects/<projectId>/` | Same layout under `~/.fluxx/projects/<cloudProjectId>/` (legacy `cloud-projects/` paths still honored on open). |
| `rootPath` field | Primary repo clone path, or **project materialization directory** when `repos` is empty (planning-only workspace). | Primary bound clone, or materialization dir when no bindings yet. |

**Separation principle:** Changing repos (add/remove/rebind) never changes `project.id`. Renaming the project never changes repo ids.

### IPC surface (target)

Replace `projects:addLocal` (folder-first) and the name-only `createCloudProject` renderer path with one handler:

```ts
// main
ipcMain.handle('projects:create', async (_e, input: ProjectCreateInput) => ProjectCreateResult);

// preload
projects: {
  create: (input: ProjectCreateInput) => Promise<ProjectCreateResult>;
}
```

Keep `projects:addRepoAt`, `projects:pickDirectoryForCloud`, and settings repo UI for **add-repo-later** after creation.

### Create pipeline (ordered steps)

1. Validate `ProjectCreateInput`.
2. Allocate `projectId` (local UUID or Firestore doc).
3. Materialize `~/.fluxx/projects/<projectId>/` (planning/, worktrees/, config.json).
4. Persist repos + name + agent defaults.
5. If `team-synced`: write Firestore project + owner member; write shared `repos` if any; queue invites.
6. If `team-synced` and repos non-empty: write `localBindings.json` repo bindings for this machine (no extra “pick project folder” step).
7. Set `onboarding.planningInit = 'pending'` for **new** projects (see persistence).
8. Activate project and return `{ ok: true, project, projectDir }`.

**Post-conditions:** User lands on the **board** for the new project. Planning initialization is offered only after step 8.

---

## UX copy and behavior by scenario

### Entry: project picker

| Element | Copy |
|---------|------|
| Primary action | **New project** (replaces separate “+ Add project” / “Create team project” as the only create entry when signed in; signed-out users see **New project** for local-only only). |
| Unified list section title | **Projects** (not “Local projects” / “Team projects” split). |
| Row badge — local | `Local` |
| Row badge — team | `Team synced` |
| Row badge — pending invite | `Invited` |
| Row badge — team, no local clone for primary | `Needs repo` (opens repo binding, not a generic project folder picker) |
| Row secondary line | Member count for team; monospace path for local (primary repo path or “No repository yet”). |

### Screen 1 — Create project (always)

| Field | Copy / behavior |
|-------|-----------------|
| Title | **New project** |
| Name label | **Project name** |
| Name placeholder | `e.g. Payments redesign` |
| Repos section label | **Repositories** |
| Repos helper | `Attach git repositories now, or add them later in project settings.` |
| Add repo button | **Add repository** → native folder picker; title `Add repository`; validates `.git`. |
| Repo list empty | `No repositories attached.` |
| Repo error (not git) | `That folder isn’t a git repository. Run git init first.` |
| Primary selector | Shown only when **2+** repos: label **Primary repository**; helper `Used for default task workspaces and planning context.` |
| Sync toggle label | **Team sync** |
| Sync toggle helper — off | `Keep this project on this device only.` |
| Sync toggle helper — on | `Share tasks and planning docs with teammates.` |
| Primary CTA | **Create project** (disabled until name non-empty). |
| Cancel | **Cancel** |

### Screen 2 — Invite teammates (only if team sync on)

| Element | Copy |
|---------|------|
| Title | **Invite teammates** |
| Helper | `Optional. Teammates receive an email invite to this project.` |
| Email field placeholder | `name@company.com` |
| Add another | **Add another** |
| Skip | **Skip for now** (same as continuing with zero invites) |
| CTA | **Create project** (if invites are collected on this screen) **or** **Send invites** then land on board — product choice: **Skip for now** and **Send invites** both end on board; invites send async. |

**Normative:** Invites never block creation. If the user enables team sync and taps **Create project** on screen 1, screen 2 is skippable; skipping creates the project with zero invites.

### After create — board planning prompt (non-blocking)

| Element | Copy |
|---------|------|
| Callout title | **Initialize project context?** |
| Body | `Start the planning assistant to draft vision and architecture docs from your repos and goals.` |
| Primary | **Start planning assistant** |
| Secondary | **Skip** |
| Dismiss scope | Per project, persisted (see below). |

**Injected planning prompt** (unchanged from prior plan):

```text
We just created this Fluxx project. Please help initialize the project context.

Your goals:
- Read the attached repositories and any existing planning files.
- Ask the user a small number of focused questions about product vision, architecture, constraints, and near-term goals.
- Create or update planning/vision.md with the product purpose, target users, key workflows, non-goals, and success criteria.
- Create or update planning/architecture.md with the system shape, important components, data/storage boundaries, repo layout, build/test commands, and known risks.
- Keep the docs concise, accurate, and useful for future agents.

Do not start implementation work unless the user explicitly asks.
```

### Scenario matrix

| Scenario | Screen 1 | Screen 2 | Board | Repo-dependent actions |
|----------|----------|----------|-------|-------------------------|
| Local, zero repos | Name only, no repos | — | Opens; planning prompt shown | Task **Start session** disabled with inline reason: `Add a repository in project settings to run task sessions.` |
| Local, one repo | Name + one repo | — | Opens | Full functionality |
| Local, multi-repo | Name + repos + primary | — | Opens | Full functionality |
| Team, zero repos | Name + sync on | Optional invites | Opens | Same empty-repo gating; Firestore has no shared repos yet |
| Team, one/many repos | Name + repos + primary + sync | Optional invites | Opens | Bindings written for selected local paths; teammates bind per-repo later |
| Add repo later | — | — | — | Project Settings → **Repositories** → **Add repository** (existing `addRepoAt` / cloud shared repo + bind flow) |

---

## Legacy mapping: folder-first → project-first

### Today (pre-unification)

| Path | Behavior |
|------|----------|
| Local **+ Add project** | Opens folder picker immediately → `ProjectStore.create(rootPath)` → name = `basename(rootPath)`. |
| Team **Create team project** | Name modal only → Firestore doc → folder picker on first open. |

### Target mapping

| Legacy user action | New equivalent |
|--------------------|----------------|
| Pick folder first | **New project** → enter name → **Add repository** (same picker) → **Create project**. |
| Team name only | **New project** → name → enable **Team sync** → **Create project** (no folder until repos added or bound). |
| Open existing local row | Unchanged; no re-prompt for planning init. |
| Open team project without binding | **Needs repo** badge → per-repo bind UI (not “pick project folder”). |

### Existing project data

- **Do not** rename or re-id existing projects on upgrade.
- **Do not** show the planning initialization callout for projects whose `config.json` / Firestore `createdAt` predates the onboarding feature flag, unless `onboarding.planningInit` is explicitly `pending`.
- Local projects keep stored `name` even when it was derived from `basename(rootPath)`; users may rename in settings later.

---

## Planning initialization state

### States

```ts
type PlanningInitStatus = 'pending' | 'dismissed' | 'completed';
```

| State | Board callout | Re-show |
|-------|---------------|---------|
| `pending` | Shown | — |
| `dismissed` | Hidden | User may start planning assistant manually from nav; optional “Reset onboarding tip” in settings (future). |
| `completed` | Hidden | Set when planning session starts from the callout **or** when `planning/docs/vision.md` and `planning/docs/architecture.md` both exist and are non-empty after a planning-init session. |

### Persistence

Store alongside project materialization (not in Firestore for local-only):

**File:** `~/.fluxx/projects/<projectId>/onboarding.json`

```json
{
  "planningInit": "pending",
  "planningInitUpdatedAt": "2026-05-17T12:00:00.000Z",
  "createdWithOnboardingV2": true
}
```

For **team-synced** projects, mirror the same file on each machine (per-machine UX preference). Do not sync this blob through Firestore in v1 — teammates may dismiss independently.

**Transitions:**

- Create project → `pending`
- User clicks **Skip** → `dismissed`
- User clicks **Start planning assistant** → open session; on session end if goals met → `completed`, else remain `pending` (callout may reappear next board visit until dismissed or completed)
- Existing projects (no file) → treat as `dismissed` (no callout)

---

## Migration and compatibility

### Must preserve

- Opening existing local and cloud projects without re-creation.
- `~/.fluxx/projects/<id>/` canonical layout and legacy `cloud-projects/` / basename dir migration (`projectDirLayout.ts`).
- `config.json` `repos[]` and `localBindings.json` `repoBindings` multi-repo model.
- Projects with tasks/worktrees: defer destructive dir migration (existing `shouldDeferLegacyMigrationForWorktrees` behavior).

### Implementation allowances

| Topic | Decision |
|-------|----------|
| Zero-repo `config.json` | `repos: []`; `rootPath` = materialized project directory until first repo added. |
| Local project id when repos at create | Prefer `stableLocalProjectIdForRoot(primary)` when primary path known (stable re-open). Use random UUID when `repos` empty at create. |
| Cloud create without repos | Firestore project without `repos` field or `repos: []`; no `pickDirectoryForCloud` on create. |
| Cloud open without binding | Show **Needs repo** in picker; bind per shared repo id. |
| Sign-in optional | `syncMode: 'team-synced'` disabled in UI when signed out; local-only still available. |
| Invites | Reuse `InviteTeammateModal` / `acceptInvite` transaction; email send failures are non-fatal. |

### Explicitly out of scope (v1)

- Migrating old “folder-first” mental model copy in README (separate docs task).
- Firestore-synced onboarding dismiss state across machines.
- Forcing repo attachment at create time.
- Planning initialization inside the creation wizard.

---

## Suggested implementation task order

1. ~~Finalize unified project model and creation contract~~ (this document).
2. `projects:create` IPC + `ProjectStore.createFromInput` (local paths).
3. Cloud Firestore create + shared repos + bindings from input.
4. Unified **New project** wizard UI (screens 1–2).
5. Unified project picker + badges.
6. Empty-repo gating on board / task start.
7. Board planning callout + `onboarding.json` + injected prompt.
8. QA matrix per scenario table above.

---

## Acceptance criteria (contract)

- [x] Implementation contract is explicit (`ProjectCreateInput`, validation, IPC, pipeline).
- [x] Project identity is separate from repository bindings.
- [x] Covers zero / one / many repos, team invites, add-repo-later.
- [x] Planning initialization is post-creation, non-blocking, with persistence rules.
- [x] Legacy folder-first and existing projects are mapped without forced re-onboarding.
