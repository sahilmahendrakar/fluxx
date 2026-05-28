import type {
  ExecutionDeviceConfig,
  Session,
  Task,
  TaskExecutionDeviceRef,
  TaskStatus,
} from '../types';
import { cn } from '@/lib/utils';
import { workspaceSessionStatusDotClass } from '../taskStatusDot';
import { ExecutionDeviceChip } from './ExecutionDeviceChip';
import { resolveTaskChipExecutionDevice } from '../executionDevices/resolveTaskChipDevice';
import type { ExecutionDeviceDefaults } from '../hooks/useExecutionDeviceDefaults';

const tabCloseClass =
  'ml-1 flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground opacity-70 transition hover:bg-muted hover:text-foreground hover:opacity-100';

function tabClass(active: boolean) {
  return cn(
    'group flex shrink-0 items-center gap-2 rounded-md px-2.5 py-1 text-[13px] transition-colors',
    active
      ? 'bg-muted/60 text-foreground shadow-[inset_0_0_0_1px_hsl(var(--border))]'
      : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground',
  );
}

export interface SessionTabMeta {
  session: Session;
  title: string;
  taskStatus?: TaskStatus;
  executionDevice?: TaskExecutionDeviceRef;
  restoring?: boolean;
}

export interface PlanningTabMeta {
  sessionId: string;
  title: string;
  running: boolean;
}

interface TabBarProps {
  activeTabId: string;
  openSessions: SessionTabMeta[];
  openPlanningTabs: PlanningTabMeta[];
  executionDevices?: ExecutionDeviceConfig[];
  cloudProject?: boolean;
  settingsRouteActive: boolean;
  onSelectTab: (tabId: string) => void;
  onCloseSessionTab: (sessionId: string) => void;
  onSelectPlanningTab: (sessionId: string) => void;
  onClosePlanningTab: (sessionId: string) => void;
  onCloseSettingsTab: () => void;
}

export function buildSessionTabs(
  openSessions: Session[],
  tasks: Task[],
  executionDeviceDefaults?: ExecutionDeviceDefaults,
  restoringSessionIds?: ReadonlySet<string>,
  opts?: { cloudProject?: boolean },
): SessionTabMeta[] {
  return openSessions.map((session) => {
    const task = tasks.find((t) => t.id === session.taskId);
    const executionDevice =
      session.deviceKind && session.deviceId
        ? { kind: session.deviceKind, deviceId: session.deviceId }
        : task
          ? resolveTaskChipExecutionDevice(task, executionDeviceDefaults, {
              cloudProject: opts?.cloudProject,
            })
          : undefined;
    return {
      session,
      title: task?.title ?? 'Session',
      taskStatus: task?.status,
      executionDevice,
      restoring: restoringSessionIds?.has(session.id),
    };
  });
}

const PLAN_TAB_PREFIX = 'plan:';

export function TabBar({
  activeTabId,
  openSessions,
  openPlanningTabs,
  executionDevices = [],
  cloudProject = false,
  settingsRouteActive,
  onSelectTab,
  onCloseSessionTab,
  onSelectPlanningTab,
  onClosePlanningTab,
  onCloseSettingsTab,
}: TabBarProps) {
  return (
    <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
      <button
        type="button"
        className={tabClass(activeTabId === 'board' && !settingsRouteActive)}
        onClick={() => onSelectTab('board')}
      >
        <span>Board</span>
      </button>
      {settingsRouteActive ? (
        <div className={tabClass(settingsRouteActive)}>
          <button
            type="button"
            onClick={() => onSelectTab('settings')}
            className="flex min-w-0 items-center"
          >
            <span>Settings</span>
          </button>
          <button
            type="button"
            aria-label="Close Settings tab"
            onClick={(e) => {
              e.stopPropagation();
              onCloseSettingsTab();
            }}
            className={tabCloseClass}
          >
            <span className="text-[13px] leading-none" aria-hidden>
              ×
            </span>
          </button>
        </div>
      ) : null}
      {openSessions.length > 0 ? (
        <div className="mx-1 h-4 w-px shrink-0 self-center bg-border" aria-hidden />
      ) : null}
      {openSessions.map(({ session, title, taskStatus, executionDevice, restoring }) => {
        const active = activeTabId === session.id && !settingsRouteActive;
        const running = session.status === 'running';
        return (
          <div key={session.id} className={tabClass(active)}>
            <button
              type="button"
              onClick={() => onSelectTab(session.id)}
              className="flex min-w-0 items-center gap-1.5"
            >
              {restoring ? (
                <span
                  className="inline-block h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-muted-foreground"
                  title="Connecting workspace…"
                  aria-hidden
                />
              ) : (
                <span
                  className={[
                    'inline-block h-1.5 w-1.5 shrink-0 rounded-full',
                    workspaceSessionStatusDotClass(taskStatus, running),
                  ].join(' ')}
                  aria-hidden
                />
              )}
              <span className="max-w-[140px] truncate">{title}</span>
              {executionDevices.length > 0 && executionDevice ? (
                <ExecutionDeviceChip
                  devices={executionDevices}
                  deviceRef={executionDevice}
                  cloudProject={cloudProject}
                />
              ) : null}
            </button>
            <button
              type="button"
              aria-label={`Close ${title} tab`}
              onClick={(e) => {
                e.stopPropagation();
                onCloseSessionTab(session.id);
              }}
              className={tabCloseClass}
            >
              <span className="text-[13px] leading-none" aria-hidden>
                ×
              </span>
            </button>
          </div>
        );
      })}
      {openPlanningTabs.length > 0 ? (
        <div className="mx-1 h-4 w-px shrink-0 self-center bg-border" aria-hidden />
      ) : null}
      {openPlanningTabs.map(({ sessionId, title, running }) => {
        const tabId = `${PLAN_TAB_PREFIX}${sessionId}`;
        const active = activeTabId === tabId && !settingsRouteActive;
        return (
          <div key={tabId} className={tabClass(active)}>
            <button
              type="button"
              onClick={() => onSelectPlanningTab(sessionId)}
              className="flex min-w-0 items-center gap-1.5"
            >
              <span
                className={[
                  'inline-block h-1.5 w-1.5 shrink-0 rounded-full',
                  running ? 'bg-status-review' : 'bg-muted-foreground/50',
                ].join(' ')}
                aria-hidden
              />
              <span className="max-w-[180px] truncate">{title}</span>
            </button>
            <button
              type="button"
              aria-label={`Close ${title} tab`}
              onClick={(e) => {
                e.stopPropagation();
                onClosePlanningTab(sessionId);
              }}
              className={tabCloseClass}
            >
              <span className="text-[13px] leading-none" aria-hidden>
                ×
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
