import type { SessionStartErrorCode } from '../types';

/**
 * Typed failure from {@link WorktreeService.create}; mapped to
 * {@link SessionStartResult} in the session-start path.
 */
export class WorktreeCreateError extends Error {
  readonly code: SessionStartErrorCode;
  readonly branchName?: string;

  constructor(code: SessionStartErrorCode, message: string, branchName?: string) {
    super(message);
    this.name = 'WorktreeCreateError';
    this.code = code;
    this.branchName = branchName;
  }
}

export function isWorktreeCreateError(err: unknown): err is WorktreeCreateError {
  return err instanceof WorktreeCreateError;
}
