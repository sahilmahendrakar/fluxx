import { useCallback, useEffect, useState } from 'react';
import type { ExecutionDeviceConfig } from '../types';

export function useExecutionDevices(): {
  devices: ExecutionDeviceConfig[];
  loading: boolean;
  reload: () => Promise<void>;
} {
  const [devices, setDevices] = useState<ExecutionDeviceConfig[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const list = await window.electronAPI.executionDevices.list();
      setDevices(list);
    } catch (err) {
      console.error('[useExecutionDevices] list failed', err);
      setDevices([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const unsub = window.electronAPI.executionDevices.onChanged(() => {
      void reload();
    });
    return unsub;
  }, [reload]);

  return { devices, loading, reload };
}
