import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  isPlanningMarkdownRelativePathForbiddenForUserWrite,
  normalizePlanningDocRelativePath,
  safeResolvePlanningMarkdownAbsPath,
} from '../planningDocs/path';
import type { Task } from '../types';
import { taskInitialPrompt } from './agentSpawn';

export type AttachedPlanningDocPromptLine =
  | { kind: 'ok'; relativePath: string; absPath: string; fileUrl: string }
  | { kind: 'missing'; relativePath: string; absPath?: string; note: string }
  | { kind: 'invalid'; detail: string };

/** Instruction appended after the attached-docs list (non-resume sessions only). */
export const ATTACHED_PLANNING_DOCS_SCOPE_INSTRUCTION =
  'Use these docs for broader context, but implement only the scope described in this task description.';

/**
 * Build prompt lines for each attachment: valid paths are resolved under
 * `planningDir` and checked for a readable regular file.
 */
export async function collectAttachedPlanningDocPromptLines(
  attached: unknown,
  planningDir: string,
): Promise<AttachedPlanningDocPromptLine[]> {
  if (!Array.isArray(attached) || attached.length === 0) {
    return [];
  }
  const seen = new Set<string>();
  const lines: AttachedPlanningDocPromptLine[] = [];

  for (const item of attached) {
    if (!item || typeof item !== 'object') {
      lines.push({
        kind: 'invalid',
        detail: 'Invalid attachment entry (expected an object with `relativePath`).',
      });
      continue;
    }
    const rawPath = (item as { relativePath?: unknown }).relativePath;
    if (typeof rawPath !== 'string' || rawPath.trim() === '') {
      lines.push({
        kind: 'invalid',
        detail: 'Invalid attachment: `relativePath` must be a non-empty string.',
      });
      continue;
    }
    const norm = normalizePlanningDocRelativePath(rawPath);
    if (!norm) {
      lines.push({
        kind: 'invalid',
        detail: `Invalid planning markdown path: \`${rawPath}\``,
      });
      continue;
    }
    if (isPlanningMarkdownRelativePathForbiddenForUserWrite(norm)) {
      lines.push({
        kind: 'invalid',
        detail: `Path is not allowed as an attached planning doc: \`${norm}\``,
      });
      continue;
    }
    if (seen.has(norm)) continue;
    seen.add(norm);

    const absPath = safeResolvePlanningMarkdownAbsPath(planningDir, norm);
    if (!absPath) {
      lines.push({
        kind: 'invalid',
        detail: `Could not resolve path safely under planning: \`${norm}\``,
      });
      continue;
    }

    try {
      const st = await fs.stat(absPath);
      if (!st.isFile()) {
        lines.push({
          kind: 'missing',
          relativePath: norm,
          absPath,
          note: 'Not a readable file (exists but is not a regular file).',
        });
        continue;
      }
      await fs.access(absPath, fsConstants.R_OK);
      lines.push({
        kind: 'ok',
        relativePath: norm,
        absPath,
        fileUrl: pathToFileURL(absPath).href,
      });
    } catch {
      lines.push({
        kind: 'missing',
        relativePath: norm,
        absPath,
        note:
          'File missing or not readable locally (for cloud projects the planning mirror may still be syncing).',
      });
    }
  }

  return lines;
}

export function formatAttachedPlanningDocsSection(lines: AttachedPlanningDocPromptLine[]): string {
  const parts: string[] = ['## Attached Planning Docs', ''];
  for (const line of lines) {
    if (line.kind === 'ok') {
      parts.push(`- \`${line.relativePath}\``);
      parts.push(`  - Path: \`${line.absPath}\``);
      parts.push(`  - URL: \`${line.fileUrl}\``);
    } else if (line.kind === 'missing') {
      parts.push(`- \`${line.relativePath}\``);
      if (line.absPath) {
        parts.push(`  - Path: \`${line.absPath}\` — _${line.note}_`);
      } else {
        parts.push(`  - Path: _${line.note}_`);
      }
      parts.push('  - URL: _not available_');
    } else {
      parts.push(`- _${line.detail}_`);
    }
    parts.push('');
  }
  parts.push(ATTACHED_PLANNING_DOCS_SCOPE_INSTRUCTION);
  return parts.join('\n');
}

/**
 * First agent prompt for a new task session: task title/description plus optional
 * attached planning doc paths (absolute + `file://`). Omits the attachment block
 * when there are no attachments or the list is empty.
 */
export async function composeTaskSessionInitialPrompt(
  task: Task,
  planningDir: string,
): Promise<string> {
  const base = taskInitialPrompt(task);
  const raw = task.attachedPlanningDocs;
  if (!Array.isArray(raw) || raw.length === 0) {
    return base;
  }
  const lines = await collectAttachedPlanningDocPromptLines(raw, planningDir);
  if (lines.length === 0) {
    return base;
  }
  return `${base}\n\n${formatAttachedPlanningDocsSection(lines)}`;
}
