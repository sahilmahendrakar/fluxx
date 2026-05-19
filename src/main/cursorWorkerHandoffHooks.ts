import fs from 'node:fs/promises';
import path from 'node:path';
import { FLUXX_CLI_BRIDGE_CONFIG_REL } from '../fluxCliBridgeConfig';
import { FLUXX_WORKER_HANDOFF_JSON_REL } from '../taskAgentWorkerHandoffPrompt';

/** Flux-written session manifest for the stop hook (not committed). */
export const FLUXX_WORKER_HANDOFF_SESSION_REL = '.cursor/.fluxx-worker-handoff-session.json';

/** Relative command path registered in hooks.json (from worktree root). */
export const FLUXX_WORKER_HANDOFF_HOOK_COMMAND = '.cursor/hooks/fluxx-submit-worker-handoff.sh';

const HOOK_SCRIPT_BASENAME = 'fluxx-submit-worker-handoff.sh';

export interface FluxxWorkerHandoffSessionManifest {
  version: 1;
  taskId: string;
  bridgeConfigPath: string;
  handoffJsonRel: string;
  fluxCliBinDir?: string;
  fluxElectronExe?: string;
}

export interface CursorHooksFile {
  version: number;
  hooks: Record<string, Array<{ command: string; timeout?: number }>>;
}

function errnoCode(err: unknown): string | undefined {
  return err && typeof err === 'object' && 'code' in err
    ? (err as NodeJS.ErrnoException).code
    : undefined;
}

/** Stop-hook script: read agent handoff file and call fluxx coordination submit-handoff. */
export function buildFluxxWorkerHandoffStopHookScript(): string {
  return `#!/usr/bin/env bash
# Fluxx worker handoff stop hook — submits structured handoff via fluxx CLI.
# Fail-safe: never blocks Cursor; hook errors are logged and exit 0.
set -u

log() { printf '%s\\n' "$1" >&2; }

WORKSPACE_ROOT="$(cd "$(dirname "\${BASH_SOURCE[0]}")/../.." && pwd)"
SESSION_PATH="$WORKSPACE_ROOT/${FLUXX_WORKER_HANDOFF_SESSION_REL}"
HANDOFF_PATH="$WORKSPACE_ROOT/${FLUXX_WORKER_HANDOFF_JSON_REL}"

INPUT="$(cat)"
STATUS="$(printf '%s' "$INPUT" | node -e 'const fs=require("fs");const s=fs.readFileSync(0,"utf8");try{process.stdout.write(String(JSON.parse(s).status||""))}catch{process.stdout.write("")}' 2>/dev/null || true)"

if [ "$STATUS" != "completed" ]; then
  exit 0
fi

if [ ! -f "$SESSION_PATH" ]; then
  log "[fluxx handoff hook] skip: missing session manifest at ${FLUXX_WORKER_HANDOFF_SESSION_REL}"
  exit 0
fi

if [ ! -f "$HANDOFF_PATH" ]; then
  log "[fluxx handoff hook] skip: no handoff file at ${FLUXX_WORKER_HANDOFF_JSON_REL} (write it before finishing, or use: fluxx coordination submit-handoff)"
  exit 0
fi

eval "$(node -e "
  const fs=require('fs');
  const path=require('path');
  const sessionPath=process.argv[1];
  const handoffPath=process.argv[2];
  let session;
  try {
    session=JSON.parse(fs.readFileSync(sessionPath,'utf8'));
  } catch (e) {
    console.error('[fluxx handoff hook] invalid session manifest JSON');
    process.exit(0);
  }
  const taskId=String(session.taskId||'').trim();
  if (!taskId) {
    console.error('[fluxx handoff hook] session manifest missing taskId');
    process.exit(0);
  }
  const bridgePath=String(session.bridgeConfigPath||'').trim();
  if (!bridgePath || !fs.existsSync(bridgePath)) {
    console.error('[fluxx handoff hook] bridge config not found; start the task from Fluxx');
    process.exit(0);
  }
  let bridge;
  try {
    bridge=JSON.parse(fs.readFileSync(bridgePath,'utf8'));
  } catch {
    console.error('[fluxx handoff hook] invalid bridge config JSON');
    process.exit(0);
  }
  const url=String(bridge.url||'').trim();
  const token=String(bridge.token||'').trim();
  const key=bridge.expectedActiveKey;
  if (!url || !token || !key || typeof key.kind!=='string' || typeof key.id!=='string') {
    console.error('[fluxx handoff hook] bridge config incomplete');
    process.exit(0);
  }
  let handoffRaw;
  try {
    handoffRaw=fs.readFileSync(handoffPath,'utf8').trim();
    JSON.parse(handoffRaw);
  } catch {
    console.error('[fluxx handoff hook] handoff file is missing or not valid JSON');
    process.exit(0);
  }
  const sh=(v)=>\"'\"+String(v).replace(/'/g,\"'\\\\\"'\\\\\"'\")+\"'\";
  console.log('export FLUXX_AUTOMATION_URL='+sh(url));
  console.log('export FLUXX_AUTOMATION_TOKEN='+sh(token));
  console.log('export FLUXX_AUTOMATION_EXPECTED_ACTIVE_KEY='+sh(JSON.stringify(key)));
  console.log('export FLUX_AUTOMATION_URL='+sh(url));
  console.log('export FLUX_AUTOMATION_TOKEN='+sh(token));
  console.log('export FLUX_AUTOMATION_EXPECTED_ACTIVE_KEY='+sh(JSON.stringify(key)));
  const binDir=String(session.fluxCliBinDir||'').trim();
  if (binDir) console.log('export PATH='+sh(binDir+path.delimiter+process.env.PATH));
  const electron=String(session.fluxElectronExe||'').trim();
  if (electron) {
    console.log('export FLUXX_ELECTRON_EXE='+sh(electron));
    console.log('export FLUX_ELECTRON_EXE='+sh(electron));
  }
  console.log('FLUXX_TASK_ID='+sh(taskId));
  console.log('FLUXX_HANDOFF_JSON='+sh(handoffRaw));
" "$SESSION_PATH" "$HANDOFF_PATH")" || exit 0

FLUXX_BIN="$(command -v fluxx 2>/dev/null || command -v flux 2>/dev/null || true)"
if [ -z "$FLUXX_BIN" ]; then
  log "[fluxx handoff hook] fluxx CLI not on PATH; use manual: fluxx coordination submit-handoff --task-id <id> --handoff-json file://${FLUXX_WORKER_HANDOFF_JSON_REL}"
  exit 0
fi

set +e
RESULT="$("$FLUXX_BIN" coordination submit-handoff --json --task-id "$FLUXX_TASK_ID" --handoff-json "$FLUXX_HANDOFF_JSON" 2>&1)"
CODE=$?
set -e

if [ "$CODE" -ne 0 ]; then
  log "[fluxx handoff hook] submit-handoff failed (exit $CODE): $RESULT"
  exit 0
fi

if ! printf '%s' "$RESULT" | node -e 'const fs=require("fs");const s=fs.readFileSync(0,"utf8");try{const j=JSON.parse(s);if(j.ok===true)process.exit(0);const msg=j.error||j.message||"unknown error";console.error("[fluxx handoff hook] "+msg);process.exit(1)}catch{console.error("[fluxx handoff hook] non-JSON CLI response");process.exit(1)}'; then
  exit 0
fi

# Best-effort: avoid duplicate submission on a later stop.
mv "$HANDOFF_PATH" "$HANDOFF_PATH.submitted" 2>/dev/null || true
exit 0
`;
}

export function defaultCursorHooksForWorkerHandoff(): CursorHooksFile {
  return {
    version: 1,
    hooks: {
      stop: [
        {
          command: FLUXX_WORKER_HANDOFF_HOOK_COMMAND,
          timeout: 30,
        },
      ],
    },
  };
}

function parseHooksFile(raw: string): CursorHooksFile | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const version = (parsed as { version?: unknown }).version;
    const hooks = (parsed as { hooks?: unknown }).hooks;
    if (typeof version !== 'number' || !hooks || typeof hooks !== 'object') {
      return null;
    }
    return parsed as CursorHooksFile;
  } catch {
    return null;
  }
}

function mergeStopHook(existing: CursorHooksFile): CursorHooksFile {
  const fluxHook = { command: FLUXX_WORKER_HANDOFF_HOOK_COMMAND, timeout: 30 };
  const stop = [...(existing.hooks.stop ?? [])];
  const already = stop.some((h) => h.command === fluxHook.command);
  if (!already) {
    stop.push(fluxHook);
  }
  return {
    version: 1,
    hooks: {
      ...existing.hooks,
      stop,
    },
  };
}

async function ensureWorktreeGitExclude(worktreePath: string, entries: string[]): Promise<void> {
  const excludePath = path.join(worktreePath, '.git', 'info', 'exclude');
  let existing = '';
  try {
    existing = await fs.readFile(excludePath, 'utf8');
  } catch (err: unknown) {
    if (errnoCode(err) !== 'ENOENT') {
      throw err;
    }
  }
  const lines = existing.split('\n');
  const have = new Set(lines.map((l) => l.trim()).filter(Boolean));
  const toAdd = entries.filter((e) => !have.has(e));
  if (toAdd.length === 0) {
    return;
  }
  const suffix = existing.endsWith('\n') || existing.length === 0 ? '' : '\n';
  const block = `${suffix}# Fluxx task session (do not commit)\n${toAdd.join('\n')}\n`;
  await fs.mkdir(path.dirname(excludePath), { recursive: true });
  await fs.writeFile(excludePath, existing + block, 'utf8');
}

export type MaterializeCursorWorkerHandoffHooksParams = {
  worktreePath: string;
  taskId: string;
  projectDir: string;
  fluxCliBinDir?: string;
  fluxElectronExe?: string;
};

/**
 * Writes Cursor stop-hook config and session manifest into a Flux task worktree.
 * Does not modify the user's repo tracked files (uses `.git/info/exclude` for `.cursor/`).
 */
export async function materializeCursorWorkerHandoffHooks(
  params: MaterializeCursorWorkerHandoffHooksParams,
): Promise<{ hooksJsonPath: string; hookScriptPath: string; sessionManifestPath: string }> {
  const cursorDir = path.join(params.worktreePath, '.cursor');
  const hooksDir = path.join(cursorDir, 'hooks');
  await fs.mkdir(hooksDir, { recursive: true });

  const hookScriptPath = path.join(hooksDir, HOOK_SCRIPT_BASENAME);
  await fs.writeFile(hookScriptPath, buildFluxxWorkerHandoffStopHookScript(), 'utf8');
  await fs.chmod(hookScriptPath, 0o755);

  const hooksJsonPath = path.join(cursorDir, 'hooks.json');
  let merged = defaultCursorHooksForWorkerHandoff();
  try {
    const existingRaw = await fs.readFile(hooksJsonPath, 'utf8');
    const existing = parseHooksFile(existingRaw);
    if (existing) {
      merged = mergeStopHook(existing);
    }
  } catch (err: unknown) {
    if (errnoCode(err) !== 'ENOENT') {
      throw err;
    }
  }
  await fs.writeFile(hooksJsonPath, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');

  const bridgeConfigPath = path.join(params.projectDir, FLUXX_CLI_BRIDGE_CONFIG_REL);
  const manifest: FluxxWorkerHandoffSessionManifest = {
    version: 1,
    taskId: params.taskId,
    bridgeConfigPath,
    handoffJsonRel: FLUXX_WORKER_HANDOFF_JSON_REL,
    ...(params.fluxCliBinDir ? { fluxCliBinDir: params.fluxCliBinDir } : {}),
    ...(params.fluxElectronExe ? { fluxElectronExe: params.fluxElectronExe } : {}),
  };
  const sessionManifestPath = path.join(params.worktreePath, FLUXX_WORKER_HANDOFF_SESSION_REL);
  await fs.writeFile(sessionManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  await ensureWorktreeGitExclude(params.worktreePath, ['.cursor/', '.fluxx/']);

  return { hooksJsonPath, hookScriptPath, sessionManifestPath };
}
