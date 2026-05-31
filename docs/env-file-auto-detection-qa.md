# Env file auto-detection — validation QA

End-to-end validation for root-level env file auto-detection (v1). Complements automated coverage in:

- `src/repoEnvFiles.test.ts` — allowlist, exclusions, detection metadata, legacy migration
- `src/worktreeEnvFiles.test.ts` — resolve/copy pipeline, file copies (not symlinks)
- `src/main/repoEnvFileSettings.test.ts` — local vs cloud persistence boundaries
- `src/main/ProjectStore.test.ts` — add/bind detection, template exclusion
- `src/cloudRepoDiskSync.test.ts` — cloud materialized config uses metadata only
- `src/main/WorktreeService.integration.test.ts` — worktree seeding and reuse semantics

## Automated test command

```bash
pnpm exec vitest run \
  src/repoEnvFiles.test.ts \
  src/worktreeEnvFiles.test.ts \
  src/main/repoEnvFileSettings.test.ts \
  src/main/ProjectStore.test.ts \
  src/cloudRepoDiskSync.test.ts \
  src/main/WorktreeService.integration.test.ts
```

## Manual QA — local project

Use a throwaway git repo with real secrets you are comfortable editing locally.

### Setup

1. Create a test repo:
   ```bash
   mkdir -p /tmp/flux-env-qa/app && cd /tmp/flux-env-qa/app
   git init -b main
   printf 'ROOT_A=1\n' > .env
   printf 'ROOT_B=2\n' > .env.local
   printf 'EXAMPLE_ONLY=1\n' > .env.example
   git add .env.example && git commit -m 'init'
   ```
2. In Fluxx, **Add project** (or **Add repository**) pointing at `/tmp/flux-env-qa/app`.

### Add / bind

- [ ] Project Settings → repository row shows `.env` and `.env.local` as **found** and **enabled** by default.
- [ ] `.env.example` does **not** appear as an auto-enabled source (not in the allowlist).
- [ ] `config.json` under `~/.fluxx/projects/<id>/` contains `envFiles.sources` with enablement only — **no** `ROOT_A=1` or `ROOT_B=2` string values.

### Settings rescan

1. Change `.env` on disk (`ROOT_A=changed`).
2. Project Settings → **Rescan env files**.
- [ ] Detection timestamps / hashes refresh for changed files.
- [ ] Enablement toggles you set manually are preserved where configured.
- [ ] `config.json` still has no raw secret bodies.

### Task start → worktree

1. Create a task on this repo and start a session (worktree created).
2. Inspect the worktree path (shown in task/session UI or under `~/.fluxx/.../worktrees/`).
- [ ] Worktree contains `.env` and `.env.local` with the values **at task creation time**.
- [ ] Files are regular copies (not symlinks): `test ! -L .env` in the worktree.
- [ ] File mode is restrictive where the OS allows (`600` on macOS/Linux).

### Existing worktree unchanged

1. With the session worktree still present, edit the **source** repo `.env` again.
2. Start/resume the **same** task (reuse existing worktree).
- [ ] Worktree `.env` still shows the **original** snapshot, not the latest source edit.

### Legacy pasted env

1. On a separate test project, paste env vars in Settings (legacy textarea) with **no** root `.env` file.
2. Start a task.
- [ ] Worktree receives pasted contents via `.env` write path.
3. Add a root `.env` file matching pasted content, rescan, migrate when prompted.
- [ ] After migration, new tasks copy from the file; pasted `env` field is cleared from config.

## Manual QA — cloud project

Requires a cloud project and a bound clone on this machine.

### Bind + metadata locality

1. Bind the test repo clone for a cloud project.
2. Rescan env files from Project Settings.
- [ ] `~/.fluxx/localBindings.json` (or per-user bindings path) gains `envFiles` under the repo binding.
- [ ] Shared / materialized `config.json` for the cloud project has **no** `envFiles` secret bodies (metadata may appear only from local binding merge at runtime).
- [ ] A teammate’s machine does not receive your `.env` contents via Firestore project config.

### Task start

- [ ] New task worktrees on your machine receive enabled env files from **your** bound clone path.
- [ ] Disabling a file in settings prevents it from appearing in the next **new** worktree.

## Files intentionally excluded (v1)

Confirm these are **not** auto-enabled when present only at repo root:

| File | Expectation |
|------|-------------|
| `.env.example` | Ignored |
| `.env.sample` | Ignored |
| `.env.template` | Ignored |
| `.env.production` | Ignored |
| `apps/web/.env.local` (nested) | Ignored — root scan only |

## Follow-up (out of v1 scope)

Documented for product backlog; not required for this validation pass.

### Nested monorepo env files

- **Gap:** v1 scans only the bound repo root (`REPO_ENV_FILE_ALLOWLIST` at `repoRoot`). Packages such as `apps/web/.env.local` are ignored even when that package is the real dev target.
- **Follow-up:** Workspace-aware detection (pnpm/npm workspaces, Turborepo roots) with per-package enablement in Project Settings, and copy paths that preserve relative layout inside worktrees.

### Symlink / live-sharing mode

- **Current behavior:** `copyEnabledEnvFilesIntoWorktree` always copies files; worktrees get a stable snapshot at creation.
- **Follow-up:** Optional advanced setting to symlink selected env files to the bound clone for live edits, with clear warnings about cross-task leakage and agent mutations affecting the user checkout.

### Production env files

- `.env.production` remains excluded from auto-enable. If users need it, they must opt in explicitly after rescan (future UI) rather than default-on.

## Sign-off

| Area | Automated | Manual | Notes |
|------|-----------|--------|-------|
| Allowlist / exclusions | ✅ | ☐ | `repoEnvFiles.test.ts` |
| Legacy `RepoConfig.env` migration | ✅ | ☐ | `repoEnvFiles.test.ts`, `worktreeEnvFiles.test.ts` |
| Settings rescan + persistence | ✅ | ☐ | rescan hash + `envFilesWithEnablement`; `repoEnvFileSettings.test.ts` |
| Worktree copy + reuse | ✅ | ☐ | `worktreeEnvFiles.test.ts`, `WorktreeService.integration.test.ts` |
| Local `config.json` metadata only | ✅ | ☐ | `repoEnvFileSettings.test.ts`, `ProjectStore.test.ts` |
| Cloud `localBindings` metadata only | ✅ | ☐ | `repoEnvFileSettings.test.ts`, `cloudRepoDiskSync.test.ts` |
| Template/production not auto-enabled | ✅ | ☐ | `repoEnvFiles.test.ts`, `ProjectStore.test.ts` |

**Automated validation (2026-05-31):** all tests in the command above pass (`85` tests across `6` files at last run).

**Manual validation:** requires the Fluxx desktop app. Use the checklists in this doc; pre-create a throwaway repo with the Setup commands under *Manual QA — local project*.
