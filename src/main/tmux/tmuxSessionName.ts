import { createHash } from 'node:crypto';
import type { TerminalKind } from '../../types';
import { slugifySingleBranchSegment } from '../fluxxTaskWorkBranchNaming';

const PROJECT_SLUG_MAX = 24;
const TERMINAL_ID_FRAGMENT_LEN = 12;
/** tmux session names are limited; keep headroom for `fluxx-<kind>-`. */
const SESSION_NAME_MAX = 128;

/**
 * Builds a Fluxx-owned tmux session name. Persist the returned string; do not
 * re-derive from mutable titles.
 */
export function buildFluxxTmuxSessionName(input: {
  kind: TerminalKind;
  projectSlugSource: string;
  terminalId: string;
}): string {
  const kind = input.kind;
  const projectSlug =
    slugifySingleBranchSegment(input.projectSlugSource, PROJECT_SLUG_MAX) || 'project';
  const idFragment = input.terminalId.replace(/-/g, '').slice(0, TERMINAL_ID_FRAGMENT_LEN);
  const fallback = createHash('sha256')
    .update(input.terminalId, 'utf8')
    .digest('hex')
    .slice(0, TERMINAL_ID_FRAGMENT_LEN);
  const shortId = (idFragment || fallback).toLowerCase();
  const base = `fluxx-${kind}-${projectSlug}-${shortId}`;
  if (base.length <= SESSION_NAME_MAX) return base;
  const overhead = `fluxx-${kind}-`.length + 1 + shortId.length;
  const trimmedProject = projectSlug.slice(0, Math.max(4, SESSION_NAME_MAX - overhead));
  return `fluxx-${kind}-${trimmedProject}-${shortId}`;
}

export function isFluxxTmuxSessionName(name: string): boolean {
  return name.startsWith('fluxx-');
}
