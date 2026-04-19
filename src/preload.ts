import { contextBridge, ipcRenderer } from 'electron';
import type { Agent, Task } from './types';

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  tasks: {
    getAll: () => ipcRenderer.invoke('tasks:getAll') as Promise<Task[]>,
    create: (input: { title: string; agent: Agent }) =>
      ipcRenderer.invoke('tasks:create', input) as Promise<Task>,
    update: (
      id: string,
      patch: Partial<Pick<Task, 'title' | 'status' | 'agent'>>,
    ) => ipcRenderer.invoke('tasks:update', id, patch) as Promise<Task>,
    delete: (id: string) =>
      ipcRenderer.invoke('tasks:delete', id) as Promise<void>,
  },
});
