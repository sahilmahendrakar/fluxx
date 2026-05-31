import { useEffect, useRef, useState } from 'react';
import { UserCircle2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
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
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import {
  type Agent,
  type ExecutionDeviceConfig,
  type RepoBranchDiscovery,
  type RepoConfig,
  type TaskExecutionDeviceRef,
  TASK_AGENT_SELECT_OPTIONS,
} from '../types';
import { ExecutionDevicePicker } from './ExecutionDevicePicker';
import { repoDisplayLabel, resolvePrimaryRepoId } from '../repoIdentity';
import { buildCreateTaskBranchPayload, gitBranchShortNameLooksValid } from '../taskBranches';
import { TaskLabelsField } from './TaskLabelsField';
import type { ProjectMember } from '../renderer/projects/members';
import { ProjectMemberAvatar } from './ProjectMemberAvatar';
import TaskSourceBranchPicker from './TaskSourceBranchPicker';
import {
  projectRepoActionsBlocked,
  type ProjectRepoReadiness,
} from '../projectRepoReadiness';

interface Props {
  gitEnabled?: boolean;
  onClose: () => void;
  onCreate: (
    title: string,
    agent: Agent | null,
    labels: string[],
    assigneeId?: string,
    branch?: {
      sourceBranch?: string;
      createSourceBranchIfMissing?: boolean;
      repoId?: string;
    },
    executionDevice?: TaskExecutionDeviceRef,
  ) => void;
  executionDevices: ExecutionDeviceConfig[];
  cloudProject?: boolean;
  /** Union of labels on existing tasks, for the picker. */
  labelCatalog: string[];
  /** Default agent for this project (local `config.json` or cloud binding prefs). */
  defaultAgent?: Agent;
  /** Cloud-only: team members available for assignment. */
  projectMembers?: ProjectMember[];
  /** When set with multiple entries and multi-repo2, shows repo selector before branch. */
  projectRepos?: RepoConfig[];
  multiRepo2Enabled?: boolean;
  projectRepoReadiness: ProjectRepoReadiness;
  onOpenProjectSettings: () => void;
}

export default function NewTaskModal({
  gitEnabled = true,
  onClose,
  onCreate,
  labelCatalog,
  defaultAgent = 'claude-code',
  projectMembers,
  projectRepos,
  multiRepo2Enabled = false,
  projectRepoReadiness,
  executionDevices,
  onOpenProjectSettings,
}: Props) {
  const [title, setTitle] = useState('');
  const [agent, setAgent] = useState<Agent | null>(defaultAgent);
  const [labels, setLabels] = useState<string[]>([]);
  const [assigneeId, setAssigneeId] = useState<string | undefined>(undefined);
  const [branchDiscovery, setBranchDiscovery] = useState<RepoBranchDiscovery | null>(null);
  const [branchDiscoveryLoading, setBranchDiscoveryLoading] = useState(true);
  const [branchDiscoveryError, setBranchDiscoveryError] = useState<string | null>(null);
  const [branchInput, setBranchInput] = useState('');
  const showRepoPicker =
    Boolean(multiRepo2Enabled && projectRepos && projectRepos.length > 1);
  const primaryRepoId = resolvePrimaryRepoId(projectRepos ?? []) ?? '';
  const [selectedRepoId, setSelectedRepoId] = useState(primaryRepoId);
  const inputRef = useRef<HTMLInputElement>(null);
  const [executionDevice, setExecutionDevice] = useState<TaskExecutionDeviceRef | undefined>();

  useEffect(() => {
    let cancelled = false;
    void window.electronAPI.executionDevices.resolveDefaultForNewTask().then((ref) => {
      if (!cancelled) setExecutionDevice(ref);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!showRepoPicker || !primaryRepoId) return;
    setSelectedRepoId(primaryRepoId);
  }, [showRepoPicker, primaryRepoId]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!gitEnabled) {
      setBranchDiscovery(null);
      setBranchDiscoveryLoading(false);
      setBranchDiscoveryError(null);
      setBranchInput('');
      return;
    }
    let cancelled = false;
    setBranchDiscoveryLoading(true);
    setBranchDiscoveryError(null);
    const discoveryArg =
      showRepoPicker && selectedRepoId ? { repoId: selectedRepoId } : undefined;
    void window.electronAPI.repo.getBranchDiscovery(discoveryArg).then((r) => {
      if (cancelled) return;
      setBranchDiscoveryLoading(false);
      if ('error' in r) {
        setBranchDiscovery(null);
        setBranchDiscoveryError(r.error);
        setBranchInput('');
        return;
      }
      setBranchDiscovery(r);
      setBranchInput(r.defaultBranchShort);
    });
    return () => {
      cancelled = true;
    };
  }, [gitEnabled, showRepoPicker, selectedRepoId]);

  useEffect(() => {
    setAgent(defaultAgent);
  }, [defaultAgent]);

  const trimmed = title.trim();
  const branchTrim = branchInput.trim();
  const branchNameOk = branchTrim === '' || gitBranchShortNameLooksValid(branchInput);
  const repoBlocked = projectRepoActionsBlocked(projectRepoReadiness);
  const canSubmit = trimmed.length > 0 && branchNameOk && !repoBlocked;

  const submit = () => {
    if (!canSubmit) return;
    const branch = buildCreateTaskBranchPayload(branchInput, branchDiscovery);
    const withRepo =
      showRepoPicker && selectedRepoId ? { ...branch, repoId: selectedRepoId } : branch;
    onCreate(trimmed, agent, labels, assigneeId, withRepo, executionDevice);
  };

  /** Defined only for cloud projects (may be empty while members load). */
  const showAssigneePicker = projectMembers !== undefined;
  const selectedMember = assigneeId
    ? projectMembers?.find((m) => m.uid === assigneeId)
    : undefined;

  function memberLabel(m: ProjectMember): string {
    return m.displayName || m.email || m.uid;
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[min(400px,92vw)]">
        <DialogHeader>
          <DialogTitle>New task</DialogTitle>
          <DialogDescription>Add a task to the backlog.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {repoBlocked ? (
            <Alert className="border-status-needs-input/30 bg-status-needs-input/10 text-status-needs-input-foreground">
              <AlertDescription>
                <p>{projectRepoReadiness.message}</p>
                <Button
                  type="button"
                  variant="link"
                  className="mt-2 h-auto p-0 text-status-needs-input-foreground"
                  onClick={onOpenProjectSettings}
                >
                  {projectRepoReadiness.ctaLabel}
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="flex flex-col gap-2">
            <Label
              htmlFor="new-task-title"
              className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground"
            >
              Title
            </Label>
            <Input
              ref={inputRef}
              id="new-task-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit();
              }}
              placeholder="What should the agent do?"
            />
          </div>

          <TaskLabelsField
            idPrefix="new-task"
            labels={labels}
            labelCatalog={labelCatalog}
            onLabelsChange={setLabels}
            compact
          />

          {showRepoPicker ? (
            <div className="flex flex-col gap-2">
              <Label
                htmlFor="new-task-repo"
                className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground"
              >
                Repository
              </Label>
              <Select value={selectedRepoId} onValueChange={setSelectedRepoId}>
                <SelectTrigger id="new-task-repo" className="h-9 text-[13px]">
                  <SelectValue placeholder="Repository" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {(projectRepos ?? []).map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {repoDisplayLabel(r)}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <TaskSourceBranchPicker
            gitEnabled={gitEnabled}
            idPrefix="new-task"
            branchInput={branchInput}
            onBranchInputChange={setBranchInput}
            discovery={branchDiscovery}
            discoveryLoading={branchDiscoveryLoading}
            discoveryError={branchDiscoveryError}
          />

          <div className="flex flex-col gap-2">
            <Label
              htmlFor="new-task-device"
              className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground"
            >
              Run on
            </Label>
            <p className="text-[11px] text-muted-foreground">
              Snapshotted for this task (project default → global default → local).
            </p>
            <ExecutionDevicePicker
              id="new-task-device"
              devices={executionDevices}
              value={executionDevice}
              onChange={setExecutionDevice}
              aria-label="Execution device for new task"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Agent
            </Label>
            <div className="flex flex-wrap gap-1.5">
              {TASK_AGENT_SELECT_OPTIONS.map((a) => {
                const active = a.id === agent;
                return (
                  <Button
                    key={a.id === null ? 'none' : a.id}
                    type="button"
                    size="sm"
                    variant={active ? 'secondary' : 'ghost'}
                    className={cn(
                      'h-auto border px-2.5 py-1.5 text-[11px] font-medium',
                      active ? 'border-border shadow-sm' : 'border-transparent',
                    )}
                    onClick={() => setAgent(a.id)}
                  >
                    {a.label}
                  </Button>
                );
              })}
            </div>
          </div>

          {showAssigneePicker ? (
            <div className="flex flex-col gap-2">
              <Label className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                Assignee
              </Label>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 w-full justify-start gap-2 px-3 text-[13px] font-normal"
                  >
                    {selectedMember ? (
                      <>
                        <ProjectMemberAvatar member={selectedMember} size="xs" />
                        <span className="truncate">{memberLabel(selectedMember)}</span>
                      </>
                    ) : (
                      <>
                        <UserCircle2
                          className="size-5 shrink-0 text-muted-foreground"
                          strokeWidth={1.5}
                          aria-hidden
                        />
                        <span className="text-muted-foreground">Unassigned</span>
                      </>
                    )}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)]">
                  <DropdownMenuItem
                    className="gap-2"
                    onSelect={() => setAssigneeId(undefined)}
                  >
                    <UserCircle2 className="size-5 shrink-0" strokeWidth={1.5} aria-hidden />
                    Unassigned
                  </DropdownMenuItem>
                  {(projectMembers ?? []).map((m) => (
                    <DropdownMenuItem
                      key={m.uid}
                      className="gap-2"
                      onSelect={() => setAssigneeId(m.uid)}
                    >
                      <ProjectMemberAvatar member={m} size="xs" />
                      {memberLabel(m)}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : null}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={!canSubmit}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
