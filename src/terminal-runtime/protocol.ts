/**
 * Shared types for the Electron main-process terminal runtime and the renderer.
 * PTY output and control frames flow main → renderer over IPC; attach payloads
 * describe warm reattach (`replay`, optional `snapshot`, `streamSeq`).
 */

import type { Agent, PlanningSession, Session, Shell } from '../types';

// --- Params / results (RPC-shaped surface implemented in-process today) ---

export interface CreateSessionParams {
  /** Caller (main) is responsible for worktree creation. */
  worktreePath: string;
  branch: string;
  taskId: string;
  projectId: string;
  /**
   * Multi-repo2: stable id of the {@link RepoConfig} this worktree belongs
   * to. Optional for backward compatibility — the runtime copies it onto the
   * returned `Session.repoId` when present, and renderer/main treat
   * missing values as the project's primary repo.
   */
  repoId?: string;
  agent: Agent;
  command: string;
  args: string[];
  cols: number;
  rows: number;
  /**
   * When true with non-empty {@link CreateSessionParams.trustPromptAutorespondRoots},
   * the runtime may auto-answer known trust prompts for this PTY (project opt-in).
   */
  trustPromptAutorespond?: boolean;
  /**
   * Resolved absolute path prefixes (Flux `worktrees/`, `planning/`, optional `~/.fluxx/worktrees`).
   * Empty or omitted disables cwd-gated autoresponse even if `trustPromptAutorespond` is true.
   */
  trustPromptAutorespondRoots?: string[];
}

export type CreateSessionResult =
  | Session
  | { error: 'AGENT_NOT_FOUND' | 'INVALID_PARAMS'; message: string };

/**
 * DECSET-style flags tracked from PTY output so the renderer can
 * replay `rehydrateSequences` after applying `snapshotAnsi`. Names follow
 * common xterm/VT documentation (CSI ?Pm h / l).
 */
export interface TerminalModes {
  /** DECCKM — application cursor keys (`CSI ?1`) */
  applicationCursorKeys: boolean;
  /** DECOM — origin mode (`CSI ?6`) */
  originMode: boolean;
  /** DECAWM — autowrap (`CSI ?7`) */
  autoWrap: boolean;
  /** DECTCEM — cursor visible (`CSI ?25`) */
  cursorVisible: boolean;
  /** Alternate screen buffer (`CSI ?47` / `CSI ?1049`) */
  alternateScreen: boolean;
  /** X10 mouse (`CSI ?9`) */
  mouseX10: boolean;
  /** VT200 mouse — press/release (`CSI ?1000`) */
  mouseVT200: boolean;
  /** Hilite mouse (`CSI ?1001`) */
  mouseHighlight: boolean;
  /** Cell motion tracking (`CSI ?1002`) */
  mouseCellMotion: boolean;
  /** All motion tracking (`CSI ?1003`) */
  mouseAllMotion: boolean;
  /** UTF-8 mouse encoding (`CSI ?1005`) */
  mouseUTF8: boolean;
  /** SGR mouse extended coordinates (`CSI ?1006`) */
  mouseSGR: boolean;
  /** Focus in/out events (`CSI ?1004`) */
  focusReporting: boolean;
  /** Bracketed paste (`CSI ?2004`) */
  bracketedPaste: boolean;
}

/**
 * Serialized headless xterm state for warm-reattach (see planning doc).
 * Filled once `SessionRuntime` wires `@xterm/addon-serialize`;
 * geometry must match `cols` / `rows` on the attach response.
 */
/** Alternate-buffer stats from the headless emulator (optional attach diagnostics). */
export interface TerminalSnapshotAltBufferDebug {
  lines: number;
  nonEmptyLines: number;
  totalChars: number;
  cursorX: number;
  cursorY: number;
  sampleLines: string[];
}

export interface TerminalSnapshot {
  /** Screen state from SerializeAddon (or equivalent), safe to write into a fresh terminal. */
  snapshotAnsi: string;
  /** Mode re-entry sequences not covered by `snapshotAnsi` alone. */
  rehydrateSequences: string;
  modes: TerminalModes;
  cols: number;
  rows: number;
  /** Working directory from OSC 7 when the headless emulator has parsed it. */
  cwd?: string;
  /** Active buffer line count at snapshot time (headless emulator diagnostics). */
  scrollbackLines?: number;
  /** Headless emulator diagnostics (not required for warm reattach). */
  debug?: {
    xtermBufferType: string;
    hasAltScreenEntry: boolean;
    altBuffer?: TerminalSnapshotAltBufferDebug;
    normalBufferLines?: number;
  };
}

/** Warm-reattach payload for agent sessions and shell panes. */
export interface AttachResult {
  /**
   * Bounded raw PTY prefix (legacy warm-reattach). Still populated for
   * compatibility; prefer `snapshot` when the runtime sends it.
   */
  replay: string;
  cols: number;
  rows: number;
  /**
   * Highest `seq` of any `data` frame for this PTY that is already reflected
   * in `snapshot` (or the legacy `replay` join). The renderer must not replay
   * live chunks with `seq <= streamSeq` after applying the attach. Omitted
   * when the runtime does not assign stream sequence numbers. `0` when no
   * output has been emitted yet.
   */
  streamSeq?: number;
  snapshot?: TerminalSnapshot;
}

/** Planning attach extends the session/shell attach shape with session metadata. */
export type PlanningAttachResult = AttachResult & { session: PlanningSession };

export interface CreateShellParams {
  sessionId: string;
  worktreePath: string;
  cols: number;
  rows: number;
}

export interface StartPlanningParams {
  projectId: string;
  agent: Agent;
  planningDir: string;
  command: string;
  args: string[];
  cols: number;
  rows: number;
  trustPromptAutorespond?: boolean;
  trustPromptAutorespondRoots?: string[];
}

export type StartPlanningResult =
  | PlanningSession
  | { error: 'AGENT_NOT_FOUND' | 'INVALID_PARAMS'; message: string };

// ---------------------------------------------------------------------------
// Stream frames (main → renderer)
// ---------------------------------------------------------------------------

export type StreamTarget = 'session' | 'shell' | 'planning';

export type AgentState = 'active' | 'silent';

export type StreamFrame =
  | {
      kind: 'data';
      target: StreamTarget;
      id: string;
      data: string;
      /** Monotonic per PTY (session/shell/planning id) — used with `AttachResult.streamSeq`. */
      seq?: number;
    }
  | { kind: 'session-exit'; id: string; session: Session }
  | { kind: 'shell-exit'; id: string; shell: Shell }
  | { kind: 'planning-exit'; id: string; session: PlanningSession }
  | { kind: 'agent-state'; id: string; state: AgentState }
  | {
      kind: 'auto-responded';
      target: 'session' | 'planning';
      id: string;
      ruleId: string;
      agent: Agent;
      sessionId: string;
    };

export function isStreamControlFrame(frame: StreamFrame): boolean {
  return (
    frame.kind === 'agent-state' ||
    frame.kind === 'session-exit' ||
    frame.kind === 'shell-exit' ||
    frame.kind === 'planning-exit' ||
    frame.kind === 'auto-responded'
  );
}
