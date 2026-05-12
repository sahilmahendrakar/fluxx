import { describe, expect, it } from 'vitest';
import { parseProjectTabStateDiskValue } from './projectTabStateDiskParse';

describe('parseProjectTabStateDiskValue', () => {
  it('returns minimal tab state when only core fields present', () => {
    expect(parseProjectTabStateDiskValue({ openTaskIds: [], activeTaskId: null })).toEqual({
      openTaskIds: [],
      activeTaskId: null,
    });
  });

  it('preserves planningSidebarOpen when true', () => {
    expect(
      parseProjectTabStateDiskValue({
        openTaskIds: [],
        activeTaskId: 'board',
        planningSidebarOpen: true,
      }),
    ).toEqual({
      openTaskIds: [],
      activeTaskId: 'board',
      planningSidebarOpen: true,
    });
  });

  it('drops planningSidebarOpen when false or absent (migration default)', () => {
    expect(
      parseProjectTabStateDiskValue({
        openTaskIds: [],
        activeTaskId: 'board',
        planningSidebarOpen: false,
      }),
    ).toEqual({ openTaskIds: [], activeTaskId: 'board' });
    expect(
      parseProjectTabStateDiskValue({
        openTaskIds: [],
        activeTaskId: 'board',
      }),
    ).not.toHaveProperty('planningSidebarOpen');
  });
});
