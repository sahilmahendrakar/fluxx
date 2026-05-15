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

  it('parses minimizedTaskWorkspaceIds when present with valid strings', () => {
    expect(
      parseProjectTabStateDiskValue({
        openTaskIds: [],
        activeTaskId: 'board',
        minimizedTaskWorkspaceIds: ['sess-a', 'sess-b'],
      }),
    ).toEqual({
      openTaskIds: [],
      activeTaskId: 'board',
      minimizedTaskWorkspaceIds: ['sess-a', 'sess-b'],
    });
  });

  it('drops non-string minimizedTaskWorkspaceIds entries', () => {
    expect(
      parseProjectTabStateDiskValue({
        openTaskIds: [],
        activeTaskId: 'board',
        minimizedTaskWorkspaceIds: ['ok', 1, null, 'also'],
      }),
    ).toEqual({
      openTaskIds: [],
      activeTaskId: 'board',
      minimizedTaskWorkspaceIds: ['ok', 'also'],
    });
  });

  it('omits minimizedTaskWorkspaceIds when empty or only invalid entries', () => {
    expect(
      parseProjectTabStateDiskValue({
        openTaskIds: [],
        activeTaskId: 'board',
        minimizedTaskWorkspaceIds: [],
      }),
    ).toEqual({ openTaskIds: [], activeTaskId: 'board' });
    expect(
      parseProjectTabStateDiskValue({
        openTaskIds: [],
        activeTaskId: 'board',
        minimizedTaskWorkspaceIds: [1, {}, null],
      }),
    ).toEqual({ openTaskIds: [], activeTaskId: 'board' });
  });
});
