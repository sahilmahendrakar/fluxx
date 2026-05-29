import type { PlanningDocFileEntry } from './planningDocs/types';

export type PlanningDocsSidebarFileNode = {
  kind: 'file';
  file: PlanningDocFileEntry;
};

export type PlanningDocsSidebarFolderNode = {
  kind: 'folder';
  /** Full folder prefix using forward slashes (e.g. `design-docs/active`). */
  folderPath: string;
  /** Last path segment for display (e.g. `active`). */
  segment: string;
  children: PlanningDocsSidebarTreeNode[];
};

export type PlanningDocsSidebarTreeNode =
  | PlanningDocsSidebarFileNode
  | PlanningDocsSidebarFolderNode;

export type PlanningDocsSidebarLayout =
  | { kind: 'flat'; files: PlanningDocFileEntry[] }
  | { kind: 'tree'; nodes: PlanningDocsSidebarTreeNode[] };

type MutableFolder = {
  segment: string;
  folderPath: string;
  subfolders: Map<string, MutableFolder>;
  files: PlanningDocFileEntry[];
};

type MutableRoot = {
  subfolders: Map<string, MutableFolder>;
  files: PlanningDocFileEntry[];
};

function sortFiles(files: PlanningDocFileEntry[]): PlanningDocFileEntry[] {
  return [...files].sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function insertFile(root: MutableRoot, file: PlanningDocFileEntry): void {
  const segs = file.relativePath.split('/').filter(Boolean);
  if (segs.length <= 1) {
    root.files.push(file);
    return;
  }

  const dirSegs = segs.slice(0, -1);
  let current: MutableRoot | MutableFolder = root;
  let folderPath = '';

  for (const seg of dirSegs) {
    folderPath = folderPath ? `${folderPath}/${seg}` : seg;
    const subfolders =
      'subfolders' in current ? current.subfolders : (current as MutableFolder).subfolders;
    let child = subfolders.get(seg);
    if (!child) {
      child = { segment: seg, folderPath, subfolders: new Map(), files: [] };
      subfolders.set(seg, child);
    }
    current = child;
  }

  (current as MutableFolder).files.push(file);
}

function folderToNodes(folder: MutableFolder): PlanningDocsSidebarTreeNode[] {
  const nodes: PlanningDocsSidebarTreeNode[] = [];

  for (const [, sub] of [...folder.subfolders.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    nodes.push({
      kind: 'folder',
      segment: sub.segment,
      folderPath: sub.folderPath,
      children: folderToNodes(sub),
    });
  }

  for (const file of sortFiles(folder.files)) {
    nodes.push({ kind: 'file', file });
  }

  return nodes;
}

function rootToNodes(root: MutableRoot): PlanningDocsSidebarTreeNode[] {
  const nodes: PlanningDocsSidebarTreeNode[] = [];

  for (const [, sub] of [...root.subfolders.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    nodes.push({
      kind: 'folder',
      segment: sub.segment,
      folderPath: sub.folderPath,
      children: folderToNodes(sub),
    });
  }

  for (const file of sortFiles(root.files)) {
    nodes.push({ kind: 'file', file });
  }

  return nodes;
}

/** When every doc lives under one top-level folder, skip that wrapper (mirrors single-repo flat sessions). */
function maybeUnwrapSingleTopLevelFolder(
  nodes: PlanningDocsSidebarTreeNode[],
): PlanningDocsSidebarTreeNode[] {
  if (nodes.length !== 1) return nodes;
  const only = nodes[0];
  if (only?.kind !== 'folder') return nodes;
  return only.children;
}

/** Collect all folder paths in a sidebar tree (for collapse defaults / persistence). */
export function collectPlanningDocFolderPaths(
  nodes: ReadonlyArray<PlanningDocsSidebarTreeNode>,
): string[] {
  const paths: string[] = [];
  for (const node of nodes) {
    if (node.kind === 'folder') {
      paths.push(node.folderPath);
      paths.push(...collectPlanningDocFolderPaths(node.children));
    }
  }
  return paths;
}

export function planningDocSidebarFileLabel(relativePath: string): string {
  const segs = relativePath.split('/').filter(Boolean);
  return segs.length > 0 ? segs[segs.length - 1]! : relativePath;
}

export function buildPlanningDocsSidebarLayout(
  files: ReadonlyArray<PlanningDocFileEntry>,
): PlanningDocsSidebarLayout {
  if (files.length === 0) {
    return { kind: 'flat', files: [] };
  }

  const root: MutableRoot = { subfolders: new Map(), files: [] };
  for (const file of files) {
    insertFile(root, file);
  }

  let nodes = rootToNodes(root);
  nodes = maybeUnwrapSingleTopLevelFolder(nodes);

  if (nodes.every((node) => node.kind === 'file')) {
    return { kind: 'flat', files: nodes.map((node) => node.file) };
  }

  return { kind: 'tree', nodes };
}
