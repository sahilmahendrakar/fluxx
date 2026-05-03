import { describe, expect, it } from 'vitest';
import {
  parseFirestorePlanningDocListRow,
  parsePlanningDocSnapshotForPush,
} from './firestorePlanningDocParse';

describe('parseFirestorePlanningDocListRow', () => {
  it('accepts schema v1 rows with string paths and markdown', () => {
    expect(
      parseFirestorePlanningDocListRow({
        schemaVersion: 1,
        relativePath: 'vision.md',
        markdown: '# hi',
      }),
    ).toEqual({ relativePath: 'vision.md', markdown: '# hi' });
  });

  it('rejects wrong schema version', () => {
    expect(
      parseFirestorePlanningDocListRow({
        schemaVersion: 2,
        relativePath: 'a.md',
        markdown: 'x',
      }),
    ).toBeNull();
  });

  it('rejects non-object and missing fields', () => {
    expect(parseFirestorePlanningDocListRow(null)).toBeNull();
    expect(parseFirestorePlanningDocListRow(undefined)).toBeNull();
    expect(parseFirestorePlanningDocListRow('x')).toBeNull();
    expect(parseFirestorePlanningDocListRow({ schemaVersion: 1, relativePath: 1, markdown: 'a' })).toBeNull();
    expect(parseFirestorePlanningDocListRow({ schemaVersion: 1, relativePath: 'a.md' })).toBeNull();
  });
});

describe('parsePlanningDocSnapshotForPush', () => {
  it('returns unknown revision for missing or invalid schema', () => {
    expect(parsePlanningDocSnapshotForPush(undefined)).toEqual({
      revision: 'unknown',
      markdown: '',
      updatedBy: '',
    });
    expect(parsePlanningDocSnapshotForPush({ schemaVersion: 2 as unknown as 1 })).toEqual({
      revision: 'unknown',
      markdown: '',
      updatedBy: '',
    });
  });

  it('reads markdown, updatedBy, and revision from timestamp shape', () => {
    expect(
      parsePlanningDocSnapshotForPush({
        schemaVersion: 1,
        markdown: 'body',
        updatedBy: 'uid1',
        updatedAt: { seconds: 3, nanoseconds: 9 },
      }),
    ).toEqual({
      revision: '3_9',
      markdown: 'body',
      updatedBy: 'uid1',
    });
  });

  it('tolerates non-string markdown or updatedBy as empty', () => {
    expect(
      parsePlanningDocSnapshotForPush({
        schemaVersion: 1,
        markdown: undefined as unknown as string,
        updatedBy: undefined as unknown as string,
        updatedAt: { seconds: 1, nanoseconds: 0 },
      }),
    ).toEqual({
      revision: '1_0',
      markdown: '',
      updatedBy: '',
    });
  });
});
