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

function cursorTrustMatches(screenText: string): boolean {
  return (
    screenText.includes('Workspace Trust Required') &&
    screenText.includes('Do you trust the contents of this directory')
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
export function buildTrustPromptAutoresponderRules(
  trustRoots: readonly string[],
): AutoresponderRule[] {
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
      ttlMsFromSpawn: 30_000,
      oncePerSession: true,
    },
    {
      id: 'cursor-trust',
      agents: ['cursor'],
      cwdAllowlist: cwdGate,
      matches: (t) => cursorTrustMatches(t),
      respondWith: 'a',
      ttlMsFromSpawn: 30_000,
      oncePerSession: true,
    },
  ];

  for (const rule of rules) {
    assertCwdGate(rule);
  }
  return rules;
}
