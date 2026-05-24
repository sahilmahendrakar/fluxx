import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ExecutionDeviceConfig, RemoteRepoBindingStatus } from '../types';

type RemoteSshRepoBindingPanelProps = {
  repoId: string;
  repoLabel: string;
  sshDevices: ExecutionDeviceConfig[];
  /** Initial device selection when the panel opens (project default SSH device). */
  projectDefaultDeviceId?: string;
};

function defaultDeviceIdForPanel(
  devices: ExecutionDeviceConfig[],
  projectDefaultDeviceId?: string,
): string {
  const preferred = projectDefaultDeviceId?.trim();
  if (preferred && devices.some((d) => d.id === preferred)) {
    return preferred;
  }
  return devices[0]?.id ?? '';
}

function deviceOptionLabel(device: ExecutionDeviceConfig): string {
  const host = device.ssh?.host?.trim();
  return host ? `${device.displayName} (${host})` : device.displayName;
}

export function RemoteSshRepoBindingPanel({
  repoId,
  repoLabel,
  sshDevices,
  projectDefaultDeviceId,
}: RemoteSshRepoBindingPanelProps) {
  const [selectedDeviceId, setSelectedDeviceId] = useState(() =>
    defaultDeviceIdForPanel(sshDevices, projectDefaultDeviceId),
  );

  const selectedDevice = useMemo(
    () => sshDevices.find((d) => d.id === selectedDeviceId) ?? sshDevices[0] ?? null,
    [sshDevices, selectedDeviceId],
  );

  const [status, setStatus] = useState<RemoteRepoBindingStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [remotePath, setRemotePath] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'idle' | 'probe' | 'save' | 'clear'>('idle');
  const [probeOk, setProbeOk] = useState<{
    hostLabel: string;
    resolvedPath: string;
    originUrl: string;
  } | null>(null);

  useEffect(() => {
    const next = defaultDeviceIdForPanel(sshDevices, projectDefaultDeviceId);
    setSelectedDeviceId((current) =>
      sshDevices.some((d) => d.id === current) ? current : next,
    );
  }, [sshDevices, projectDefaultDeviceId]);

  const refresh = useCallback(async () => {
    if (!selectedDevice) {
      setStatus(null);
      setLoadError(null);
      return;
    }
    try {
      const r = await window.electronAPI.project.getRemoteRepoBindingsOverview({
        deviceId: selectedDevice.id,
        repoIds: [repoId],
      });
      if (r && typeof r === 'object' && 'error' in r) {
        setLoadError((r as { error: string }).error);
        setStatus(null);
        return;
      }
      const st = (r as Record<string, RemoteRepoBindingStatus>)[repoId] ?? { kind: 'unbound' };
      setStatus(st);
      setLoadError(null);
      setRemotePath(st.kind === 'bound' ? st.remotePath : '');
      setProbeOk(null);
      setActionError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
      setStatus(null);
    }
  }, [selectedDevice, repoId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleDeviceChange = (deviceId: string) => {
    setSelectedDeviceId(deviceId);
    setProbeOk(null);
    setActionError(null);
  };

  if (sshDevices.length === 0) {
    return (
      <div className="rounded-lg border border-white/[0.06] bg-black/10 px-3 py-2">
        <div className="text-[12px] font-medium text-zinc-300">Remote SSH folder</div>
        <p className="mt-1 text-[11px] leading-snug text-zinc-500">
          Add an SSH device in Settings → Devices to bind an existing clone on a remote host.
        </p>
      </div>
    );
  }

  if (!selectedDevice) {
    return null;
  }

  const hostLabel =
    status?.kind === 'bound' ? status.hostLabel : selectedDevice.displayName;

  const handleProbe = async () => {
    const trimmed = remotePath.trim();
    if (!trimmed) {
      setActionError('Enter an absolute path on the SSH host.');
      return;
    }
    setBusy('probe');
    setActionError(null);
    setProbeOk(null);
    try {
      const r = await window.electronAPI.project.probeRemoteRepoBinding({
        deviceId: selectedDevice.id,
        repoId,
        remotePath: trimmed,
      });
      if ('error' in r) {
        setActionError(r.error);
        return;
      }
      setProbeOk({
        hostLabel: r.hostLabel,
        resolvedPath: r.resolvedPath,
        originUrl: r.originUrl,
      });
      setRemotePath(r.resolvedPath);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('idle');
    }
  };

  const handleSave = async () => {
    const trimmed = remotePath.trim();
    if (!trimmed) {
      setActionError('Enter an absolute path on the SSH host.');
      return;
    }
    setBusy('save');
    setActionError(null);
    try {
      const r = await window.electronAPI.project.setRemoteRepoBinding({
        deviceId: selectedDevice.id,
        repoId,
        remotePath: trimmed,
      });
      if ('error' in r) {
        setActionError(r.error);
        return;
      }
      setProbeOk(null);
      await refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('idle');
    }
  };

  const handleClear = async () => {
    setBusy('clear');
    setActionError(null);
    try {
      const r = await window.electronAPI.project.clearRemoteRepoBinding({
        deviceId: selectedDevice.id,
        repoId,
      });
      if ('error' in r) {
        setActionError(r.error);
        return;
      }
      setRemotePath('');
      setProbeOk(null);
      await refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('idle');
    }
  };

  const isBound = status?.kind === 'bound';
  const showDevicePicker = sshDevices.length > 1;

  return (
    <div className="rounded-lg border border-white/[0.06] bg-black/10 px-3 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-medium text-zinc-300">Remote SSH folder</div>
          <p className="mt-0.5 text-[11px] leading-snug text-zinc-500">
            Bind an existing git clone of <span className="text-zinc-400">{repoLabel}</span> per SSH
            device. Paths are stored only on this Mac.
          </p>
        </div>
        {isBound ? (
          <span className="rounded-full border border-emerald-500/20 bg-emerald-500/[0.08] px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">
            Bound
          </span>
        ) : (
          <span className="rounded-full border border-zinc-500/25 bg-zinc-500/[0.06] px-1.5 py-0.5 text-[10px] text-zinc-400">
            Auto-managed
          </span>
        )}
      </div>

      {showDevicePicker ? (
        <label className="mt-3 block">
          <span className="text-[11px] font-medium text-zinc-400">SSH device</span>
          <select
            value={selectedDevice.id}
            onChange={(e) => handleDeviceChange(e.target.value)}
            disabled={busy !== 'idle'}
            className="mt-1 w-full rounded-md border border-white/[0.08] bg-black/20 px-2.5 py-1.5 text-[12px] text-zinc-100 outline-none focus:border-white/[0.16] disabled:opacity-50"
          >
            {sshDevices.map((d) => (
              <option key={d.id} value={d.id}>
                {deviceOptionLabel(d)}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="mt-2 text-[11px] text-zinc-500">
          Device: <span className="text-zinc-400">{deviceOptionLabel(selectedDevice)}</span>
        </p>
      )}

      {loadError ? (
        <p className="mt-2 text-[11px] text-red-300">{loadError}</p>
      ) : null}

      {isBound ? (
        <p
          className="mt-2 truncate font-mono text-[11px] text-zinc-600"
          title={status.remotePath}
        >
          {hostLabel}: {status.remotePath}
        </p>
      ) : null}

      <label className="mt-3 block">
        <span className="text-[11px] font-medium text-zinc-400">Absolute path on SSH host</span>
        <input
          value={remotePath}
          onChange={(e) => {
            setRemotePath(e.target.value);
            setProbeOk(null);
            setActionError(null);
          }}
          placeholder="/home/you/projects/my-repo"
          spellCheck={false}
          disabled={busy !== 'idle'}
          className="mt-1 w-full rounded-md border border-white/[0.08] bg-black/20 px-2.5 py-1.5 font-mono text-[12px] text-zinc-100 outline-none focus:border-white/[0.16] disabled:opacity-50"
        />
      </label>

      {probeOk ? (
        <p className="mt-2 text-[11px] text-emerald-300">
          Valid on {probeOk.hostLabel}: <span className="font-mono">{probeOk.resolvedPath}</span>
          {' · '}
          origin matches
        </p>
      ) : null}

      {actionError ? (
        <p className="mt-2 rounded-md border border-red-500/30 bg-red-500/[0.06] px-2 py-1.5 text-[11px] text-red-300">
          {actionError}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap justify-end gap-2">
        {isBound ? (
          <button
            type="button"
            onClick={() => void handleClear()}
            disabled={busy !== 'idle'}
            className="rounded-md border border-white/[0.08] bg-white/[0.02] px-2.5 py-1.5 text-[12px] font-medium text-zinc-400 transition hover:bg-white/[0.05] hover:text-zinc-200 disabled:opacity-50"
          >
            {busy === 'clear' ? 'Clearing…' : 'Clear binding'}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => void handleProbe()}
          disabled={busy !== 'idle'}
          className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-[12px] font-medium text-zinc-200 transition hover:bg-white/[0.07] disabled:opacity-50"
        >
          {busy === 'probe' ? 'Validating…' : 'Validate'}
        </button>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={busy !== 'idle'}
          className="rounded-md border border-emerald-800/50 bg-emerald-950/40 px-2.5 py-1.5 text-[12px] font-medium text-emerald-100/90 transition hover:bg-emerald-950/60 disabled:opacity-50"
        >
          {busy === 'save' ? 'Saving…' : isBound ? 'Change folder' : 'Bind remote folder'}
        </button>
      </div>
    </div>
  );
}
