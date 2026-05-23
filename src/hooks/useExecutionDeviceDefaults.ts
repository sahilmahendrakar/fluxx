import { useCallback, useEffect, useState } from 'react';
import type { ActiveProjectKey, TaskExecutionDeviceRef } from '../types';

export type ExecutionDeviceDefaults = {
  projectDefaultDeviceId?: string;
  globalDefaultDeviceId?: string;
  /** Cloud-only: per-task SSH overrides from local bindings (same source as detail panel IPC). */
  cloudPerTaskOverrides?: Record<string, TaskExecutionDeviceRef>;
};

export function useExecutionDeviceDefaults(
  activeProject: ActiveProjectKey | null | undefined,
): ExecutionDeviceDefaults {
  const [projectDefaultDeviceId, setProjectDefaultDeviceId] = useState<string | undefined>();
  const [globalDefaultDeviceId, setGlobalDefaultDeviceId] = useState<string | undefined>();
  const [cloudPerTaskOverrides, setCloudPerTaskOverrides] = useState<
    Record<string, TaskExecutionDeviceRef> | undefined
  >();

  const reload = useCallback(async () => {
    try {
      const globalId = await window.electronAPI.executionDevices.getGlobalDefault();
      setGlobalDefaultDeviceId(globalId ?? undefined);
      if (activeProject?.kind === 'local') {
        const projectId = await window.electronAPI.project.getDefaultDeviceId();
        setProjectDefaultDeviceId(projectId ?? undefined);
        setCloudPerTaskOverrides(undefined);
      } else if (activeProject?.kind === 'cloud') {
        const [projectId, overrides] = await Promise.all([
          window.electronAPI.cloudBindings.getProjectDefaultDeviceId(activeProject.id),
          window.electronAPI.cloudBindings.getPerTaskDeviceOverrides(activeProject.id),
        ]);
        setProjectDefaultDeviceId(projectId ?? undefined);
        setCloudPerTaskOverrides(
          overrides && Object.keys(overrides).length > 0 ? overrides : undefined,
        );
      } else {
        setProjectDefaultDeviceId(undefined);
        setCloudPerTaskOverrides(undefined);
      }
    } catch (err) {
      console.error('[useExecutionDeviceDefaults] reload failed', err);
      setProjectDefaultDeviceId(undefined);
      setGlobalDefaultDeviceId(undefined);
      setCloudPerTaskOverrides(undefined);
    }
  }, [activeProject?.id, activeProject?.kind]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const unsub = window.electronAPI.executionDevices.onChanged(() => {
      void reload();
    });
    return unsub;
  }, [reload]);

  return { projectDefaultDeviceId, globalDefaultDeviceId, cloudPerTaskOverrides };
}
