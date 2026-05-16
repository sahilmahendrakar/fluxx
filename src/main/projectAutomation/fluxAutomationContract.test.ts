import { describe, expect, it } from 'vitest';
import {
  exitCodeForAutomationFailure,
  FLUX_CLI_EXIT_INFRA,
  FLUX_CLI_EXIT_USER_ERROR,
  MCP_TOOL_CLI_MAP,
} from './fluxAutomationContract';

describe('fluxAutomationContract', () => {
  it('maps every legacy MCP automation tool to a planned CLI string', () => {
    expect(MCP_TOOL_CLI_MAP.flux__list_tasks).toBe('flux tasks list --json');
    expect(MCP_TOOL_CLI_MAP.flux__get_project_info).toBe('flux project info --json');
    expect(Object.keys(MCP_TOOL_CLI_MAP)).toHaveLength(8);
  });

  it('exitCodeForAutomationFailure distinguishes bridge vs user errors', () => {
    expect(
      exitCodeForAutomationFailure({
        ok: false,
        error: 'x',
        bridgeCode: 'RENDERER_TIMEOUT',
      }),
    ).toBe(FLUX_CLI_EXIT_INFRA);
    expect(
      exitCodeForAutomationFailure({
        ok: false,
        error: 'No project open',
      }),
    ).toBe(FLUX_CLI_EXIT_USER_ERROR);
  });
});
