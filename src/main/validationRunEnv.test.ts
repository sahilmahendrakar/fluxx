import { describe, expect, it } from 'vitest';
import { validationRunPtyEnv } from './validationRunEnv';

describe('validationRunPtyEnv', () => {
  it('sets run id, artifact dir, and finish command', () => {
    const env = validationRunPtyEnv({
      id: 'run-abc',
      artifactDir: '/tmp/project/validation-runs/run-abc',
    });
    expect(env.FLUXX_VALIDATION_RUN_ID).toBe('run-abc');
    expect(env.FLUXX_VALIDATION_ARTIFACT_DIR).toBe('/tmp/project/validation-runs/run-abc');
    expect(env.FLUXX_VALIDATION_FINISH_COMMAND).toBe(
      'fluxx validation finish --run-id run-abc --json',
    );
  });
});
