import { describe, expect, it } from 'vitest';
import {
  remoteLifecycleStatusDetail,
  remoteLifecycleStatusHeading,
} from './remoteSessionLifecycleUi';

describe('remoteSessionLifecycleUi', () => {
  it('describes device-unreachable without implying task deletion', () => {
    const detail = remoteLifecycleStatusDetail('device-unreachable', {
      deviceLabel: 'Devbox',
    });
    expect(remoteLifecycleStatusHeading('device-unreachable')).toContain('unreachable');
    expect(detail).toContain('task metadata');
    expect(detail).toContain('Devbox');
  });

  it('describes tmux-missing recovery options', () => {
    const detail = remoteLifecycleStatusDetail('tmux-missing', {
      deviceLabel: 'GPU box',
    });
    expect(detail).toContain('tmux');
    expect(detail).toContain('new session');
  });
});
