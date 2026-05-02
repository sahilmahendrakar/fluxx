export type SilenceState = 'active' | 'silent';

const DEFAULT_SILENCE_MS = 10_000;
/**
 * How long after a PTY resize to ignore data when deciding whether to emit
 * `active`. Resizing sends SIGWINCH to the agent which may cause it to redraw
 * its display — that redraw is not genuine agent activity.
 */
const RESIZE_SUPPRESS_MS = 3_000;

/**
 * Detects when a PTY session has stopped producing output. Resets a timer
 * on every chunk; if no output arrives for `silenceMs` the session is
 * considered silent (agent is waiting for user input).
 */
export class SilenceDetector {
  private state: SilenceState = 'active';
  private timer: NodeJS.Timeout | null = null;
  private lastDataAt: number = Date.now();
  private silentAt: number | null = null;
  /** Epoch ms after which resize-triggered data is no longer suppressed. */
  private resizeSuppressUntil = 0;

  constructor(
    private readonly onStateChange: (state: SilenceState) => void,
    private readonly silenceMs: number = DEFAULT_SILENCE_MS,
    private readonly sessionId?: string,
  ) {
    this.arm();
  }

  getCurrentState(): SilenceState {
    return this.state;
  }

  /**
   * Call whenever the PTY is resized. Suppresses the next `active` transition
   * for a brief window so that SIGWINCH-triggered redraws are not mistaken for
   * genuine agent activity resuming.
   */
  notifyResize(): void {
    this.resizeSuppressUntil = Date.now() + RESIZE_SUPPRESS_MS;
  }

  /** Called on every PTY output chunk. */
  onData(): void {
    this.lastDataAt = Date.now();
    if (this.state === 'silent') {
      if (Date.now() < this.resizeSuppressUntil) {
        // Output is likely a SIGWINCH redraw — do NOT transition to active and
        // do NOT re-arm (avoid triggering a second 'silent' event in 10 s).
        return;
      }
      this.silentAt = null;
      this.state = 'active';
      this.onStateChange('active');
    }
    this.arm();
  }

  private arm(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      // Only emit if not already silent — avoids spurious repeat broadcasts
      // (e.g. after a resize suppress path re-armed the timer).
      if (this.state === 'silent') return;
      this.silentAt = Date.now();
      console.log('[task:silence] session went silent', {
        sessionId: this.sessionId,
        idleSinceMs: Date.now() - this.lastDataAt,
      });
      this.state = 'silent';
      this.onStateChange('silent');
    }, this.silenceMs);
    this.timer.unref?.();
  }

  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
