import type { Agent } from '../types';
import type { SessionRuntime } from './SessionRuntime';
import type { AutoresponderRule } from './trustPromptAutoresponderRules';
const OUTPUT_SETTLE_MS = 150;

export type PromptAutoresponderFirePayload = {
  ruleId: string;
  agent: Agent;
  sessionId: string;
};

/**
 * After PTY output is quiet for {@link OUTPUT_SETTLE_MS}, evaluates trust-prompt
 * rules against the headless xterm screen (bottom lines, whitespace collapsed).
 */
export class PromptAutoresponder {
  private settleTimer: NodeJS.Timeout | null = null;
  private readonly firedRuleIds = new Set<string>();
  private readonly spawnedAt: number;
  private disposed = false;

  constructor(
    private readonly sessionId: string,
    private readonly agent: Agent,
    private readonly enabled: boolean,
    private readonly rules: AutoresponderRule[],
    private readonly runtime: SessionRuntime,
    private readonly onFire: (payload: PromptAutoresponderFirePayload) => void,
    spawnedAtMs: number = Date.now(),
  ) {
    this.spawnedAt = spawnedAtMs;
  }

  /** Call on every PTY output chunk (same cadence as {@link SilenceDetector#onData}). */
  notifyPtyData(): void {
    if (!this.enabled || this.disposed || this.rules.length === 0) return;
    if (this.settleTimer) {
      clearTimeout(this.settleTimer);
      this.settleTimer = null;
    }
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      void this.evaluateSettled();
    }, OUTPUT_SETTLE_MS);
    this.settleTimer.unref?.();
  }

  dispose(): void {
    this.disposed = true;
    if (this.settleTimer) {
      clearTimeout(this.settleTimer);
      this.settleTimer = null;
    }
  }

  private async evaluateSettled(): Promise<void> {
    if (!this.enabled || this.disposed) return;
    try {
      const cwd = this.runtime.currentCwd;
      const now = Date.now();
      const age = now - this.spawnedAt;

      await this.runtime.flushHeadlessParser();
      const screenText = this.runtime.getCollapsedBottomScreenText();

      for (const rule of this.rules) {
        if (!rule.agents.includes(this.agent)) continue;
        if (!rule.cwdAllowlist(cwd)) continue;
        if (rule.oncePerSession && this.firedRuleIds.has(rule.id)) continue;
        if (age > rule.ttlMsFromSpawn) continue;
        if (!rule.matches(screenText)) continue;

        this.firedRuleIds.add(rule.id);
        this.runtime.write(rule.respondWith);
        console.log('[autorespond:trust]', {
          ruleId: rule.id,
          agent: this.agent,
          sessionId: this.sessionId,
          ts: new Date().toISOString(),
        });
        this.onFire({ ruleId: rule.id, agent: this.agent, sessionId: this.sessionId });
        return;
      }
    } catch (err) {
      console.warn('[autorespond:trust] evaluation failed', err);
    }
  }
}
