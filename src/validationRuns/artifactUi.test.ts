import { describe, expect, it } from 'vitest';
import {
  validationArtifactCanPreviewInline,
  validationArtifactMissingCopy,
  validationArtifactShouldOpenExternally,
} from './artifactUi';

describe('validationRuns/artifactUi', () => {
  it('classifies preview vs external artifact kinds', () => {
    expect(validationArtifactCanPreviewInline('screenshot')).toBe(true);
    expect(validationArtifactCanPreviewInline('console-log')).toBe(true);
    expect(validationArtifactCanPreviewInline('trace')).toBe(false);
    expect(validationArtifactShouldOpenExternally('trace')).toBe(true);
    expect(validationArtifactShouldOpenExternally('video')).toBe(true);
  });

  it('returns clear copy for missing artifacts', () => {
    expect(validationArtifactMissingCopy('missing')).toMatch(/missing on disk/i);
    expect(validationArtifactMissingCopy('present')).toBeNull();
  });
});
