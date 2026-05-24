import type { ValidationArtifactKind } from './types';

export function validationArtifactCanPreviewInline(kind: ValidationArtifactKind): boolean {
  return kind === 'screenshot' || kind === 'text' || kind === 'console-log' || kind === 'json';
}

export function validationArtifactShouldOpenExternally(kind: ValidationArtifactKind): boolean {
  return kind === 'video' || kind === 'trace';
}

export function validationArtifactMissingCopy(
  fileState: 'present' | 'missing' | 'unreadable',
): string | null {
  if (fileState === 'missing') {
    return 'This artifact file is missing on disk. It may have been moved or deleted.';
  }
  if (fileState === 'unreadable') {
    return 'This artifact file exists but cannot be read.';
  }
  return null;
}
