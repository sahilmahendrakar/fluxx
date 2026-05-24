import { useCallback, useEffect, useMemo, useState } from 'react';
import { pickLatestValidationRun } from './display';
import type { ValidationRun } from './types';

export type TaskValidationRunsState = {
  runs: ValidationRun[];
  latestRun: ValidationRun | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
};

export function useTaskValidationRuns(taskId: string | null | undefined): TaskValidationRunsState {
  const [runs, setRuns] = useState<ValidationRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!taskId?.trim()) {
      setRuns([]);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    void window.electronAPI.validationRuns.listForTask(taskId).then((result) => {
      setLoading(false);
      if ('error' in result) {
        setError(result.error);
        setRuns([]);
        return;
      }
      setError(null);
      setRuns(result.runs);
    });
  }, [taskId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!taskId?.trim()) return;
    return window.electronAPI.validationRuns.onChanged(() => {
      refresh();
    });
  }, [taskId, refresh]);

  const latestRun = useMemo(() => pickLatestValidationRun(runs), [runs]);

  return { runs, latestRun, loading, error, refresh };
}
