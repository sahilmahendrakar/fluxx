import path from 'node:path';
import type { Agent } from '../types';

export type AutoresponderRule = {
  id: string;
  agents: Agent[];
  cwdAllowlist: (cwd: string) => boolean;
  matches: (screenText: string) => boolean;
  respondWith: string;
  ttlMsFromSpawn: number;
  oncePerSession: boolean;
};

const CLAUDE_PATTERN = 'Is this a project you created or one you trust';

function cursorTrustLegacyMatches(screenText: string): boolean {
  return (
    screenText.includes('Workspace Trust Required') &&
    screenText.includes('Do you trust the contents of this directory')
  );
}

/** Cursor CLI menu-style workspace trust (TUI with arrow/Enter hints). */
function cursorTrustMenuMatches(screenText: string): boolean {
  const hasMenuHint =
    screenText.includes('Use arrow keys to navigate') &&
    screenText.includes('Enter to select');
  if (!hasMenuHint) return false;
  return (
    screenText.includes('Workspace Trust Required') ||
    /trust/i.test(screenText)
  );
}

function assertCwdGate(rule: AutoresponderRule): void {
  if (typeof rule.cwdAllowlist !== 'function') {
    throw new Error(`[trustPromptAutoresponder] rule ${rule.id} missing cwdAllowlist`);
  }
}

/**
 * Builds v1 trust rules with cwd gates bound to resolved path prefixes from main.
 * Registry load rejects rules without a cwd allowlist function.
 */
/** Default window after attach/spawn during which trust prompts are auto-answered. */
export const TRUST_PROMPT_AUTORESPOND_TTL_MS = 30_000;

/** SSH attach can happen long after the remote agent starts; allow a longer window. */
export const TRUST_PROMPT_AUTORESPOND_SSH_TTL_MS = 5 * 60_000;

export function buildTrustPromptAutoresponderRules(
  trustRoots: readonly string[],
  opts?: { ttlMsFromSpawn?: number },
): AutoresponderRule[] {
  const ttlMsFromSpawn = opts?.ttlMsFromSpawn ?? TRUST_PROMPT_AUTORESPOND_TTL_MS;
  const cwdGate = (cwd: string): boolean => {
    if (trustRoots.length === 0) return false;
    const r = path.resolve(cwd);
    return trustRoots.some((root) => {
      const b = path.resolve(root);
      return r === b || r.startsWith(`${b}${path.sep}`);
    });
  };

  const rules: AutoresponderRule[] = [
    {
      id: 'claude-trust',
      agents: ['claude-code'],
      cwdAllowlist: cwdGate,
      matches: (t) => t.includes(CLAUDE_PATTERN),
      respondWith: '\r',
      ttlMsFromSpawn,
      oncePerSession: true,
    },
    {
      id: 'cursor-trust',
      agents: ['cursor'],
      cwdAllowlist: cwdGate,
      matches: (t) => cursorTrustLegacyMatches(t),
      respondWith: 'a',
      ttlMsFromSpawn,
      oncePerSession: true,
    },
    {
      id: 'cursor-trust-menu',
      agents: ['cursor'],
      cwdAllowlist: cwdGate,
      matches: (t) => cursorTrustMenuMatches(t),
      respondWith: '\r',
      ttlMsFromSpawn,
      oncePerSession: true,
    },
  ];

  for (const rule of rules) {
    assertCwdGate(rule);
  }
  return rules;
}
