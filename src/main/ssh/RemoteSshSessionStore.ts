import type { Session } from '../../types';

/** @deprecated Use {@link SshTerminalBackend} session registry instead. */
export class RemoteSshSessionStore {
  private readonly sessions = new Map<string, Session>();

  add(session: Session): void {
    this.sessions.set(session.id, session);
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  list(): Session[] {
    return [...this.sessions.values()];
  }

  findRunningByTaskId(taskId: string): Session | undefined {
    return this.list().find((s) => s.taskId === taskId && s.status === 'running');
  }

  remove(id: string): void {
    this.sessions.delete(id);
  }
}
