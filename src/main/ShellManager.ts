import * as pty from 'node-pty';
import type { IPty } from 'node-pty';
import { randomUUID } from 'node:crypto';
import { BrowserWindow } from 'electron';
import os from 'node:os';
import type { Shell } from '../types';

function broadcast(channel: string, payload?: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    if (payload === undefined) {
      win.webContents.send(channel);
    } else {
      win.webContents.send(channel, payload);
    }
  }
}

function defaultShellCommand(): { command: string; args: string[] } {
  if (process.platform === 'win32') {
    return { command: process.env.COMSPEC ?? 'cmd.exe', args: [] };
  }
  const sh = process.env.SHELL ?? '/bin/bash';
  // Login shell gives users their normal PATH / aliases.
  return { command: sh, args: ['-l'] };
}

export class ShellManager {
  private shells = new Map<string, { pty: IPty; shell: Shell }>();

  openShell(sessionId: string, worktreePath: string): Shell {
    const { command, args } = defaultShellCommand();
    const ptyProcess = pty.spawn(command, args, {
      name: 'xterm-color',
      cols: 80,
      rows: 24,
      cwd: worktreePath,
      env: { ...process.env, HOME: process.env.HOME ?? os.homedir() },
    });

    const shell: Shell = {
      id: randomUUID(),
      sessionId,
      worktreePath,
      status: 'running',
      startedAt: new Date().toISOString(),
    };

    ptyProcess.onData((data) => {
      broadcast(`shell:data:${shell.id}`, data);
    });

    ptyProcess.onExit(({ exitCode }) => {
      const entry = this.shells.get(shell.id);
      const live = entry?.shell ?? shell;
      live.status = exitCode === 0 ? 'stopped' : 'error';
      live.stoppedAt = new Date().toISOString();
      broadcast('shell:exited', live);
      this.shells.delete(shell.id);
    });

    this.shells.set(shell.id, { pty: ptyProcess, shell });
    return shell;
  }

  closeShell(shellId: string): void {
    const entry = this.shells.get(shellId);
    if (!entry) return;
    try {
      entry.pty.kill();
    } catch (err: unknown) {
      console.error('[ShellManager.closeShell] pty.kill failed', { shellId, err });
    }
    this.shells.delete(shellId);
  }

  closeShellsForSession(sessionId: string): void {
    for (const [id, { shell }] of this.shells) {
      if (shell.sessionId === sessionId) {
        this.closeShell(id);
      }
    }
  }

  listForSession(sessionId: string): Shell[] {
    return [...this.shells.values()]
      .filter(({ shell }) => shell.sessionId === sessionId)
      .map(({ shell }) => shell);
  }

  write(shellId: string, data: string): void {
    const entry = this.shells.get(shellId);
    if (!entry) return;
    entry.pty.write(data);
  }

  resize(shellId: string, cols: number, rows: number): void {
    const entry = this.shells.get(shellId);
    if (!entry) return;
    entry.pty.resize(cols, rows);
  }
}
