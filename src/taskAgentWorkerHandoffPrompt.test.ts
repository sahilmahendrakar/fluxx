import { describe, expect, it } from 'vitest';
import {
  FLUXX_WORKER_HANDOFF_JSON_REL,
  buildTaskAgentWorkerHandoffInstructions,
} from './taskAgentWorkerHandoffPrompt';

describe('buildTaskAgentWorkerHandoffInstructions', () => {
  it('includes task id, handoff path, and manual CLI fallback', () => {
    const text = buildTaskAgentWorkerHandoffInstructions({ taskId: 'abc-123' });
    expect(text).toContain('## Fluxx: worker completion handoff');
    expect(text).toContain(FLUXX_WORKER_HANDOFF_JSON_REL);
    expect(text).toContain('fluxx coordination submit-handoff');
    expect(text).toContain('--task-id abc-123');
    expect(text).toContain('complete');
    expect(text).toContain('blocked');
    expect(text).toContain('partial');
  });
});
