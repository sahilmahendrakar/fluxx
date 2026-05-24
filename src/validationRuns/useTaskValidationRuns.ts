import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { pickLatestValidationRun } from './display';
import type { ValidationRun } from './types';
import {
  getStoredValidationRunSelection,
  resolveValidationRunSelection,
  setStoredValidationRunSelection,
  subscribeValidationRunSelection,
} from './validationRunSelection';
import { subscribeTaskValidationRunsRefresh } from './validationRunRefresh';

export type TaskValidationRunsState = {
  runs: ValidationRun[];
  latestRun: ValidationRun | null;
  selectedRunId: string | null;
  selectedRun: ValidationRun | null;
  setSelectedRunId: (runId: string | null) => void;
  loading: boolean;
  error: string | null;
  refresh: () => void;
};

export function useTaskValidationRuns(taskId: string | null | undefined): TaskValidationRunsState {
  const [runs, setRuns] = useState<ValidationRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectionVersion, setSelectionVersion] = useState(0);
  const previousRunIdsRef = useRef<Set<string>>(new Set());
  const refreshGenerationRef = useRef(0);

  const refresh = useCallback(() => {
    if (!taskId?.trim()) {
      setRuns([]);
      setError(null);
      setLoading(false);
      return;
    }
    const generation = ++refreshGenerationRef.current;
    setLoading(true);
    void window.electronAPI.validationRuns.listForTask(taskId).then((result) => {
      if (generation !== refreshGenerationRef.current) return;
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

  useEffect(() => {
    if (!taskId?.trim()) return;
    return subscribeTaskValidationRunsRefresh(taskId, refresh);
  }, [taskId, refresh]);

  useEffect(() => {
    previousRunIdsRef.current = new Set();
    if (!taskId?.trim()) return;
    return subscribeValidationRunSelection(taskId, () => {
      setSelectionVersion((version) => version + 1);
    });
  }, [taskId]);

  const latestRun = useMemo(() => pickLatestValidationRun(runs), [runs]);

  const selection = useMemo(() => {
    if (!taskId?.trim()) {
      return { selectedRunId: null, selectedRun: null };
    }
    const resolved = resolveValidationRunSelection({
      runs,
      storedRunId: getStoredValidationRunSelection(taskId),
      previousRunIds: previousRunIdsRef.current,
    });
    previousRunIdsRef.current = new Set(runs.map((run) => run.id));
    return resolved;
  }, [runs, taskId, selectionVersion]);

  const setSelectedRunId = useCallback(
    (runId: string | null) => {
      if (!taskId?.trim()) return;
      setStoredValidationRunSelection(taskId, runId);
    },
    [taskId],
  );

  return {
    runs,
    latestRun,
    selectedRunId: selection.selectedRunId,
    selectedRun: selection.selectedRun,
    setSelectedRunId,
    loading,
    error,
    refresh,
  };
}
