import fs from 'node:fs/promises';
import path from 'node:path';
import { getValidationPackById } from './registry';
import { loadValidationPacksProjectConfig } from './projectConfig';
import { buildValidationPackInstructions } from './buildInstructions';
import { renderValidateElectronTemplate } from './renderValidateElectronTemplate';
import type { ValidationPackId, ValidationPackScaffoldContext } from './types';

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function writeIfMissing(filePath: string, body: string): Promise<void> {
  if (await pathExists(filePath)) return;
  await fs.writeFile(filePath, body, 'utf8');
}

export type ScaffoldValidationRunFilesInput = {
  packId: ValidationPackId;
  runId: string;
  runDir: string;
  projectDir: string;
  worktreeCwd?: string;
};

/**
 * Seeds `instructions.md`, `validate-electron.mjs`, and empty `plan.json` for a new run.
 */
export async function scaffoldValidationRunFiles(
  input: ScaffoldValidationRunFilesInput,
): Promise<{ instructionsMarkdown: string }> {
  const pack = getValidationPackById(input.packId);
  if (!pack) {
    throw new Error(`Unknown validation pack: ${input.packId}`);
  }
  const projectConfig = loadValidationPacksProjectConfig(input.projectDir, input.packId);
  const ctx: ValidationPackScaffoldContext = {
    runId: input.runId,
    runDir: input.runDir,
    ...(input.worktreeCwd ? { worktreeCwd: input.worktreeCwd } : {}),
    ...(projectConfig ? { projectConfig } : {}),
  };
  const instructionsMarkdown = buildValidationPackInstructions(pack, projectConfig);
  const scriptBody = renderValidateElectronTemplate(pack.validateElectronTemplate, ctx);

  await writeIfMissing(path.join(input.runDir, 'plan.json'), '{}\n');
  await writeIfMissing(path.join(input.runDir, 'instructions.md'), instructionsMarkdown);
  await writeIfMissing(path.join(input.runDir, 'validate-electron.mjs'), scriptBody);

  return { instructionsMarkdown };
}
