import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SilenceDetector, type SilenceState } from './SilenceDetector';

describe('SilenceDetector', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('transitions to silent after silenceMs with no data', () => {
    const states: SilenceState[] = [];
    const detector = new SilenceDetector((s) => states.push(s), 1000);

    vi.advanceTimersByTime(999);
    expect(states).toEqual([]);

    vi.advanceTimersByTime(1);
    expect(states).toEqual(['silent']);

    detector.dispose();
  });

  it('resets timer on each onData call', () => {
    const states: SilenceState[] = [];
    const detector = new SilenceDetector((s) => states.push(s), 1000);

    vi.advanceTimersByTime(800);
    detector.onData();

    vi.advanceTimersByTime(800);
    expect(states).toEqual([]);

    vi.advanceTimersByTime(200);
    expect(states).toEqual(['silent']);

    detector.dispose();
  });

  it('transitions back to active when data arrives after silence', () => {
    const states: SilenceState[] = [];
    const detector = new SilenceDetector((s) => states.push(s), 1000);

    vi.advanceTimersByTime(1000);
    expect(states).toEqual(['silent']);

    detector.onData();
    expect(states).toEqual(['silent', 'active']);

    detector.dispose();
  });

  it('does not emit active if already active', () => {
    const states: SilenceState[] = [];
    const detector = new SilenceDetector((s) => states.push(s), 1000);

    detector.onData();
    detector.onData();
    detector.onData();
    expect(states).toEqual([]);

    detector.dispose();
  });

  it('does not fire after dispose', () => {
    const states: SilenceState[] = [];
    const detector = new SilenceDetector((s) => states.push(s), 1000);

    detector.dispose();
    vi.advanceTimersByTime(2000);
    expect(states).toEqual([]);
  });

  it('cycles through multiple silent/active transitions', () => {
    const states: SilenceState[] = [];
    const detector = new SilenceDetector((s) => states.push(s), 500);

    vi.advanceTimersByTime(500);
    expect(states).toEqual(['silent']);

    detector.onData();
    expect(states).toEqual(['silent', 'active']);

    vi.advanceTimersByTime(500);
    expect(states).toEqual(['silent', 'active', 'silent']);

    detector.onData();
    expect(states).toEqual(['silent', 'active', 'silent', 'active']);

    detector.dispose();
  });
});
