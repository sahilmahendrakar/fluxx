import fs from 'node:fs/promises';
import path from 'node:path';
import {
  parseTaskValidationPlan,
  taskValidationPlanToJson,
  type TaskValidationPlan,
} from './schema';

export type SnapshotValidationPlanResult =
  | { ok: true; plan: TaskValidationPlan; planJsonPath: string }
  | { ok: false; ignored: true; warning: string; planJsonPath?: string };

/**
 * Copies the current task validation plan into `<runDir>/plan.json`.
 * Invalid plans are not written; validation may proceed without them.
 */
export async function snapshotValidationPlanToRunDir(
  runDir: string,
  plan: unknown,
): Promise<SnapshotValidationPlanResult> {
  const planJsonPath = path.join(runDir, 'plan.json');
  if (plan == null) {
    return {
      ok: false,
      ignored: true,
      warning: 'No validation plan on this task.',
    };
  }
  const parsed = parseTaskValidationPlan(plan);
  if (!parsed.ok) {
    return {
      ok: false,
      ignored: true,
      warning: `Task validation plan is invalid and was ignored: ${parsed.error}`,
      planJsonPath,
    };
  }
  await fs.writeFile(planJsonPath, taskValidationPlanToJson(parsed.plan), 'utf8');
  return { ok: true, plan: parsed.plan, planJsonPath };
}
