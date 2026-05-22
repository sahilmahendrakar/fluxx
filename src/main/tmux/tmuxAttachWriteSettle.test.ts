import { describe, expect, it } from 'vitest';
import {
  TMUX_ATTACH_WRITE_SETTLE_BASE_MS,
  TMUX_ATTACH_WRITE_SETTLE_MAX_MS,
  tmuxAttachWriteSettleMs,
} from './tmuxAttachWriteSettle';

describe('tmuxAttachWriteSettleMs', () => {
  it('scales with payload size and caps at max', () => {
    expect(tmuxAttachWriteSettleMs('\r')).toBe(TMUX_ATTACH_WRITE_SETTLE_BASE_MS);
    const large = 'x'.repeat(10_000);
    expect(tmuxAttachWriteSettleMs(large)).toBe(TMUX_ATTACH_WRITE_SETTLE_MAX_MS);
  });
});
