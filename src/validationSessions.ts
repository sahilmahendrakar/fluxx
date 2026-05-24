import type { Session } from './types';

/** True when a session row is a validator PTY (not the task implementation workspace). */
export function isValidatorWorkspaceSession(session: Pick<Session, 'kind'>): boolean {
  return session.kind === 'validator';
}
