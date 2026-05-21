import { describe, expect, it, vi } from 'vitest';
import { probeTmuxAvailability, tmuxUnavailableSaveError } from './tmuxAvailability';

describe('probeTmuxAvailability', () => {
  it('reports unavailable on Windows without invoking tmux', async () => {
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    const result = await probeTmuxAvailability();
    platform.mockRestore();
    expect(result.available).toBe(false);
    expect(result.message).toMatch(/macOS and Linux/i);
  });
});

describe('tmuxUnavailableSaveError', () => {
  it('uses availability message when present', () => {
    expect(tmuxUnavailableSaveError({ available: false, message: 'install tmux' })).toBe(
      'install tmux',
    );
  });
});
