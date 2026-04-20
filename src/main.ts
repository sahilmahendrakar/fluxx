import { app, BrowserWindow, dialog, ipcMain, nativeTheme } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import started from 'electron-squirrel-startup';
import { TaskStore } from './main/TaskStore';
import { ProjectStore, type ActiveProjectKey } from './main/ProjectStore';
import { LocalBindingStore } from './main/LocalBindingStore';
import { WorktreeService } from './main/WorktreeService';
import { SessionManager } from './main/SessionManager';
import { AuthServer } from './main/AuthServer';
import { EmailService, type InviteEmailInput } from './main/EmailService';
import type { Agent, LocalProject, Task } from './types';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

/** Stable id per folder so tasks in tasks.json stay scoped after close/reopen. */
function stableProjectIdForPath(rootPath: string): string {
  return createHash('sha256').update(path.resolve(rootPath)).digest('hex');
}

// Matches renderer `bg-gray-950` (Tailwind default palette) so native chrome
// and any pre-paint window surface are not a contrasting light color.
const WINDOW_BACKGROUND = '#030712';

let mainWindow: BrowserWindow | null = null;

/** Session id → dedicated terminal `BrowserWindow` (not the main app window). */
const dedicatedTerminalWindows = new Map<string, BrowserWindow>();

function broadcastTerminalWindowClosed(sessionId: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    win.webContents.send('session:terminalWindowClosed', sessionId);
  }
}

function loadUrlWithTerminalHash(win: BrowserWindow, sessionId: string): void {
  const fragment = `terminal=${sessionId}`;
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    const base = MAIN_WINDOW_VITE_DEV_SERVER_URL.replace(/#.*$/, '');
    void win.loadURL(`${base}#${fragment}`);
  } else {
    void win.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
      { hash: fragment },
    );
  }
}

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'Flux',
    backgroundColor: WINDOW_BACKGROUND,
    ...(process.platform === 'darwin'
      ? {
          titleBarStyle: 'hiddenInset' as const,
        }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  // Open the DevTools.
  mainWindow.webContents.openDevTools();
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  if (process.platform === 'darwin') {
    // With `hiddenInset`, a light system appearance can leave a 1px bright seam on
    // the top edge (macOS + Electron; see electron/electron#51015). Dark window chrome
    // matches this app and removes that line.
    nativeTheme.themeSource = 'dark';
  }

  const projectStore = new ProjectStore();
  await projectStore.init();

  const bindingStore = new LocalBindingStore();
  await bindingStore.init();

  const taskStore = new TaskStore();
  const activeLocal = projectStore.getActiveLocal();
  await taskStore.init(activeLocal?.id ?? null);

  let activeRootPath = activeLocal?.rootPath ?? '';
  const activeKey = projectStore.getActiveKey();
  if (activeKey?.kind === 'cloud') {
    // Cloud projects have no rootPath in the main store — look up the
    // per-machine binding. If the folder is gone, we leave it empty and the
    // renderer will re-prompt on activate.
    const binding = bindingStore.get(activeKey.id);
    if (binding) {
      try {
        await fs.access(path.join(binding.rootPath, '.git'));
        activeRootPath = binding.rootPath;
      } catch {
        activeRootPath = '';
      }
    }
  }

  const worktreeService = new WorktreeService(activeRootPath);
  const sessionManager = new SessionManager(worktreeService);

  const authServer = new AuthServer();
  const emailService = new EmailService();

  async function pickDirectory(
    title: string,
  ): Promise<{ rootPath: string } | { error: 'NOT_GIT_REPO' } | null> {
    const win = mainWindow ?? BrowserWindow.getFocusedWindow();
    const dialogOpts = {
      properties: ['openDirectory' as const],
      title,
      buttonLabel: 'Open project',
    };
    const result = win
      ? await dialog.showOpenDialog(win, dialogOpts)
      : await dialog.showOpenDialog(dialogOpts);
    if (result.canceled || result.filePaths.length === 0) return null;
    const rootPath = result.filePaths[0];
    try {
      await fs.access(path.join(rootPath, '.git'));
    } catch {
      return { error: 'NOT_GIT_REPO' as const };
    }
    return { rootPath };
  }

  async function pickAndAddLocalProject(): Promise<
    LocalProject | { error: string } | null
  > {
    const picked = await pickDirectory('Open project folder');
    if (!picked || 'error' in picked) return picked;
    const id = stableProjectIdForPath(picked.rootPath);
    const existing = projectStore.getLocalById(id);
    const project: LocalProject = existing ?? {
      id,
      kind: 'local',
      name: path.basename(picked.rootPath),
      rootPath: picked.rootPath,
      addedAt: new Date().toISOString(),
    };
    await projectStore.upsertLocal(project);
    await projectStore.setActiveKey({ kind: 'local', id: project.id });
    worktreeService.setRootPath(project.rootPath);
    await taskStore.migrateMissingProjectIds(project.id);
    return project;
  }

  // ---- Project (legacy single-project API; returns the active LOCAL project) ----
  ipcMain.handle('project:get', () => projectStore.getActiveLocal());
  ipcMain.handle('project:open', () => pickAndAddLocalProject());
  ipcMain.handle('project:clear', async () => {
    await projectStore.setActiveKey(null);
    worktreeService.setRootPath('');
  });

  // ---- Projects (multi-project API) ----
  ipcMain.handle('projects:listLocal', () => projectStore.listLocal());
  ipcMain.handle('projects:addLocal', () => pickAndAddLocalProject());
  ipcMain.handle(
    'projects:activateLocal',
    async (_e, id: string | null): Promise<LocalProject | null> => {
      if (id === null) {
        await projectStore.setActiveKey(null);
        worktreeService.setRootPath('');
        return null;
      }
      const project = projectStore.getLocalById(id);
      if (!project) throw new Error(`Local project not found: ${id}`);
      await projectStore.setActiveKey({ kind: 'local', id: project.id });
      worktreeService.setRootPath(project.rootPath);
      await taskStore.migrateMissingProjectIds(project.id);
      return project;
    },
  );
  ipcMain.handle('projects:removeLocal', async (_e, id: string) => {
    await projectStore.removeLocal(id);
    if (projectStore.getActiveKey() === null) {
      worktreeService.setRootPath('');
    }
  });

  ipcMain.handle(
    'projects:getActiveKey',
    (): ActiveProjectKey | null => projectStore.getActiveKey(),
  );
  ipcMain.handle('projects:clearActive', async () => {
    await projectStore.setActiveKey(null);
    worktreeService.setRootPath('');
  });

  // ---- Cloud project bindings (per-user local rootPath for a Firestore project) ----
  ipcMain.handle(
    'projects:getLocalBinding',
    async (_e, cloudProjectId: string) => bindingStore.get(cloudProjectId),
  );
  ipcMain.handle(
    'projects:pickDirectoryForCloud',
    async (_e, cloudProjectId: string) => {
      const picked = await pickDirectory('Pick the local folder for this project');
      if (!picked || 'error' in picked) return picked;
      const binding = await bindingStore.set(cloudProjectId, picked.rootPath);
      return { rootPath: binding.rootPath };
    },
  );
  ipcMain.handle(
    'projects:activateCloud',
    async (_e, payload: { id: string; rootPath: string }) => {
      try {
        await fs.access(path.join(payload.rootPath, '.git'));
      } catch {
        return { error: 'NOT_GIT_REPO' as const };
      }
      await bindingStore.set(payload.id, payload.rootPath);
      await projectStore.setActiveKey({ kind: 'cloud', id: payload.id });
      worktreeService.setRootPath(payload.rootPath);
      return { ok: true as const };
    },
  );
  ipcMain.handle('projects:clearLocalBinding', async (_e, cloudProjectId: string) => {
    await bindingStore.remove(cloudProjectId);
  });

  // ---- Auth ----
  ipcMain.handle('auth:startGoogleLogin', async () => authServer.startGoogleLogin());

  // ---- Email (Resend) ----
  console.log(
    `[email] Resend ${emailService.isConfigured() ? 'configured' : 'NOT configured'}`,
  );
  ipcMain.handle('email:isConfigured', () => emailService.isConfigured());
  ipcMain.handle(
    'email:sendInvite',
    async (_e, input: InviteEmailInput): Promise<{ ok: true } | { error: string }> => {
      console.log(`[email:sendInvite] -> ${input.to} (${input.projectName})`);
      try {
        await emailService.sendInviteEmail(input);
        console.log(`[email:sendInvite] sent to ${input.to}`);
        return { ok: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[email:sendInvite] failed', msg);
        return { error: msg };
      }
    },
  );

  // ---- Tasks (local-only; cloud tasks live in Firestore in the renderer) ----
  ipcMain.handle('tasks:getAll', async () => {
    const project = projectStore.getActiveLocal();
    if (!project) return [];
    return taskStore.getAll(project.id);
  });

  ipcMain.handle('tasks:create', async (_e, input: { title: string; agent: Agent }) => {
    const project = projectStore.getActiveLocal();
    if (!project) {
      throw new Error('No local project open');
    }
    return taskStore.create({ ...input, projectId: project.id });
  });
  ipcMain.handle('tasks:update', async (_e, id, patch) =>
    taskStore.update(id, patch),
  );
  ipcMain.handle('tasks:delete', async (_e, id) => taskStore.delete(id));

  ipcMain.handle('session:start', async (_e, task: Task) => {
    // For session start, we need a rootPath. For local projects, look up the
    // active local project; for cloud projects, the worktree service already
    // has rootPath set by activateCloud.
    const activeKey = projectStore.getActiveKey();
    if (!activeKey) throw new Error('No project open');
    if (activeKey.kind === 'local') {
      const project = projectStore.getActiveLocal();
      if (!project) throw new Error('No local project open');
      return sessionManager.startSession(task, project);
    }
    // Cloud: construct a minimal shape for SessionManager. It only needs id+rootPath+name.
    const binding = bindingStore.get(activeKey.id);
    if (!binding) throw new Error('Cloud project is not bound to a local folder');
    return sessionManager.startSession(task, {
      id: activeKey.id,
      kind: 'cloud',
      name: path.basename(binding.rootPath),
      rootPath: binding.rootPath,
      ownerId: '',
      memberIds: [],
      createdAt: '',
    });
  });

  ipcMain.handle('session:stop', async (_e, sessionId: string) => {
    const termWin = dedicatedTerminalWindows.get(sessionId);
    if (termWin && !termWin.isDestroyed()) {
      termWin.close();
    }
    dedicatedTerminalWindows.delete(sessionId);
    return sessionManager.stopSession(sessionId);
  });

  ipcMain.handle('session:get', async (_e, taskId: string) => {
    return sessionManager.getSession(taskId);
  });

  ipcMain.handle('session:getAll', async () => {
    return sessionManager.getAllSessions();
  });

  ipcMain.handle(
    'session:openDedicatedWindow',
    (_e, sessionId: string): { ok: true } | { ok: false; error: 'NO_SESSION' } => {
      const session = sessionManager.getSessionBySessionId(sessionId);
      if (!session || session.status !== 'running') {
        return { ok: false, error: 'NO_SESSION' };
      }
      const existing = dedicatedTerminalWindows.get(sessionId);
      if (existing && !existing.isDestroyed()) {
        existing.focus();
        return { ok: true };
      }
      const termWin = new BrowserWindow({
        width: 920,
        height: 640,
        title: 'Session terminal · Flux',
        backgroundColor: WINDOW_BACKGROUND,
        show: false,
        ...(process.platform === 'darwin'
          ? {
              titleBarStyle: 'hiddenInset' as const,
            }
          : {}),
        webPreferences: {
          preload: path.join(__dirname, 'preload.js'),
          contextIsolation: true,
          nodeIntegration: false,
        },
      });
      termWin.once('ready-to-show', () => {
        if (!termWin.isDestroyed()) {
          termWin.show();
        }
      });
      dedicatedTerminalWindows.set(sessionId, termWin);
      termWin.on('closed', () => {
        dedicatedTerminalWindows.delete(sessionId);
        broadcastTerminalWindowClosed(sessionId);
      });
      loadUrlWithTerminalHash(termWin, sessionId);
      return { ok: true };
    },
  );

  ipcMain.handle('session:isDedicatedOpen', (_e, sessionId: string) => {
    const w = dedicatedTerminalWindows.get(sessionId);
    return Boolean(w && !w.isDestroyed());
  });

  ipcMain.handle('session:focusDedicatedWindow', (_e, sessionId: string) => {
    const w = dedicatedTerminalWindows.get(sessionId);
    if (w && !w.isDestroyed()) {
      w.focus();
    }
  });

  ipcMain.on('session:write', (_e, sessionId: string, data: string) => {
    sessionManager.write(sessionId, data);
  });

  ipcMain.on('session:resize', (_e, sessionId: string, cols: number, rows: number) => {
    sessionManager.resize(sessionId, cols, rows);
  });

  createWindow();
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
