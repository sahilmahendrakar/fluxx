import type { TerminalKind, TerminalSessionRecord } from '../../types';

const FLUXX_TMUX_PREFIX = 'fluxx-';

export type TmuxTerminalReconcileCounts = {
  restored: Record<TerminalKind, number>;
  missing: Record<TerminalKind, number>;
  workspaceMissing: Record<TerminalKind, number>;
  skipped: number;
};

export type TmuxTerminalReconcileResult = TmuxTerminalReconcileCounts & {
  untrackedFluxxSessions: string[];
};

export function emptyTmuxReconcileCounts(): TmuxTerminalReconcileCounts {
  return {
    restored: { task: 0, planning: 0, shell: 0 },
    missing: { task: 0, planning: 0, shell: 0 },
    workspaceMissing: { task: 0, planning: 0, shell: 0 },
    skipped: 0,
  };
}

export function isOpenTmuxManifestRow(
  record: TerminalSessionRecord,
  projectId: string,
): boolean {
  if (record.projectId !== projectId) return false;
  if (record.endedAt) return false;
  if (record.runtime !== 'tmux') return false;
  const name = record.tmuxSessionName?.trim();
  return Boolean(name);
}

/** Open tmux manifest rows for one project, task → planning → shell order. */
export function sortOpenTmuxRowsForRestore(
  rows: TerminalSessionRecord[],
  projectId: string,
): TerminalSessionRecord[] {
  const kindOrder: Record<TerminalKind, number> = { task: 0, planning: 1, shell: 2 };
  return rows
    .filter((r) => isOpenTmuxManifestRow(r, projectId))
    .sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind]);
}

export function fluxxTmuxSessionNamesFromList(allSessionNames: string[]): string[] {
  return allSessionNames.filter((name) => name.startsWith(FLUXX_TMUX_PREFIX));
}

export function findUntrackedFluxxTmuxSessions(
  allSessionNames: string[],
  trackedNames: ReadonlySet<string>,
): string[] {
  return fluxxTmuxSessionNamesFromList(allSessionNames).filter((name) => !trackedNames.has(name));
}

export function mergeTmuxReconcileCounts(
  into: TmuxTerminalReconcileCounts,
  delta: Partial<TmuxTerminalReconcileCounts>,
): void {
  if (delta.restored) {
    for (const kind of ['task', 'planning', 'shell'] as const) {
      into.restored[kind] += delta.restored[kind] ?? 0;
    }
  }
  if (delta.missing) {
    for (const kind of ['task', 'planning', 'shell'] as const) {
      into.missing[kind] += delta.missing[kind] ?? 0;
    }
  }
  if (delta.workspaceMissing) {
    for (const kind of ['task', 'planning', 'shell'] as const) {
      into.workspaceMissing[kind] += delta.workspaceMissing[kind] ?? 0;
    }
  }
  into.skipped += delta.skipped ?? 0;
}

export function formatTmuxReconcileLogLine(result: TmuxTerminalReconcileResult): string {
  const r = result.restored;
  const m = result.missing;
  const w = result.workspaceMissing;
  const untracked =
    result.untrackedFluxxSessions.length > 0
      ? ` untrackedFluxx=${result.untrackedFluxxSessions.length} [${result.untrackedFluxxSessions.join(', ')}]`
      : '';
  return (
    `[tmux-reconcile] restored task=${r.task} planning=${r.planning} shell=${r.shell}; ` +
    `missing task=${m.task} planning=${m.planning} shell=${m.shell}; ` +
    `workspaceMissing task=${w.task} planning=${w.planning} shell=${w.shell}; ` +
    `skipped=${result.skipped}${untracked}`
  );
}
