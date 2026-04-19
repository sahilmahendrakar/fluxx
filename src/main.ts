import { app, BrowserWindow, dialog, ipcMain, nativeTheme } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import started from 'electron-squirrel-startup';
import { TaskStore } from './main/TaskStore';
import { ProjectStore } from './main/ProjectStore';
import { WorktreeService } from './main/WorktreeService';
import { SessionManager } from './main/SessionManager';
import type { Agent, Project, Task } from './types';

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

  let previousProjectIdForRemap: string | null = null;
  const openProject = projectStore.get();
  if (openProject) {
    const canonicalId = stableProjectIdForPath(openProject.rootPath);
    if (openProject.id !== canonicalId) {
      previousProjectIdForRemap = openProject.id;
      await projectStore.set({ ...openProject, id: canonicalId });
    }
  }

  const taskStore = new TaskStore();
  await taskStore.init(projectStore.get()?.id ?? null);
  const projectAfterInit = projectStore.get();
  if (previousProjectIdForRemap && projectAfterInit) {
    await taskStore.remapProjectId(previousProjectIdForRemap, projectAfterInit.id);
  }

  const worktreeService = new WorktreeService(projectStore.get()?.rootPath ?? '');
  const sessionManager = new SessionManager(worktreeService);

  ipcMain.handle('project:get', () => projectStore.get());

  ipcMain.handle('project:open', async () => {
    const win = mainWindow ?? BrowserWindow.getFocusedWindow();
    const dialogOpts = {
      properties: ['openDirectory' as const],
      title: 'Open project folder',
      buttonLabel: 'Open project',
    };
    const result = win
      ? await dialog.showOpenDialog(win, dialogOpts)
      : await dialog.showOpenDialog(dialogOpts);
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const rootPath = result.filePaths[0];
    const gitDir = path.join(rootPath, '.git');
    try {
      await fs.access(gitDir);
    } catch {
      return { error: 'NOT_GIT_REPO' as const };
    }

    const name = path.basename(rootPath);
    const project: Project = {
      id: stableProjectIdForPath(rootPath),
      name,
      rootPath,
      addedAt: new Date().toISOString(),
    };
    await projectStore.set(project);
    worktreeService.setRootPath(project.rootPath);
    await taskStore.migrateMissingProjectIds(project.id);
    return project;
  });

  ipcMain.handle('project:clear', async () => {
    await projectStore.clear();
  });

  ipcMain.handle('tasks:getAll', async () => {
    const project = projectStore.get();
    if (!project) {
      return [];
    }
    return taskStore.getAll(project.id);
  });

  ipcMain.handle('tasks:create', async (_e, input: { title: string; agent: Agent }) => {
    const project = projectStore.get();
    if (!project) {
      throw new Error('No project open');
    }
    return taskStore.create({ ...input, projectId: project.id });
  });
  ipcMain.handle('tasks:update', async (_e, id, patch) =>
    taskStore.update(id, patch),
  );
  ipcMain.handle('tasks:delete', async (_e, id) => taskStore.delete(id));

  ipcMain.handle('session:start', async (_e, task: Task) => {
    const project = projectStore.get();
    if (!project) {
      throw new Error('No project open');
    }
    const win =
      mainWindow ??
      BrowserWindow.getFocusedWindow() ??
      BrowserWindow.getAllWindows()[0];
    if (!win) {
      throw new Error('No browser window');
    }
    return sessionManager.startSession(task, project, win);
  });

  ipcMain.handle('session:stop', async (_e, sessionId: string) => {
    return sessionManager.stopSession(sessionId);
  });

  ipcMain.handle('session:get', async (_e, taskId: string) => {
    return sessionManager.getSession(taskId);
  });

  ipcMain.handle('session:getAll', async () => {
    return sessionManager.getAllSessions();
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