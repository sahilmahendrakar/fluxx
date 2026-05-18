import {
  isPlanningMarkdownRelativePathForbiddenForUserAttachOrWrite,
  normalizePlanningDocRelativePath,
} from '../../planningDocs/path';
import type { PlanningDocsWriteErrorCode } from '../../planningDocs/types';

export function planningDocWriteErrorMessage(code: PlanningDocsWriteErrorCode): string {
  switch (code) {
    case 'NO_PROJECT':
      return 'No workspace is open.';
    case 'INVALID_PATH':
      return 'That path is not allowed.';
    case 'FORBIDDEN_PATH':
      return 'This path is reserved and cannot be used.';
    case 'INVALID_CONTENT':
      return 'The document could not be created.';
    case 'IO_ERROR':
    default:
      return 'Could not create the file. Check disk permissions and try again.';
  }
}

export type ValidateNewPlanningDocPathResult =
  | { ok: true; relativePath: string }
  | { ok: false; message: string };

/** Client-side checks before `planningDocs:write` for a new markdown file. */
export function validateNewPlanningDocPathInput(
  input: string,
  existingRelativePaths: readonly string[],
): ValidateNewPlanningDocPathResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return { ok: false, message: 'Enter a path for the new document.' };
  }

  const norm = normalizePlanningDocRelativePath(trimmed);
  if (!norm) {
    return {
      ok: false,
      message:
        'Use a path like overview.md or notes/launch-checklist.md. Paths must end in .md and cannot use .. segments.',
    };
  }

  if (isPlanningMarkdownRelativePathForbiddenForUserAttachOrWrite(trimmed)) {
    return {
      ok: false,
      message: 'This path is reserved for sync or agent files and cannot be used.',
    };
  }

  if (existingRelativePaths.includes(norm)) {
    return { ok: false, message: 'A document with this path already exists.' };
  }

  return { ok: true, relativePath: norm };
}
