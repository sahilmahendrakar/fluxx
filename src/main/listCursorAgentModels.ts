import { spawn } from 'node:child_process';
import { DEFAULT_CURSOR_AGENT_MODEL } from '../types';

/** Shown when `agent models` is missing, errors, or returns nothing useful. */
const FALLBACK_CURSOR_MODELS = [
  DEFAULT_CURSOR_AGENT_MODEL,
  'gpt-5',
  'gpt-5.5-high',
  'sonnet-4',
  'sonnet-4-thinking',
];

const LIST_TIMEOUT_MS = 15_000;

/**
 * Parse `agent models` / `agent --list-models` text output:
 *   "id - Human label"
 */
export function parseAgentModelsList(stdout: string): string[] {
  const ids: string[] = [];
  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.trim();
    if (!line || line === 'Available models') continue;
    const m = /^([A-Za-z0-9._-]+)\s+-\s+/.exec(line);
    if (m) ids.push(m[1]);
  }
  return ids;
}

export type ListCursorAgentModelsResult = {
  models: string[];
  /** `cli` when `agent models` succeeded; `fallback` when using built-in ids. */
  source: 'cli' | 'fallback';
  /** Present when falling back (offline, timeout, parse empty, etc.). */
  error?: string;
};

/**
 * Lists Cursor Agent models for the signed-in account. Falls back to a small
 * static list when the CLI is unavailable (offline / not installed).
 */
export function listCursorAgentModels(): Promise<ListCursorAgentModelsResult> {
  return new Promise((resolve) => {
    const child = spawn('agent', ['models'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
    }, LIST_TIMEOUT_MS);

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
    });

    const respondFallback = (error: string) => {
      clearTimeout(timer);
      resolve({
        models: [...FALLBACK_CURSOR_MODELS],
        source: 'fallback',
        error,
      });
    };

    child.on('error', (err: NodeJS.ErrnoException) => {
      respondFallback(err.message || String(err));
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      const parsed = parseAgentModelsList(stdout);
      if (code === 0 && parsed.length > 0) {
        const withAuto = parsed.includes(DEFAULT_CURSOR_AGENT_MODEL)
          ? parsed
          : [DEFAULT_CURSOR_AGENT_MODEL, ...parsed];
        resolve({
          models: dedupePreserveOrder(withAuto),
          source: 'cli',
        });
        return;
      }
      const hint = stderr.trim() || stdout.trim() || `exit ${code ?? '?'}`;
      respondFallback(hint.slice(0, 400));
    });
  });
}

function dedupePreserveOrder(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}
