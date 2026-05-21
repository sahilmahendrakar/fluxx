import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getPlanningInitStatus,
  planningDocsAreInitialized,
  shouldShowPlanningInitCallout,
  writeOnboardingPending,
} from './projectOnboarding';
import { planningUserDocsDir } from '../planningDocs/path';

describe('projectOnboarding', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
  });

  async function tempProjectDir(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fluxx-onboarding-'));
    dirs.push(dir);
    return dir;
  }

  it('treats missing onboarding.json as dismissed', async () => {
    expect(await getPlanningInitStatus(await tempProjectDir())).toBe('dismissed');
  });

  it('shouldShowPlanningInitCallout only for pending without initialized docs', () => {
    expect(shouldShowPlanningInitCallout('pending', false)).toBe(true);
    expect(shouldShowPlanningInitCallout('pending', true)).toBe(false);
    expect(shouldShowPlanningInitCallout('dismissed', false)).toBe(false);
  });

  it('writeOnboardingPending sets pending status', async () => {
    const projectDir = await tempProjectDir();
    await writeOnboardingPending(projectDir);
    expect(await getPlanningInitStatus(projectDir)).toBe('pending');
  });

  it('planningDocsAreInitialized checks docs/ paths', async () => {
    const projectDir = await tempProjectDir();
    const planningDir = path.join(projectDir, 'planning');
    const docsDir = planningUserDocsDir(planningDir);
    await fs.mkdir(docsDir, { recursive: true });
    await fs.writeFile(path.join(docsDir, 'vision.md'), '# Vision\n', 'utf8');
    await fs.writeFile(path.join(docsDir, 'architecture.md'), '# Arch\n', 'utf8');
    expect(await planningDocsAreInitialized(planningDir)).toBe(true);
  });
});
