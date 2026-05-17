#!/usr/bin/env node
/**
 * Mechanical flux* → fluxx* identifier rebrand (src/ + vite env).
 * Run from repo root: node scripts/codemod-flux-to-fluxx-identifiers.mjs
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

const GLOBS = ['src', 'vite.main.config.ts', '.env.example'];

const REPLACEMENTS = [
  // module paths (after git mv)
  ["'./main/fluxBaseDir'", "'./main/fluxxBaseDir'"],
  ["'./fluxBaseDir'", "'./fluxxBaseDir'"],
  ["'./main/fluxTaskBranch'", "'./main/fluxxTaskBranch'"],
  ["'./fluxTaskBranch'", "'./fluxxTaskBranch'"],
  ["'./main/fluxTaskWorkBranchNaming'", "'./main/fluxxTaskWorkBranchNaming'"],
  ["'./fluxTaskWorkBranchNaming'", "'./fluxxTaskWorkBranchNaming'"],
  ["'./main/projectFluxRemoval'", "'./main/projectFluxxRemoval'"],
  ["'./projectFluxRemoval'", "'./projectFluxxRemoval'"],
  ['src/main/fluxTaskBranch.ts', 'src/main/fluxxTaskBranch.ts'],
  // IPC / events
  ['task:persistFluxWorkBranch', 'task:persistFluxxWorkBranch'],
  ['projects:removeFluxOwnedLocalState', 'projects:removeFluxxOwnedLocalState'],
  ['onPersistFluxWorkBranch', 'onPersistFluxxWorkBranch'],
  // functions (longest first)
  ['parseFluxWorkBranchField', 'parseFluxxWorkBranchField'],
  ['deleteFluxProjectMaterializationDir', 'deleteFluxxProjectMaterializationDir'],
  ['removeFluxOwnedLocalState', 'removeFluxxOwnedLocalState'],
  ['markWorkspaceDeletedForFluxSession', 'markWorkspaceDeletedForFluxxSession'],
  ['collectTakenFluxWorkBranchNames', 'collectTakenFluxxWorkBranchNames'],
  ['worktreePathSegmentsForFluxBranch', 'worktreePathSegmentsForFluxxBranch'],
  ['resolveFluxAuthorSlugForBranches', 'resolveFluxxAuthorSlugForBranches'],
  ['chooseFluxTaskWorkBranchName', 'chooseFluxxTaskWorkBranchName'],
  ['expectedFluxWorkBranchForTask', 'expectedFluxxWorkBranchForTask'],
  ['legacyFluxTaskWorkBranchName', 'legacyFluxxTaskWorkBranchName'],
  ['fluxTaskWorkBranchName', 'fluxxTaskWorkBranchName'],
  ['expectedTaskFluxWorkBranch', 'expectedTaskFluxxWorkBranch'],
  ['ensureFluxBaseDirMigrated', 'ensureFluxxBaseDirMigrated'],
  ['legacyFluxBaseDirPath', 'legacyFluxBaseDirPath'],
  ['fluxBaseDirPath', 'fluxxBaseDirPath'],
  ['fluxProjectDirOrNull', 'fluxxProjectDirOrNull'],
  // constants
  ['FLUX_LEGACY_CLOUD_SUBDIR', 'FLUXX_LEGACY_CLOUD_SUBDIR'],
  ['FLUX_PROJECTS_SUBDIR', 'FLUXX_PROJECTS_SUBDIR'],
  // fields / params
  ['fluxWorkBranch', 'fluxxWorkBranch'],
  ['fluxSessionId', 'fluxxSessionId'],
  ['fluxBaseDir', 'fluxxBaseDir'],
  // default git branch prefix (tests + legacy helpers)
  ['flux/task-', 'fluxx/task-'],
  // default author slug segment
  ["'flux-user'", "'fluxx-user'"],
  ['"flux-user"', '"fluxx-user"'],
  // env
  ['FLUX_APP_URL', 'FLUXX_APP_URL'],
];

async function* walkFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const ent of entries) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === '.git') continue;
      yield* walkFiles(p);
    } else if (/\.(ts|tsx|mjs|cjs|json)$/.test(ent.name) || ent.name === '.env.example') {
      yield p;
    }
  }
}

async function collectFiles() {
  const out = [];
  for (const rel of GLOBS) {
    const abs = path.join(ROOT, rel);
    try {
      const st = await fs.stat(abs);
      if (st.isDirectory()) {
        for await (const f of walkFiles(abs)) out.push(f);
      } else {
        out.push(abs);
      }
    } catch {
      /* skip */
    }
  }
  return out;
}

async function main() {
  const files = await collectFiles();
  let changed = 0;
  for (const file of files) {
    let text = await fs.readFile(file, 'utf8');
    const before = text;
    for (const [from, to] of REPLACEMENTS) {
      text = text.split(from).join(to);
    }
    if (text !== before) {
      await fs.writeFile(file, text);
      changed++;
      console.log('updated', path.relative(ROOT, file));
    }
  }
  console.log(`Done. ${changed} files updated.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
