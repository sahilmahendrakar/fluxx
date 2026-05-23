import type {
  Agent,
  ExecutionDeviceConfig,
  RemoteSessionLifecycleStatus,
  TerminalSessionRecord,
} from '../../types';
import type { SshTerminalBackend } from '../terminalBackend/SshTerminalBackend';
import {
  emptyTmuxReconcileCounts,
  findUntrackedFluxxTmuxSessions,
  formatTmuxReconcileLogLine,
  mergeTmuxReconcileCounts,
  sortOpenTmuxRowsForRestore,
  type TmuxTerminalReconcileResult,
} from '../tmux/tmuxTerminalReconcile';
import type { RemoteHelperClient } from './RemoteHelperClient';
import {
  isRemoteHelperVersionCompatible,
  type RemoteHelperListTerminalsData,
  type RemoteHelperListTmuxSessionsData,
  type RemoteHelperPathExistsData,
} from './remoteHelperProtocol';

export type RemoteManifestTerminal = RemoteHelperListTerminalsData['terminals'][number];

export type RemoteSshDeviceReconcileFailure =
  | 'device-unreachable'
  | 'helper-mismatch'
  | 'list-terminals-failed';

export type RemoteSshReconcileResult = TmuxTerminalReconcileResult & {
  deviceFailures: Array<{ deviceId: string; failure: RemoteSshDeviceReconcileFailure; message: string }>;
  interruptedRecords: Array<{
    record: TerminalSessionRecord;
    lifecycleStatus: RemoteSessionLifecycleStatus;
  }>;
  restoredSessionTaskPairs: Array<{ sessionId: string; taskId: string }>;
};

export function remoteManifestRowToTerminalRecord(row: RemoteManifestTerminal): TerminalSessionRecord {
  const base: TerminalSessionRecord = {
    id: row.id,
    kind: row.kind as TerminalSessionRecord['kind'],
    runtime: 'tmux',
    projectId: row.projectId,
    cwd: row.cwd,
    command: row.command,
    args: [...row.args],
    cols: 80,
    rows: 24,
    startedAt: row.startedAt,
    ...(row.repoId ? { repoId: row.repoId } : {}),
    ...(row.deviceId ? { deviceId: row.deviceId } : {}),
    ...(row.deviceKind ? { deviceKind: row.deviceKind as TerminalSessionRecord['deviceKind'] } : {}),
    ...(row.hostLabel ? { hostLabel: row.hostLabel } : {}),
    ...(row.tmuxSessionName ? { tmuxSessionName: row.tmuxSessionName } : {}),
  };

  if (row.kind === 'task' && row.task) {
    return {
      ...base,
      task: {
        taskId: row.task.taskId,
        agent: row.task.agent as Agent,
        worktreePath: row.task.worktreePath,
        fluxxWorkBranch: row.task.fluxxWorkBranch,
        ...(row.task.sourceBranchShort ? { sourceBranchShort: row.task.sourceBranchShort } : {}),
      },
    };
  }

  if (row.kind === 'shell' && row.shell) {
    return {
      ...base,
      shell: {
        parentSessionId: row.shell.parentSessionId,
        worktreePath: row.shell.worktreePath,
      },
    };
  }

  return base;
}

function isConnectFailureCode(code: string): boolean {
  return (
    code === 'SSH_CONNECT_FAILED' ||
    code === 'SSH_TIMEOUT' ||
    code === 'SSH_AUTH_FAILED' ||
    code === 'SSH_HOST_KEY_FAILED'
  );
}

export function formatRemoteSshReconcileLogLine(result: RemoteSshReconcileResult): string {
  const base = formatTmuxReconcileLogLine(result);
  const failures =
    result.deviceFailures.length > 0
      ? ` deviceFailures=${result.deviceFailures.length}`
      : '';
  const interrupted =
    result.interruptedRecords.length > 0
      ? ` interrupted=${result.interruptedRecords.length}`
      : '';
  return `[ssh-reconcile]${base.replace('[tmux-reconcile]', '')}${failures}${interrupted}`;
}

export async function reconcileRemoteSshTerminalsForProject(params: {
  projectId: string;
  devices: ExecutionDeviceConfig[];
  helper: RemoteHelperClient;
  sshBackend: SshTerminalBackend;
  localOpenRecords?: TerminalSessionRecord[];
}): Promise<RemoteSshReconcileResult> {
  const counts = emptyTmuxReconcileCounts();
  const untrackedFluxxSessions: string[] = [];
  const deviceFailures: RemoteSshReconcileResult['deviceFailures'] = [];
  const interruptedRecords: RemoteSshReconcileResult['interruptedRecords'] = [];
  const restoredSessionTaskPairs: Array<{ sessionId: string; taskId: string }> = [];

  for (const device of params.devices) {
    if (device.kind !== 'ssh' || !device.enabled || !device.ssh) continue;

    const install = await params.helper.ensureInstalled(device);
    if (!install.ok) {
      const failure: RemoteSshDeviceReconcileFailure =
        install.phase === 'helper-bootstrap' ? 'helper-mismatch' : 'device-unreachable';
      deviceFailures.push({
        deviceId: device.id,
        failure,
        message: install.message,
      });
      await markDeviceOpenRowsInterrupted(
        { ...params, localOpenRecords: params.localOpenRecords },
        device,
        failure,
        interruptedRecords,
      );
      continue;
    }
    if (!isRemoteHelperVersionCompatible(install.version)) {
      deviceFailures.push({
        deviceId: device.id,
        failure: 'helper-mismatch',
        message: `Remote helper version mismatch (remote ${install.version})`,
      });
      await markDeviceOpenRowsInterrupted(
        { ...params, localOpenRecords: params.localOpenRecords },
        device,
        'helper-mismatch',
        interruptedRecords,
      );
      continue;
    }

    const listed = await params.helper.runJsonCommand<RemoteHelperListTerminalsData>(
      device,
      'list-terminals',
      { deviceId: device.id },
    );
    if (!listed.ok) {
      const failure: RemoteSshDeviceReconcileFailure = isConnectFailureCode(listed.code)
        ? 'device-unreachable'
        : 'list-terminals-failed';
      deviceFailures.push({ deviceId: device.id, failure, message: listed.message });
      if (failure === 'device-unreachable') {
        await markDeviceOpenRowsInterrupted(
        { ...params, localOpenRecords: params.localOpenRecords },
        device,
        failure,
        interruptedRecords,
      );
      }
      continue;
    }

    const projectRows = listed.data.terminals.filter((t) => t.projectId === params.projectId);
    const records = sortOpenTmuxRowsForRestore(
      projectRows.map(remoteManifestRowToTerminalRecord),
      params.projectId,
    );

    const trackedTmuxNames = new Set(
      records.map((r) => r.tmuxSessionName?.trim()).filter((n): n is string => Boolean(n)),
    );

    const tmuxList = await params.helper.runJsonCommand<RemoteHelperListTmuxSessionsData>(
      device,
      'list-tmux-sessions',
      {},
    );
  const allTmuxNames = tmuxList.ok ? tmuxList.data.sessionNames : [];
    const deviceUntracked = findUntrackedFluxxTmuxSessions(allTmuxNames, trackedTmuxNames);
    for (const name of deviceUntracked) {
      if (!untrackedFluxxSessions.includes(name)) untrackedFluxxSessions.push(name);
    }

    const tmuxPresent = new Set(allTmuxNames);
    const pathExistsCache = new Map<string, boolean>();

    async function remotePathExists(absPath: string): Promise<boolean> {
      const key = absPath.trim();
      if (!key) return false;
      const cached = pathExistsCache.get(key);
      if (cached !== undefined) return cached;
      const probe = await params.helper.runJsonCommand<RemoteHelperPathExistsData>(
        device,
        'path-exists',
        { path: key },
      );
      const exists = probe.ok ? probe.data.exists : false;
      pathExistsCache.set(key, exists);
      return exists;
    }

    for (const record of records) {
      const tmuxName = record.tmuxSessionName?.trim();
      if (!tmuxName) {
        counts.skipped += 1;
        continue;
      }

      if (record.kind === 'task') {
        if (params.sshBackend.hasSession(record.id)) {
          counts.skipped += 1;
          continue;
        }
        const taskMeta = record.task;
        if (!taskMeta) {
          counts.skipped += 1;
          continue;
        }
        const wt = taskMeta.worktreePath?.trim();
        if (!wt || !(await remotePathExists(wt))) {
          counts.workspaceMissing.task += 1;
          interruptedRecords.push({
            record,
            lifecycleStatus: 'workspace-missing',
          });
          continue;
        }
        if (!tmuxPresent.has(tmuxName)) {
          counts.missing.task += 1;
          interruptedRecords.push({ record, lifecycleStatus: 'tmux-missing' });
          continue;
        }
        params.sshBackend.registerTaskSession({
          session: {
            id: record.id,
            taskId: taskMeta.taskId,
            projectId: record.projectId,
            ...(record.repoId ? { repoId: record.repoId } : {}),
            worktreePath: taskMeta.worktreePath,
            branch: taskMeta.fluxxWorkBranch,
            status: 'running',
            startedAt: record.startedAt,
            deviceId: device.id,
            deviceKind: 'ssh',
            deviceLabel: device.displayName,
            remotePath: taskMeta.worktreePath,
          },
          deviceId: device.id,
          tmuxSessionName: tmuxName,
          agent: taskMeta.agent,
          cols: record.cols,
          rows: record.rows,
        });
        counts.restored.task += 1;
        restoredSessionTaskPairs.push({ sessionId: record.id, taskId: taskMeta.taskId });
        continue;
      }

      if (record.kind === 'shell') {
        if (params.sshBackend.hasShell(record.id)) {
          counts.skipped += 1;
          continue;
        }
        const shellMeta = record.shell;
        if (!shellMeta) {
          counts.skipped += 1;
          continue;
        }
        if (!params.sshBackend.hasSession(shellMeta.parentSessionId)) {
          counts.skipped += 1;
          continue;
        }
        const wt = shellMeta.worktreePath?.trim();
        if (!wt || !(await remotePathExists(wt))) {
          counts.workspaceMissing.shell += 1;
          interruptedRecords.push({ record, lifecycleStatus: 'workspace-missing' });
          continue;
        }
        if (!tmuxPresent.has(tmuxName)) {
          counts.missing.shell += 1;
          interruptedRecords.push({ record, lifecycleStatus: 'tmux-missing' });
          continue;
        }
        params.sshBackend.registerShellSession({
          shell: {
            id: record.id,
            sessionId: shellMeta.parentSessionId,
            worktreePath: shellMeta.worktreePath,
            status: 'running',
            startedAt: record.startedAt,
            deviceId: device.id,
            deviceKind: 'ssh',
            deviceLabel: device.displayName,
            remotePath: shellMeta.worktreePath,
          },
          deviceId: device.id,
          tmuxSessionName: tmuxName,
          cols: record.cols,
          rows: record.rows,
        });
        counts.restored.shell += 1;
      }
    }
  }

  return {
    ...counts,
    untrackedFluxxSessions,
    deviceFailures,
    interruptedRecords,
    restoredSessionTaskPairs,
  };
}

async function markDeviceOpenRowsInterrupted(
  params: {
    projectId: string;
    helper: RemoteHelperClient;
    sshBackend: SshTerminalBackend;
    localOpenRecords?: TerminalSessionRecord[];
  },
  device: ExecutionDeviceConfig,
  lifecycleStatus: RemoteSessionLifecycleStatus,
  interruptedRecords: RemoteSshReconcileResult['interruptedRecords'],
): Promise<void> {
  const listed = await params.helper.runJsonCommand<RemoteHelperListTerminalsData>(
    device,
    'list-terminals',
    { deviceId: device.id },
  );

  const rows: TerminalSessionRecord[] =
    listed?.ok === true
      ? listed.data.terminals
          .filter((row) => row.projectId === params.projectId && !row.endedAt)
          .map(remoteManifestRowToTerminalRecord)
      : (params.localOpenRecords ?? []).filter(
          (row) => row.deviceId === device.id && row.deviceKind === 'ssh',
        );

  for (const record of rows) {
    if (params.sshBackend.hasSession(record.id) || params.sshBackend.hasShell(record.id)) {
      continue;
    }
    if (record.kind === 'task' || record.kind === 'shell') {
      interruptedRecords.push({ record, lifecycleStatus });
    }
  }
}

export function mergeRemoteSshReconcileResults(
  into: RemoteSshReconcileResult,
  delta: Partial<RemoteSshReconcileResult>,
): void {
  mergeTmuxReconcileCounts(into, delta);
  if (delta.untrackedFluxxSessions) {
    for (const name of delta.untrackedFluxxSessions) {
      if (!into.untrackedFluxxSessions.includes(name)) into.untrackedFluxxSessions.push(name);
    }
  }
  if (delta.deviceFailures) into.deviceFailures.push(...delta.deviceFailures);
  if (delta.interruptedRecords) into.interruptedRecords.push(...delta.interruptedRecords);
  if (delta.restoredSessionTaskPairs) {
    into.restoredSessionTaskPairs.push(...delta.restoredSessionTaskPairs);
  }
}
