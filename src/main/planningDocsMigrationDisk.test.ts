import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LEGACY_PLANNING_CLOUD_DOCS_MIGRATION_BASENAME } from '../planningDocs/fluxxPlanningPaths';
import {
  readPlanningDocsCloudMigrationState,
  writePlanningDocsCloudMigrationState,
} from './planningDocsMigrationDisk';

describe('planningDocsMigrationDisk fluxx paths', () => {
  let planningDir = '';

  afterEach(async () => {
    if (planningDir) {
      await fs.rm(planningDir, { recursive: true, force: true });
      planningDir = '';
    }
  });

  it('reads legacy migration state and writes .fluxx-cloud-docs-migration.json', async () => {
    planningDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fluxx-planning-migrate-'));
    await fs.writeFile(
      path.join(planningDir, LEGACY_PLANNING_CLOUD_DOCS_MIGRATION_BASENAME),
      `${JSON.stringify({ version: 1, cloudProjectId: 'team-1', didInitialHydrateFromCloud: true })}\n`,
      'utf8',
    );

    const read = await readPlanningDocsCloudMigrationState(planningDir, 'team-1');
    expect(read?.didInitialHydrateFromCloud).toBe(true);

    await writePlanningDocsCloudMigrationState(planningDir, {
      version: 1,
      cloudProjectId: 'team-1',
      seedOfferResolved: true,
    });
    await expect(
      fs.readFile(path.join(planningDir, '.fluxx-cloud-docs-migration.json'), 'utf8'),
    ).resolves.toContain('"seedOfferResolved": true');
  });
});
