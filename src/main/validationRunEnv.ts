/** Env vars set on validator agent PTY sessions for validation runs. */
export const FLUXX_VALIDATION_RUN_ID_ENV = 'FLUXX_VALIDATION_RUN_ID';
export const FLUXX_VALIDATION_ARTIFACT_DIR_ENV = 'FLUXX_VALIDATION_ARTIFACT_DIR';
export const FLUXX_VALIDATION_FINISH_COMMAND_ENV = 'FLUXX_VALIDATION_FINISH_COMMAND';

export function validationRunPtyEnv(run: {
  id: string;
  artifactDir: string;
}): Record<string, string> {
  const finishCommand = `fluxx validation finish --run-id ${run.id} --json`;
  return {
    [FLUXX_VALIDATION_RUN_ID_ENV]: run.id,
    [FLUXX_VALIDATION_ARTIFACT_DIR_ENV]: run.artifactDir,
    [FLUXX_VALIDATION_FINISH_COMMAND_ENV]: finishCommand,
  };
}
