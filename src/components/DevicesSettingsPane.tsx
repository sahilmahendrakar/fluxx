import { useCallback, useEffect, useMemo, useState } from 'react';
import { ExecutionDeviceKindIcon } from './ExecutionDeviceKindIcon';
import type {
  CloudProject,
  ExecutionDeviceConfig,
  ExecutionDeviceUpdateInput,
  LocalProject,
  SshExecutionDeviceUpsertInput,
} from '../types';
import { BUILTIN_LOCAL_DEVICE_ID, DEFAULT_SSH_WORKSPACE_ROOT } from '../executionDevices/constants';
import {
  buildAvailableProbeMessage,
  probeAgentWarningMessage,
} from '../executionDevices/probeAgents';
import { useExecutionDevices } from '../hooks/useExecutionDevices';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import ConfirmDialog from './ConfirmDialog';

type ProjectRef = LocalProject | CloudProject;

function probeStatusLabel(device: ExecutionDeviceConfig): string {
  const probe = device.lastProbe;
  if (!probe) return 'Not probed yet';
  if (probe.status === 'available') {
    return probe.message ?? buildAvailableProbeMessage(probe.capabilities);
  }
  if (probe.status === 'unavailable') {
    if (probe.phase) return `${probe.message ?? 'Unavailable'} · phase: ${probe.phase}`;
    return probe.message ?? 'Unavailable';
  }
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
  const [forwardAgent, setForwardAgent] = useState(initial?.ssh?.forwardAgent === true);
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
        forwardAgent,
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
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-[min(520px,92vw)] overflow-y-auto">
        <form onSubmit={(e) => void handleSubmit(e)}>
          <DialogHeader>
            <DialogTitle>{initial ? 'Edit SSH device' : 'Add SSH device'}</DialogTitle>
            <DialogDescription>
              Uses your OpenSSH config on this computer (aliases, keys, ProxyJump). Fluxx installs a
              small remote helper on first probe.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-4">
            <div className="flex flex-col gap-2">
              <Label className="text-xs text-muted-foreground">Display name</Label>
              <Input
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="M4 Mac mini"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label className="text-xs text-muted-foreground">SSH host alias or hostname</Label>
              <Input
                required
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="devbox"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-2">
                <Label className="text-xs text-muted-foreground">User (optional)</Label>
                <Input value={user} onChange={(e) => setUser(e.target.value)} />
              </div>
              <div className="flex flex-col gap-2">
                <Label className="text-xs text-muted-foreground">Port (optional)</Label>
                <Input value={port} onChange={(e) => setPort(e.target.value)} inputMode="numeric" />
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Label className="text-xs text-muted-foreground">Remote workspace root</Label>
              <Input required value={workspaceRoot} onChange={(e) => setWorkspaceRoot(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label className="text-xs text-muted-foreground">Shell (optional)</Label>
              <Input value={shell} onChange={(e) => setShell(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label className="text-xs text-muted-foreground">Extra SSH args (optional)</Label>
              <Input
                value={extraArgs}
                onChange={(e) => setExtraArgs(e.target.value)}
                placeholder="-o BatchMode=yes"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label className="text-xs text-muted-foreground">Connect timeout (seconds, optional)</Label>
              <Input
                value={connectTimeout}
                onChange={(e) => setConnectTimeout(e.target.value)}
                inputMode="numeric"
              />
            </div>
            <div className="flex items-start gap-2">
              <Checkbox
                id="ssh-forward-agent"
                checked={forwardAgent}
                onCheckedChange={(v) => setForwardAgent(v === true)}
              />
              <Label htmlFor="ssh-forward-agent" className="text-xs font-normal leading-snug">
                <span className="font-medium">Use this Mac&apos;s SSH keys for Git on the remote</span>
                <span className="mt-1 block text-muted-foreground">
                  Enables SSH agent forwarding so the remote host can use keys loaded in your Mac&apos;s
                  ssh-agent (for example GitHub). Your private keys stay on this computer. Fluxx
                  automatically trusts Git SSH host keys on the remote during probe.
                </span>
              </Label>
            </div>
            <div className="flex items-start gap-2">
              <Checkbox
                id="ssh-tmux"
                checked={tmuxEnabled}
                onCheckedChange={(v) => setTmuxEnabled(v === true)}
              />
              <Label htmlFor="ssh-tmux" className="text-xs font-normal leading-snug">
                <span className="font-medium">Persist terminals with tmux</span>
                <span className="mt-1 block text-muted-foreground">
                  When on, Fluxx runs sessions in tmux on this host and fails if tmux is unavailable
                  (no fallback to non-tmux terminals).
                </span>
              </Label>
            </div>
          </div>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription className="text-xs">{error}</AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy} className="bg-status-success text-status-success-foreground hover:bg-status-success/90">
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
  const [probingDeviceId, setProbingDeviceId] = useState<string | null>(null);

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
    let saved: ExecutionDeviceConfig;
    if (editorDevice === 'new') {
      saved = await window.electronAPI.executionDevices.createSsh(input);
    } else if (editorDevice) {
      const patch: ExecutionDeviceUpdateInput = { ...input };
      saved = await window.electronAPI.executionDevices.update(editorDevice.id, patch);
    } else {
      return;
    }
    await reload();
    await runProbe(saved.id);
  };

  const runProbe = async (deviceId: string) => {
    setSaveError(null);
    setProbingDeviceId(deviceId);
    try {
      await window.electronAPI.executionDevices.probe(deviceId);
      await reload();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
      await reload();
    } finally {
      setProbingDeviceId(null);
    }
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
        <h1 className="text-[22px] font-semibold tracking-tight text-foreground">Devices</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
          SSH devices are private to this Fluxx Desktop install and apply across all projects on this
          machine. Teammates on cloud projects never see your SSH hosts or keys.
        </p>

        <section className="mt-6 rounded-xl border border-border bg-card px-4 py-4">
          <h2 className="text-[14px] font-semibold text-foreground">Defaults for new tasks</h2>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Resolution order for new tasks: project override → global default → built-in local
            computer.
          </p>
          <div className="mt-4 space-y-4">
            <label className="block text-[12px] font-medium text-foreground">
              Global default (all projects)
              <select
                disabled={defaultsLoading}
                value={globalDefaultId ?? ''}
                onChange={(e) => void setGlobalDefault(e.target.value || null)}
                className="mt-1 flex h-9 w-full cursor-pointer rounded-md border border-input bg-background px-3 py-1 text-sm"
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
              <label className="block text-[12px] font-medium text-foreground">
                Project default override
                <span className="mt-0.5 block text-[11px] font-normal text-muted-foreground">
                  {project.kind === 'cloud'
                    ? 'Stored in local bindings on this computer only.'
                    : 'Stored in this project’s config on disk.'}
                </span>
                <select
                  disabled={defaultsLoading}
                  value={projectDefaultId ?? ''}
                  onChange={(e) => void setProjectDefault(e.target.value || null)}
                  className="mt-1 flex h-9 w-full cursor-pointer rounded-md border border-input bg-background px-3 py-1 text-sm"
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
              <p className="text-[12px] text-muted-foreground">
                Open a project to set a per-project default override.
              </p>
            )}
          </div>
          {saveError ? (
            <Alert variant="destructive" className="mt-3">
              <AlertDescription className="text-xs">{saveError}</AlertDescription>
            </Alert>
          ) : null}
        </section>

        <section className="mt-4 rounded-xl border border-border bg-card">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <h2 className="text-[14px] font-semibold text-foreground">Configured devices</h2>
            <Button type="button" size="sm" variant="outline" onClick={() => setEditorDevice('new')}>
              Add SSH device
            </Button>
          </div>
          {loading ? (
            <p className="px-4 py-6 text-[13px] text-muted-foreground">Loading devices…</p>
          ) : (
            <ul className="divide-y divide-border">
              {devices.map((device) => (
                <li key={device.id} className="px-4 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 gap-3">
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground ring-1 ring-inset ring-border">
                        <ExecutionDeviceKindIcon kind={device.kind} />
                      </span>
                      <div className="min-w-0">
                        <p className="text-[14px] font-medium text-foreground">
                          {device.displayName}
                          {!device.enabled ? (
                            <span className="ml-2 text-[11px] font-normal text-status-needs-input/90">
                              Disabled
                            </span>
                          ) : null}
                        </p>
                        <p className="mt-0.5 text-[12px] text-muted-foreground">
                          {device.kind === 'local' ? 'Local' : 'SSH'}
                          {device.kind === 'ssh' && device.ssh?.host
                            ? ` · ${device.ssh.host}`
                            : ''}
                          {' · '}
                          Workspace {device.workspaceRoot}
                        </p>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          Tmux persistence {device.tmux.enabled ? 'on' : 'off'}
                          {device.kind === 'ssh' && device.ssh?.forwardAgent
                            ? ' · Agent forwarding on'
                            : ''}
                          {' · '}
                          {probeStatusLabel(device)}
                        </p>
                        {device.kind === 'ssh' ? (() => {
                          const agentWarning = probeAgentWarningMessage(device.lastProbe);
                          return agentWarning ? (
                            <p className="mt-1 text-[11px] text-status-needs-input/90">{agentWarning}</p>
                          ) : null;
                        })() : null}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      {device.kind === 'ssh' ? (
                        <>
                          <button
                            type="button"
                            disabled={probingDeviceId === device.id}
                            onClick={() => void runProbe(device.id)}
                            className="rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
                          >
                            {probingDeviceId === device.id ? 'Probing…' : 'Probe'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditorDevice(device)}
                            className="rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => void toggleEnabled(device)}
                            className="rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
                          >
                            {device.enabled ? 'Disable' : 'Enable'}
                          </button>
                          <button
                            type="button"
                            onClick={() => void setGlobalDefault(device.id)}
                            className="rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
                          >
                            Make global default
                          </button>
                          <button
                            type="button"
                            onClick={() => setRemoveTarget(device)}
                            className="rounded-md px-2 py-1 text-[11px] text-destructive/80 hover:bg-destructive/10 hover:text-destructive"
                          >
                            Remove
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void setGlobalDefault(BUILTIN_LOCAL_DEVICE_ID)}
                          className="rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
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
