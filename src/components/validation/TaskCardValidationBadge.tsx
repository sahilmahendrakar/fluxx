import ValidationStatusBadge from './ValidationStatusBadge';
import {
  taskCardShouldShowValidationBadge,
  validationBoardBadgeFromRuns,
} from '../../validationRuns/display';
import { useTaskValidationRuns } from '../../validationRuns/useTaskValidationRuns';
import type { Task } from '../../types';

export default function TaskCardValidationBadge({ task }: { task: Task }) {
  const { runs, loading } = useTaskValidationRuns(task.id);

  if (!taskCardShouldShowValidationBadge(task.status, runs)) {
    return null;
  }

  return (
    <ValidationStatusBadge
      status={validationBoardBadgeFromRuns(runs)}
      compact
      loading={loading && runs.length === 0}
    />
  );
}
