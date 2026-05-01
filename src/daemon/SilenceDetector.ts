export type SilenceState = 'active' | 'silent';

const DEFAULT_SILENCE_MS = 10_000;

/**
 * Detects when a PTY session has stopped producing output. Resets a timer
 * on every chunk; if no output arrives for `silenceMs` the session is
 * considered silent (agent is waiting for user input).
 */
export class SilenceDetector {
  private state: SilenceState = 'active';
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly onStateChange: (state: SilenceState) => void,
    private readonly silenceMs: number = DEFAULT_SILENCE_MS,
  ) {
    this.arm();
  }

  /** Called on every PTY output chunk. */
  onData(): void {
    if (this.state === 'silent') {
      this.state = 'active';
      this.onStateChange('active');
    }
    this.arm();
  }

  private arm(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
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
