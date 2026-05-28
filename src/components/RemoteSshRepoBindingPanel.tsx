import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
      <Card className="bg-muted/30 shadow-none">
        <CardContent className="px-3 py-2">
          <div className="text-xs font-medium">Remote SSH folder</div>
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
            Add an SSH device in Settings → Devices to bind an existing clone on a remote host.
          </p>
        </CardContent>
      </Card>
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
    <Card className="bg-muted/30 shadow-none">
      <CardContent className="flex flex-col gap-3 p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium">Remote SSH folder</div>
            <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
              Bind an existing git clone of <span className="text-foreground">{repoLabel}</span> per SSH
              device. Paths are stored only on this Mac.
            </p>
          </div>
          {isBound ? (
            <Badge
              variant="outline"
              className="border-status-success/30 bg-status-success/10 text-status-success-foreground"
            >
              Bound
            </Badge>
          ) : (
            <Badge variant="secondary">Auto-managed</Badge>
          )}
        </div>

        {showDevicePicker ? (
          <div className="flex flex-col gap-2">
            <Label className="text-[11px] text-muted-foreground">SSH device</Label>
            <Select
              value={selectedDevice.id}
              onValueChange={handleDeviceChange}
              disabled={busy !== 'idle'}
            >
              <SelectTrigger className="text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sshDevices.map((d) => (
                  <SelectItem key={d.id} value={d.id} className="text-xs">
                    {deviceOptionLabel(d)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            Device: <span className="text-foreground">{deviceOptionLabel(selectedDevice)}</span>
          </p>
        )}

        {loadError ? (
          <p className="text-[11px] text-destructive">{loadError}</p>
        ) : null}

        {isBound ? (
          <p className="truncate font-mono text-[11px] text-muted-foreground" title={status.remotePath}>
            {hostLabel}: {status.remotePath}
          </p>
        ) : null}

        <div className="flex flex-col gap-2">
          <Label className="text-[11px] text-muted-foreground">Absolute path on SSH host</Label>
          <Input
            value={remotePath}
            onChange={(e) => {
              setRemotePath(e.target.value);
              setProbeOk(null);
              setActionError(null);
            }}
            placeholder="/home/you/projects/my-repo"
            spellCheck={false}
            disabled={busy !== 'idle'}
            className="font-mono text-xs"
          />
        </div>

        {probeOk ? (
          <p className="text-[11px] text-status-success">
            Valid on {probeOk.hostLabel}: <span className="font-mono">{probeOk.resolvedPath}</span>
            {' · '}
            origin matches
          </p>
        ) : null}

        {actionError ? (
          <Alert variant="destructive">
            <AlertDescription className="text-[11px]">{actionError}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2">
          {isBound ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handleClear()}
              disabled={busy !== 'idle'}
            >
              {busy === 'clear' ? 'Clearing…' : 'Clear binding'}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void handleProbe()}
            disabled={busy !== 'idle'}
          >
            {busy === 'probe' ? 'Validating…' : 'Validate'}
          </Button>
          <Button
            type="button"
            size="sm"
            className="bg-status-success text-status-success-foreground hover:bg-status-success/90"
            onClick={() => void handleSave()}
            disabled={busy !== 'idle'}
          >
            {busy === 'save' ? 'Saving…' : isBound ? 'Change folder' : 'Bind remote folder'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
