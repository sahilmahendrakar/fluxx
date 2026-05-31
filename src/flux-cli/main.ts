#!/usr/bin/env node
import { FluxCliConnectionError, invokeFluxAutomation } from './client';
import { VALIDATION_DISABLED_CODE, validationDisabledJson } from '../validation/validationEnabled';
import { loadFluxCliBridgeConfig } from './config';
import { printFluxCliHelp } from './help';
import { parseFluxCliArgs } from './parseArgs';
import type { FluxAutomationHttpOp } from '../main/AutomationHttpServer';

export const EXIT_OK = 0;
export const EXIT_ERROR = 1;
export const EXIT_USAGE = 2;
export const EXIT_PROJECT_OR_AUTH = 3;

function exitCodeForFailure(code?: string): number {
  if (code === 'UNAUTHORIZED' || code === 'PROJECT_KIND_MISMATCH' || code === 'NO_ACTIVE_PROJECT') {
    return EXIT_PROJECT_OR_AUTH;
  }
  return EXIT_ERROR;
}

function printJson(data: unknown): void {
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
}

function printError(message: string): void {
  process.stderr.write(`${message}\n`);
}

export async function runFluxCli(argv: string[]): Promise<number> {
  if (printFluxCliHelp(argv)) {
    return EXIT_OK;
  }

  const parsed = parseFluxCliArgs(argv);
  if (!parsed.ok) {
    printError(parsed.message);
    return EXIT_USAGE;
  }

  const config = loadFluxCliBridgeConfig();
  if (!config) {
    printError(
      'Fluxx CLI is not configured. Start a planning session in Fluxx, or set FLUXX_AUTOMATION_URL.',
    );
    return EXIT_ERROR;
  }

  const { command } = parsed;
  let op: FluxAutomationHttpOp;
  let payload: unknown;

  switch (command.kind) {
    case 'project':
      op = 'projectInfo';
      break;
    case 'members':
      op = 'members.list';
      break;
    case 'repo':
      op = 'repo.branchDiscovery';
      payload = {
        ...(command.repoId !== undefined ? { repoId: command.repoId } : {}),
        ...(command.classifyBranch !== undefined ? { classifyBranch: command.classifyBranch } : {}),
      };
      break;
    case 'validation':
      if (command.action === 'run') {
        op = 'validation.run';
        payload = {
          taskId: command.taskId,
          ...(command.packId !== undefined ? { packId: command.packId } : {}),
          ...(command.validatorAgent !== undefined
            ? { validatorAgent: command.validatorAgent }
            : {}),
          ...(command.launch !== undefined ? { launch: command.launch } : {}),
        };
      } else if (command.action === 'launch') {
        op = 'validation.launch';
        payload = {
          runId: command.runId,
          ...(command.taskId !== undefined ? { taskId: command.taskId } : {}),
        };
      } else if (command.action === 'list') {
        op = 'validation.list';
        payload = { taskId: command.taskId };
      } else if (command.action === 'show') {
        op = 'validation.show';
        payload = { runId: command.runId };
      } else if (command.action === 'artifacts') {
        op = 'validation.artifacts';
        payload = { runId: command.runId };
      } else if (command.action === 'finish') {
        op = 'validation.finish';
        payload = { runId: command.runId };
      } else {
        op = 'validation.ingest';
        payload = { runId: command.runId };
      }
      break;
    case 'tasks':
      if (command.action === 'list') {
        op = 'tasks.list';
        payload =
          command.excludeStatuses !== undefined
            ? { excludeStatuses: command.excludeStatuses }
            : undefined;
      } else if (command.action === 'create') {
        op = 'tasks.create';
        payload = command.payload;
      } else if (command.action === 'update') {
        op = 'tasks.update';
        payload = command.payload;
      } else if (command.action === 'start') {
        op = 'tasks.start';
        payload = { id: command.id };
      } else {
        op = 'tasks.delete';
        payload = { id: command.id, confirm: true };
      }
      break;
    default:
      printError('Internal error: unhandled command');
      return EXIT_ERROR;
  }

  try {
    const result = await invokeFluxAutomation(config, op, payload);
    if (!result.ok) {
      if (command.json) {
        if (result.code === VALIDATION_DISABLED_CODE) {
          printJson(validationDisabledJson());
        } else {
          printJson(result);
        }
      } else {
        printError(result.error);
      }
      return exitCodeForFailure(result.code);
    }
    if (command.json) {
      printJson(result.data);
    } else {
      printJson(result.data);
    }
    if (result.stderrNote) {
      printError(result.stderrNote);
    }
    return EXIT_OK;
  } catch (err) {
    const message = err instanceof FluxCliConnectionError ? err.message : String(err);
    printError(message);
    return EXIT_ERROR;
  }
}

if (require.main === module) {
  void runFluxCli(process.argv.slice(2)).then((code) => {
    process.exit(code);
  });
}
