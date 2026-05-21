import fs from 'node:fs/promises';
import path from 'node:path';
import { planningUserDocsDir } from '../planningDocs/path';

export type PlanningInitStatus = 'pending' | 'dismissed' | 'started' | 'completed';

export interface ProjectOnboardingFile {
  planningInit: PlanningInitStatus;
  planningInitUpdatedAt: string;
  createdWithOnboardingV2: boolean;
}

export const ONBOARDING_FILE_BASENAME = 'onboarding.json';

function isValidPlanningInitStatus(value: unknown): value is PlanningInitStatus {
  return (
    value === 'pending' ||
    value === 'dismissed' ||
    value === 'started' ||
    value === 'completed'
  );
}

export function onboardingFilePath(projectDir: string): string {
  return path.join(projectDir, ONBOARDING_FILE_BASENAME);
}

export async function readOnboardingFile(
  projectDir: string,
): Promise<ProjectOnboardingFile | null> {
  try {
    const raw = await fs.readFile(onboardingFilePath(projectDir), 'utf8');
    const parsed = JSON.parse(raw) as Partial<ProjectOnboardingFile>;
    if (!isValidPlanningInitStatus(parsed.planningInit)) return null;
    if (typeof parsed.planningInitUpdatedAt !== 'string') return null;
    return {
      planningInit: parsed.planningInit,
      planningInitUpdatedAt: parsed.planningInitUpdatedAt,
      createdWithOnboardingV2: parsed.createdWithOnboardingV2 === true,
    };
  } catch (err: unknown) {
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      return null;
    }
    return null;
  }
}

/** Existing projects without onboarding.json are treated as dismissed (no callout). */
export async function getPlanningInitStatus(projectDir: string): Promise<PlanningInitStatus> {
  const file = await readOnboardingFile(projectDir);
  return file?.planningInit ?? 'dismissed';
}

export async function setPlanningInitStatus(
  projectDir: string,
  status: PlanningInitStatus,
): Promise<void> {
  const existing = await readOnboardingFile(projectDir);
  const payload: ProjectOnboardingFile = {
    planningInit: status,
    planningInitUpdatedAt: new Date().toISOString(),
    createdWithOnboardingV2: existing?.createdWithOnboardingV2 ?? true,
  };
  await fs.mkdir(projectDir, { recursive: true });
  await fs.writeFile(
    onboardingFilePath(projectDir),
    `${JSON.stringify(payload, null, 2)}\n`,
    'utf8',
  );
}

export async function writeOnboardingPending(projectDir: string): Promise<void> {
  await setPlanningInitStatus(projectDir, 'pending');
}

async function markdownFileHasContent(filePath: string): Promise<boolean> {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return content.trim().length > 0;
  } catch {
    return false;
  }
}

async function docExistsWithContent(
  planningDir: string,
  basename: string,
): Promise<boolean> {
  const docsDir = planningUserDocsDir(planningDir);
  if (await markdownFileHasContent(path.join(docsDir, basename))) return true;
  if (await markdownFileHasContent(path.join(planningDir, basename))) return true;
  return false;
}

/** True when both vision and architecture planning docs exist with non-empty bodies. */
export async function planningDocsAreInitialized(planningDir: string): Promise<boolean> {
  const [hasVision, hasArchitecture] = await Promise.all([
    docExistsWithContent(planningDir, 'vision.md'),
    docExistsWithContent(planningDir, 'architecture.md'),
  ]);
  return hasVision && hasArchitecture;
}

export function shouldShowPlanningInitCallout(
  status: PlanningInitStatus,
  docsInitialized: boolean,
): boolean {
  return status === 'pending' && !docsInitialized;
}
