import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { snapshotValidationPlanToRunDir } from './snapshotPlan';

describe('validationPlans/snapshotPlan', () => {
  let tmp = '';

  afterEach(async () => {
    if (tmp) await fs.rm(tmp, { recursive: true, force: true });
    tmp = '';
  });

  it('writes plan.json for valid plans and ignores invalid ones', async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'fluxx-val-plan-'));
    const valid = {
      goal: 'Verify tab',
      pack: 'electron-playwright',
      checks: ['Open details'],
      requiredArtifacts: ['shot'],
    };
    const ok = await snapshotValidationPlanToRunDir(tmp, valid);
    expect(ok.ok).toBe(true);
    const raw = await fs.readFile(path.join(tmp, 'plan.json'), 'utf8');
    expect(raw).toContain('Verify tab');

    const bad = await snapshotValidationPlanToRunDir(tmp, { goal: 'x', pack: 'nope', checks: [] });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.ignored).toBe(true);
  });
});
