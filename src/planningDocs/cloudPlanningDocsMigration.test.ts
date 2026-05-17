import { describe, expect, it } from 'vitest';
import {
  buildFirestoreFirstHydrationPlan,
  classifyPlanningDocsMigrationScenario,
  extractPlanningInstructionManagedBodyForEquivalence,
  isUnderPlanningUnsyncedPrefix,
  localOnlyPlanningPaths,
  planningDocBodiesEquivalent,
  planningMarkdownEquivalentForSeededInstructions,
  PLANNING_CLOUD_UNSYNCED_PREFIX,
} from './cloudPlanningDocsMigration';
import {
  FLUX_PLANNING_INSTRUCTIONS_BEGIN_LEGACY,
  FLUX_PLANNING_INSTRUCTIONS_END_LEGACY,
  FLUXX_PLANNING_INSTRUCTIONS_BEGIN,
  FLUXX_PLANNING_INSTRUCTIONS_END,
} from './planningInstructionMarkers';

describe('classifyPlanningDocsMigrationScenario', () => {
  it('detects quadrants', () => {
    expect(
      classifyPlanningDocsMigrationScenario({ firestorePaths: [], localPaths: [] }),
    ).toBe('both_empty');
    expect(
      classifyPlanningDocsMigrationScenario({ firestorePaths: ['a.md'], localPaths: [] }),
    ).toBe('firestore_only');
    expect(
      classifyPlanningDocsMigrationScenario({ firestorePaths: [], localPaths: ['a.md'] }),
    ).toBe('local_only');
    expect(
      classifyPlanningDocsMigrationScenario({
        firestorePaths: ['a.md'],
        localPaths: ['b.md'],
      }),
    ).toBe('both_present');
  });
});

describe('planningMarkdownEquivalentForSeededInstructions', () => {
  it('ignores different embedded repo paths in backticks', () => {
    const a = 'Repo at `/Users/alice/proj` and tools.';
    const b = 'Repo at `/Users/bob/other` and tools.';
    expect(planningMarkdownEquivalentForSeededInstructions('CLAUDE.md', a, b)).toBe(true);
    expect(planningMarkdownEquivalentForSeededInstructions('notes/x.md', a, b)).toBe(false);
  });

  it('still distinguishes real instruction edits', () => {
    const a = 'Repo at `/a/x` — rule one';
    const b = 'Repo at `/b/y` — rule two';
    expect(planningMarkdownEquivalentForSeededInstructions('AGENTS.md', a, b)).toBe(false);
  });

  it('normalizes planning workspace title line', () => {
    const a = '# Planning workspace — foo\n\nBody `/p1`';
    const b = '# Planning workspace — bar\n\nBody `/p2`';
    expect(planningMarkdownEquivalentForSeededInstructions('CLAUDE.md', a, b)).toBe(true);
  });

  it('strips flux and fluxx template version comments before comparing', () => {
    const a = '<!-- flux-planning-template 1 -->\n\n# Planning workspace — x\n`/a`';
    const b = '<!-- fluxx-planning-template 2 -->\n\n# Planning workspace — y\n`/b`';
    expect(planningMarkdownEquivalentForSeededInstructions('CLAUDE.md', a, b)).toBe(true);
  });

  it('treats Fluxx marker-wrapped bodies as equivalent to plain managed inner', () => {
    const inner = '# Planning workspace — team\n\nSame `/repo/tools`';
    const wrapped = `${FLUXX_PLANNING_INSTRUCTIONS_BEGIN}\n${inner}\n${FLUXX_PLANNING_INSTRUCTIONS_END}`;
    expect(planningMarkdownEquivalentForSeededInstructions('CLAUDE.md', wrapped, inner)).toBe(true);
    expect(extractPlanningInstructionManagedBodyForEquivalence(wrapped)).toBe(inner);
  });

  it('still parses legacy Flux marker blocks for equivalence', () => {
    const inner = '# Planning workspace — team\n\nSame `/repo/tools`';
    const wrapped = `${FLUX_PLANNING_INSTRUCTIONS_BEGIN_LEGACY}\n${inner}\n${FLUX_PLANNING_INSTRUCTIONS_END_LEGACY}`;
    expect(extractPlanningInstructionManagedBodyForEquivalence(wrapped)).toBe(inner);
  });
});

describe('buildFirestoreFirstHydrationPlan', () => {
  it('backs up divergent local files and writes canonical set', () => {
    const remote = new Map([
      ['vision.md', 'remote'],
      ['CLAUDE.md', 'shared claude `/team`'],
    ]);
    const local = new Map([
      ['vision.md', 'local vision'],
      ['CLAUDE.md', 'shared claude `/mine`'],
      ['extra.md', 'only local'],
    ]);
    const plan = buildFirestoreFirstHydrationPlan({ remoteByPath: remote, localByPath: local });
    expect(plan.backups).toEqual([{ relativePath: 'vision.md', markdown: 'local vision' }]);
    expect(plan.writes).toEqual([
      { relativePath: 'vision.md', markdown: 'remote' },
      { relativePath: 'CLAUDE.md', markdown: 'shared claude `/team`' },
    ]);
  });

  it('skips remote docs under unsynced prefix', () => {
    const remote = new Map([
      [`${PLANNING_CLOUD_UNSYNCED_PREFIX}/x.md`, 'no'],
      ['ok.md', 'yes'],
    ]);
    const plan = buildFirestoreFirstHydrationPlan({ remoteByPath: remote, localByPath: new Map() });
    expect(plan.writes).toEqual([{ relativePath: 'ok.md', markdown: 'yes' }]);
  });
});

describe('planningDocBodiesEquivalent', () => {
  it('uses seeded instruction equivalence for CLAUDE.md', () => {
    expect(
      planningDocBodiesEquivalent('CLAUDE.md', 'x `/a`', 'x `/b`'),
    ).toBe(true);
    expect(planningDocBodiesEquivalent('vision.md', 'x `/a`', 'x `/b`')).toBe(false);
  });
});

describe('isUnderPlanningUnsyncedPrefix', () => {
  it('detects unsynced subtree', () => {
    expect(isUnderPlanningUnsyncedPrefix(`${PLANNING_CLOUD_UNSYNCED_PREFIX}/a.md`)).toBe(true);
    expect(isUnderPlanningUnsyncedPrefix('vision.md')).toBe(false);
  });
});

describe('localOnlyPlanningPaths', () => {
  it('lists local-only canonical paths', () => {
    expect(
      localOnlyPlanningPaths(new Set(['a.md']), ['a.md', 'b.md', `${PLANNING_CLOUD_UNSYNCED_PREFIX}/z.md`]),
    ).toEqual(['b.md']);
  });
});
