import { describe, expect, it, beforeEach } from 'vitest';
import {
  readCollapsedRepoIdsForProject,
  writeCollapsedRepoIdsForProject,
} from './sidebarRepoSectionCollapse';

describe('sidebarRepoSectionCollapse', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('round-trips collapsed repo ids per project', () => {
    writeCollapsedRepoIdsForProject('p1', new Set(['repo-a', 'repo-b']));
    writeCollapsedRepoIdsForProject('p2', new Set(['repo-x']));

    expect(readCollapsedRepoIdsForProject('p1')).toEqual(new Set(['repo-a', 'repo-b']));
    expect(readCollapsedRepoIdsForProject('p2')).toEqual(new Set(['repo-x']));
    expect(readCollapsedRepoIdsForProject('p3')).toEqual(new Set());
  });

  it('clears project row when nothing is collapsed', () => {
    writeCollapsedRepoIdsForProject('p1', new Set(['repo-a']));
    writeCollapsedRepoIdsForProject('p1', new Set());
    expect(readCollapsedRepoIdsForProject('p1')).toEqual(new Set());
  });
});
