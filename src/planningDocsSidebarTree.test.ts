import { describe, expect, it } from 'vitest';
import {
  buildPlanningDocsSidebarLayout,
  collectPlanningDocFolderPaths,
  planningDocSidebarFileLabel,
  type PlanningDocsSidebarTreeNode,
} from './planningDocsSidebarTree';
import type { PlanningDocFileEntry } from './planningDocs/types';

function file(relativePath: string): PlanningDocFileEntry {
  return { relativePath };
}

function folderPaths(nodes: PlanningDocsSidebarTreeNode[]): string[] {
  return collectPlanningDocFolderPaths(nodes);
}

describe('buildPlanningDocsSidebarLayout', () => {
  it('returns flat layout for root-level files only', () => {
    const layout = buildPlanningDocsSidebarLayout([
      file('vision.md'),
      file('architecture.md'),
    ]);
    expect(layout).toEqual({
      kind: 'flat',
      files: [file('architecture.md'), file('vision.md')],
    });
  });

  it('builds nested folder tree with segment labels', () => {
    const layout = buildPlanningDocsSidebarLayout([
      file('vision.md'),
      file('design-docs/active/cloud-agents-plan.md'),
      file('design-docs/backlog/bar.md'),
      file('sprints/sprint-1.md'),
    ]);
    expect(layout.kind).toBe('tree');
    if (layout.kind !== 'tree') return;

    expect(layout.nodes.map((n) => n.kind)).toEqual(['folder', 'folder', 'file']);

    const rootFile = layout.nodes.find((n) => n.kind === 'file');
    expect(rootFile?.kind).toBe('file');
    if (rootFile?.kind === 'file') {
      expect(rootFile.file.relativePath).toBe('vision.md');
    }

    const designDocs = layout.nodes.find((n) => n.kind === 'folder' && n.segment === 'design-docs');
    expect(designDocs?.kind).toBe('folder');
    if (designDocs?.kind === 'folder') {
      expect(designDocs.folderPath).toBe('design-docs');
      expect(designDocs.children.map((c) => c.kind)).toEqual(['folder', 'folder']);
      const active = designDocs.children.find((c) => c.kind === 'folder' && c.segment === 'active');
      expect(active?.kind).toBe('folder');
      if (active?.kind === 'folder') {
        expect(active.folderPath).toBe('design-docs/active');
        expect(active.children).toEqual([
          { kind: 'file', file: file('design-docs/active/cloud-agents-plan.md') },
        ]);
      }
    }
  });

  it('unwraps a single top-level folder when no root files exist', () => {
    const layout = buildPlanningDocsSidebarLayout([
      file('design-docs/active/foo.md'),
      file('design-docs/backlog/bar.md'),
    ]);
    expect(layout.kind).toBe('tree');
    if (layout.kind !== 'tree') return;
    expect(layout.nodes.map((n) => (n.kind === 'folder' ? n.segment : n.file.relativePath))).toEqual([
      'active',
      'backlog',
    ]);
    expect(folderPaths(layout.nodes)).toEqual(['design-docs/active', 'design-docs/backlog']);
  });

  it('flattens when a single top-level folder contains only one file', () => {
    const layout = buildPlanningDocsSidebarLayout([file('design-docs/only.md')]);
    expect(layout).toEqual({
      kind: 'flat',
      files: [file('design-docs/only.md')],
    });
  });

  it('collects folder paths for collapse defaults', () => {
    const layout = buildPlanningDocsSidebarLayout([
      file('design-docs/active/a.md'),
      file('design-docs/backlog/b.md'),
      file('sprints/s1.md'),
    ]);
    expect(layout.kind).toBe('tree');
    if (layout.kind !== 'tree') return;
    expect(folderPaths(layout.nodes)).toEqual([
      'design-docs',
      'design-docs/active',
      'design-docs/backlog',
      'sprints',
    ]);
  });
});

describe('planningDocSidebarFileLabel', () => {
  it('returns basename for nested paths', () => {
    expect(planningDocSidebarFileLabel('design-docs/active/cloud-agents-plan.md')).toBe(
      'cloud-agents-plan.md',
    );
    expect(planningDocSidebarFileLabel('vision.md')).toBe('vision.md');
  });
});
