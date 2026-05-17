/** Fluxx-managed region inside `planning/CLAUDE.md` and `planning/AGENTS.md` (HTML comments — inert in most Markdown renderers). */
export const FLUXX_PLANNING_INSTRUCTIONS_BEGIN = '<!-- FLUXX_PLANNING_INSTRUCTIONS:BEGIN -->';
export const FLUXX_PLANNING_INSTRUCTIONS_END = '<!-- FLUXX_PLANNING_INSTRUCTIONS:END -->';

/** Legacy Flux markers; still recognized when parsing existing instruction files. */
export const FLUX_PLANNING_INSTRUCTIONS_BEGIN_LEGACY =
  '<!-- FLUX_PLANNING_INSTRUCTIONS:BEGIN -->';
export const FLUX_PLANNING_INSTRUCTIONS_END_LEGACY = '<!-- FLUX_PLANNING_INSTRUCTIONS:END -->';

/** @deprecated Use {@link FLUXX_PLANNING_INSTRUCTIONS_BEGIN}. */
export const FLUX_PLANNING_INSTRUCTIONS_BEGIN = FLUX_PLANNING_INSTRUCTIONS_BEGIN_LEGACY;
/** @deprecated Use {@link FLUXX_PLANNING_INSTRUCTIONS_END}. */
export const FLUX_PLANNING_INSTRUCTIONS_END = FLUX_PLANNING_INSTRUCTIONS_END_LEGACY;

export {
  FLUXX_PLANNING_INSTRUCTIONS_STATE_BASENAME,
  LEGACY_PLANNING_INSTRUCTIONS_STATE_BASENAME,
  PLANNING_INSTRUCTIONS_STATE_BASENAME,
} from './fluxxPlanningPaths';

const PLANNING_INSTRUCTION_MARKER_PAIRS: ReadonlyArray<readonly [string, string]> = [
  [FLUXX_PLANNING_INSTRUCTIONS_BEGIN, FLUXX_PLANNING_INSTRUCTIONS_END],
  [FLUX_PLANNING_INSTRUCTIONS_BEGIN_LEGACY, FLUX_PLANNING_INSTRUCTIONS_END_LEGACY],
];

export function findPlanningInstructionMarkerBounds(
  markdown: string,
): { beginIdx: number; endIdx: number; beginMarkerLen: number; endMarkerLen: number } | null {
  const unified = markdown.replace(/\r\n/g, '\n');
  for (const [begin, end] of PLANNING_INSTRUCTION_MARKER_PAIRS) {
    const beginIdx = unified.indexOf(begin);
    const endIdx = unified.indexOf(end);
    if (beginIdx !== -1 && endIdx !== -1 && endIdx > beginIdx) {
      return { beginIdx, endIdx, beginMarkerLen: begin.length, endMarkerLen: end.length };
    }
  }
  return null;
}
