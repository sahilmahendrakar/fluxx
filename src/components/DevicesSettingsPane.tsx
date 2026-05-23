import { useCallback, useEffect, useMemo, useState } from 'react';
import { Monitor, Server } from 'lucide-react';
import type {
  CloudProject,
  ExecutionDeviceConfig,
  ExecutionDeviceUpdateInput,
  LocalProject,
  SshExecutionDeviceUpsertInput,
} from '../types';
import { BUILTIN_LOCAL_DEVICE_ID, DEFAULT_SSH_WORKSPACE_ROOT } from '../executionDevices/constants';
import { useExecutionDevices } from '../hooks/useExecutionDevices';
import ConfirmDialog from './ConfirmDialog';

const INPUT_CLASS =
  'mt-1 w-full rounded-md border border-white/[0.08] bg-[#09090b] px-3 py-2 text-[13px] text-zinc-100 outline-none focus-visible:border-white/[0.14] focus-visible:ring-1 focus-visible:ring-white/[0.12]';

type ProjectRef = LocalProject | CloudProject;

function probeStatusLabel(device: ExecutionDeviceConfig): string {
  const probe = device.lastProbe;
  if (!probe) return 'Not probed yet';
  if (probe.status === 'available') return 'Available';
  if (probe.status === 'unavailable') return probe.message ?? 'Unavailable';
  if (probe.status === 'probing') return 'Probing…';
  return 'Unknown';
}

function SshDeviceFormModal({
  initial,
  onClose,
  onSave,
}: {
  initial?: ExecutionDeviceConfig;
  onClose: () => void;
  onSave: (input: SshExecutionDeviceUpsertInput) => Promise<void>;
}) {
  const [displayName, setDisplayName] = useState(initial?.displayName ?? '');
  const [host, setHost] = useState(initial?.ssh?.host ?? '');
  const [user, setUser] = useState(initial?.ssh?.user ?? '');
  const [port, setPort] = useState(
    initial?.ssh?.port != null ? String(initial.ssh.port) : '',
  );
  const [workspaceRoot, setWorkspaceRoot] = useState(
    initial?.workspaceRoot ?? DEFAULT_SSH_WORKSPACE_ROOT,
  );
  const [tmuxEnabled, setTmuxEnabled] = useState(initial?.tmux.enabled ?? true);
  const [shell, setShell] = useState(initial?.shell ?? '');
  const [extraArgs, setExtraArgs] = useState(initial?.ssh?.extraArgs?.join(' ') ?? '');
  const [connectTimeout, setConnectTimeout] = useState(
    initial?.ssh?.connectTimeoutSeconds != null
      ? String(initial.ssh.connectTimeoutSeconds)
      : '',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const portNum = port.trim() ? Number(port) : undefined;
    const timeoutNum = connectTimeout.trim() ? Number(connectTimeout) : undefined;
    const args = extraArgs
      .split(/\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      await onSave({
        displayName,
        host,
        user: user.trim() || undefined,
        port: portNum != null && Number.isFinite(portNum) ? portNum : undefined,
        workspaceRoot,
        tmuxEnabled,
        shell: shell.trim() || undefined,
        extraArgs: args.length > 0 ? args : undefined,
        connectTimeoutSeconds:
          timeoutNum != null && Number.isFinite(timeoutNum) ? timeoutNum : undefined,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => void handleSubmit(e)}
        className="max-h-[90vh] w-[min(520px,92vw)] overflow-y-auto rounded-xl border border-white/[0.08] bg-[#0c0c0e] p-5 shadow-2xl"
      >
        <h2 className="text-[15px] font-semibold text-zinc-100">
          {initial ? 'Edit SSH device' : 'Add SSH device'}
        </h2>
        <p className="mt-1 text-[12px] text-zinc-500">
          Uses your OpenSSH config on this computer (aliases, keys, ProxyJump). Probe and remote
          sessions ship in a later release.
        </p>
        <div className="mt-4 space-y-3">
          <label className="block text-[11px] font-medium text-zinc-400">
            Display name
            <input
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className={INPUT_CLASS}
              placeholder="M4 Mac mini"
            />
          </label>
          <label className="block text-[11px] font-medium text-zinc-400">
            SSH host alias or hostname
            <input
              required
              value={host}
              onChange={(e) => setHost(e.target.value)}
              className={INPUT_CLASS}
              placeholder="devbox"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-[11px] font-medium text-zinc-400">
              User (optional)
              <input value={user} onChange={(e) => setUser(e.target.value)} className={INPUT_CLASS} />
            </label>
            <label className="block text-[11px] font-medium text-zinc-400">
              Port (optional)
              <input
                value={port}
                onChange={(e) => setPort(e.target.value)}
                className={INPUT_CLASS}
                inputMode="numeric"
              />
            </label>
          </div>
          <label className="block text-[11px] font-medium text-zinc-400">
            Remote workspace root
            <input
              required
              value={workspaceRoot}
              onChange={(e) => setWorkspaceRoot(e.target.value)}
              className={INPUT_CLASS}
            />
          </label>
          <label className="block text-[11px] font-medium text-zinc-400">
            Shell (optional)
            <input value={shell} onChange={(e) => setShell(e.target.value)} className={INPUT_CLASS} />
          </label>
          <label className="block text-[11px] font-medium text-zinc-400">
            Extra SSH args (optional)
            <input
              value={extraArgs}
              onChange={(e) => setExtraArgs(e.target.value)}
              className={INPUT_CLASS}
              placeholder="-o BatchMode=yes"
            />
          </label>
          <label className="block text-[11px] font-medium text-zinc-400">
            Connect timeout (seconds, optional)
            <input
              value={connectTimeout}
              onChange={(e) => setConnectTimeout(e.target.value)}
              className={INPUT_CLASS}
              inputMode="numeric"
            />
          </label>
          <label className="flex cursor-pointer items-start gap-2 text-[12px] text-zinc-300">
            <input
              type="checkbox"
              checked={tmuxEnabled}
              onChange={(e) => setTmuxEnabled(e.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-white/[0.2]"
            />
            <span className="leading-snug">
              <span className="font-medium text-zinc-100">Persist terminals with tmux</span>
              <span className="mt-1 block text-[11px] text-zinc-500">
                When on, Fluxx runs sessions in tmux on this host and fails if tmux is unavailable
                (no fallback to non-tmux terminals).
              </span>
            </span>
          </label>
        </div>
        {error ? (
          <p className="mt-3 text-[12px] text-red-300/95" role="alert">
            {error}
          </p>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-[13px] text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-emerald-600/90 px-4 py-1.5 text-[13px] font-medium text-emerald-950 hover:bg-emerald-500/90 disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}

export function DevicesSettingsPane({ project }: { project: ProjectRef | null }) {
  const { devices, loading, reload } = useExecutionDevices();
  const [globalDefaultId, setGlobalDefaultId] = useState<string | null>(null);
  const [projectDefaultId, setProjectDefaultId] = useState<string | null>(null);
  const [defaultsLoading, setDefaultsLoading] = useState(true);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [editorDevice, setEditorDevice] = useState<ExecutionDeviceConfig | 'new' | null>(null);
  const [removeTarget, setRemoveTarget] = useState<ExecutionDeviceConfig | null>(null);

  const loadDefaults = useCallback(async () => {
    setDefaultsLoading(true);
    try {
      const globalId = await window.electronAPI.executionDevices.getGlobalDefault();
      setGlobalDefaultId(globalId);
      if (project?.kind === 'local') {
        const pid = await window.electronAPI.project.getDefaultDeviceId();
        setProjectDefaultId(pid);
      } else if (project?.kind === 'cloud') {
        const pid = await window.electronAPI.cloudBindings.getProjectDefaultDeviceId(project.id);
        setProjectDefaultId(pid);
      } else {
        setProjectDefaultId(null);
      }
    } catch (err) {
      console.error('[DevicesSettingsPane] load defaults failed', err);
    } finally {
      setDefaultsLoading(false);
    }
  }, [project?.id, project?.kind]);

  useEffect(() => {
    void loadDefaults();
  }, [loadDefaults]);

  const enabledDevices = useMemo(
    () => devices.filter((d) => d.enabled),
    [devices],
  );

  const defaultSelectOptions = useMemo(() => {
    const opts = enabledDevices.map((d) => ({ id: d.id, label: d.displayName }));
    return opts;
  }, [enabledDevices]);

  const setGlobalDefault = async (deviceId: string | null) => {
    setSaveError(null);
    try {
      const next = await window.electronAPI.executionDevices.setGlobalDefault(deviceId);
      setGlobalDefaultId(next);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    }
  };

  const setProjectDefault = async (deviceId: string | null) => {
    if (!project) return;
    setSaveError(null);
    try {
      if (project.kind === 'local') {
        const next = await window.electronAPI.project.setDefaultDeviceId(deviceId);
        setProjectDefaultId(next);
      } else {
        const next = await window.electronAPI.cloudBindings.setProjectDefaultDeviceId(
          project.id,
          deviceId,
        );
        setProjectDefaultId(next);
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSaveSsh = async (input: SshExecutionDeviceUpsertInput) => {
    if (editorDevice === 'new') {
      await window.electronAPI.executionDevices.createSsh(input);
    } else if (editorDevice) {
      const patch: ExecutionDeviceUpdateInput = { ...input };
      await window.electronAPI.executionDevices.update(editorDevice.id, patch);
    }
    await reload();
  };

  const toggleEnabled = async (device: ExecutionDeviceConfig) => {
    if (device.id === BUILTIN_LOCAL_DEVICE_ID) return;
    setSaveError(null);
    try {
      await window.electronAPI.executionDevices.update(device.id, {
        enabled: !device.enabled,
      });
      await reload();
      await loadDefaults();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    }
  };

  const confirmRemove = async () => {
    if (!removeTarget) return;
    setSaveError(null);
    try {
      await window.electronAPI.executionDevices.remove(removeTarget.id);
      setRemoveTarget(null);
      await reload();
      await loadDefaults();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-10 pt-24">
      <div className="mx-auto max-w-2xl">
        <h1 className="text-[22px] font-semibold tracking-tight text-zinc-50">Devices</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-zinc-500">
          SSH devices are private to this Fluxx Desktop install and apply across all projects on this
          machine. Teammates on cloud projects never see your SSH hosts or keys.
        </p>

        <section className="mt-6 rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-4">
          <h2 className="text-[14px] font-semibold text-zinc-100">Defaults for new tasks</h2>
          <p className="mt-1 text-[12px] text-zinc-500">
            Resolution order for new tasks: project override → global default → built-in local
            computer.
          </p>
          <div className="mt-4 space-y-4">
            <label className="block text-[12px] font-medium text-zinc-300">
              Global default (all projects)
              <select
                disabled={defaultsLoading}
                value={globalDefaultId ?? ''}
                onChange={(e) => void setGlobalDefault(e.target.value || null)}
                className={`${INPUT_CLASS} cursor-pointer`}
                style={{ colorScheme: 'dark' }}
              >
                <option value="">Built-in local computer</option>
                {defaultSelectOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            {project ? (
              <label className="block text-[12px] font-medium text-zinc-300">
                Project default override
                <span className="mt-0.5 block text-[11px] font-normal text-zinc-500">
                  {project.kind === 'cloud'
                    ? 'Stored in local bindings on this computer only.'
                    : 'Stored in this project’s config on disk.'}
                </span>
                <select
                  disabled={defaultsLoading}
                  value={projectDefaultId ?? ''}
                  onChange={(e) => void setProjectDefault(e.target.value || null)}
                  className={`${INPUT_CLASS} cursor-pointer`}
                  style={{ colorScheme: 'dark' }}
                >
                  <option value="">Inherit global default</option>
                  {defaultSelectOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="text-[12px] text-zinc-600">
                Open a project to set a per-project default override.
              </p>
            )}
          </div>
          {saveError ? (
            <p className="mt-3 text-[12px] text-red-300/95" role="alert">
              {saveError}
            </p>
          ) : null}
        </section>

        <section className="mt-4 rounded-xl border border-white/[0.08] bg-white/[0.02]">
          <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-3">
            <h2 className="text-[14px] font-semibold text-zinc-100">Configured devices</h2>
            <button
              type="button"
              onClick={() => setEditorDevice('new')}
              className="rounded-lg bg-white/[0.06] px-3 py-1.5 text-[12px] font-medium text-zinc-200 ring-1 ring-inset ring-white/[0.08] hover:bg-white/[0.1]"
            >
              Add SSH device
            </button>
          </div>
          {loading ? (
            <p className="px-4 py-6 text-[13px] text-zinc-500">Loading devices…</p>
          ) : (
            <ul className="divide-y divide-white/[0.06]">
              {devices.map((device) => (
                <li key={device.id} className="px-4 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 gap-3">
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.04] text-zinc-400 ring-1 ring-inset ring-white/[0.06]">
                        {device.kind === 'local' ? (
                          <Monitor className="h-4 w-4" strokeWidth={1.75} aria-hidden />
                        ) : (
                          <Server className="h-4 w-4" strokeWidth={1.75} aria-hidden />
                        )}
                      </span>
                      <div className="min-w-0">
                        <p className="text-[14px] font-medium text-zinc-100">
                          {device.displayName}
                          {!device.enabled ? (
                            <span className="ml-2 text-[11px] font-normal text-amber-300/90">
                              Disabled
                            </span>
                          ) : null}
                        </p>
                        <p className="mt-0.5 text-[12px] text-zinc-500">
                          {device.kind === 'local' ? 'Local' : 'SSH'}
                          {device.kind === 'ssh' && device.ssh?.host
                            ? ` · ${device.ssh.host}`
                            : ''}
                          {' · '}
                          Workspace {device.workspaceRoot}
                        </p>
                        <p className="mt-1 text-[11px] text-zinc-600">
                          Tmux persistence {device.tmux.enabled ? 'on' : 'off'}
                          {' · '}
                          {probeStatusLabel(device)}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      {device.kind === 'ssh' ? (
                        <>
                          <button
                            type="button"
                            onClick={() => setEditorDevice(device)}
                            className="rounded-md px-2 py-1 text-[11px] text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => void toggleEnabled(device)}
                            className="rounded-md px-2 py-1 text-[11px] text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200"
                          >
                            {device.enabled ? 'Disable' : 'Enable'}
                          </button>
                          <button
                            type="button"
                            onClick={() => void setGlobalDefault(device.id)}
                            className="rounded-md px-2 py-1 text-[11px] text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200"
                          >
                            Make global default
                          </button>
                          <button
                            type="button"
                            onClick={() => setRemoveTarget(device)}
                            className="rounded-md px-2 py-1 text-[11px] text-red-300/80 hover:bg-red-500/10 hover:text-red-200"
                          >
                            Remove
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void setGlobalDefault(BUILTIN_LOCAL_DEVICE_ID)}
                          className="rounded-md px-2 py-1 text-[11px] text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200"
                        >
                          Make global default
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {editorDevice ? (
        <SshDeviceFormModal
          initial={editorDevice === 'new' ? undefined : editorDevice}
          onClose={() => setEditorDevice(null)}
          onSave={handleSaveSsh}
        />
      ) : null}

      {removeTarget ? (
        <ConfirmDialog
          title="Remove SSH device?"
          description={`Remove "${removeTarget.displayName}" from this computer? Tasks that still reference it will show as missing until you pick another device.`}
          confirmLabel="Remove"
          destructive
          onConfirm={() => void confirmRemove()}
          onCancel={() => setRemoveTarget(null)}
        />
      ) : null}
    </div>
  );
}
