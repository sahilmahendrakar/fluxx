import type { Agent } from '../types';

/** Strip OSC + CSI sequences so regexes match visible CLI text. */
export function stripTerminalControlSequences(data: string): string {
  /* eslint-disable no-control-regex -- strip OSC sequences and CSI SGR from stream text */
  const withoutOsc = data.replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, '');
  const withoutCsi = withoutOsc.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
  /* eslint-enable no-control-regex */
  return withoutCsi;
}

const UUID_CAPTURE =
  '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})';

function lastUuidFromMatches(text: string, re: RegExp): string | undefined {
  let last: string | undefined;
  let m: RegExpExecArray | null;
  const r = new RegExp(re.source, re.flags);
  while ((m = r.exec(text)) !== null) {
    last = m[1]?.toLowerCase();
  }
  return last;
}

/**
 * Cursor Agent CLI sometimes prints a resume hint containing `agent --resume=<uuid>`.
 * JSON-style lines may include `"session_id":"…"`.
 */
export function parseCursorConversationId(raw: string): string | undefined {
  const text = stripTerminalControlSequences(raw);
  const fromHint = lastUuidFromMatches(
    text,
    new RegExp(`(?:^|[\\s>])agent\\s+--resume(?:=|\\s+)${UUID_CAPTURE}\\b`, 'gi'),
  );
  if (fromHint) return fromHint;
  const fromJson = lastUuidFromMatches(
    text,
    new RegExp(`["']session_id["']\\s*:\\s*["']${UUID_CAPTURE}["']`, 'gi'),
  );
  if (fromJson) return fromJson;
  return undefined;
}

/**
 * Claude Code may echo `claude --resume <uuid>` or print a labeled session id line.
 */
export function parseClaudeConversationId(raw: string): string | undefined {
  const text = stripTerminalControlSequences(raw);
  const fromCli = lastUuidFromMatches(
    text,
    new RegExp(`(?:^|[\\s>])claude(?:\\.exe)?\\s+--resume(?:=|\\s+)${UUID_CAPTURE}\\b`, 'gi'),
  );
  if (fromCli) return fromCli;
  const labeled = lastUuidFromMatches(
    text,
    new RegExp(`(?:conversation|session)\\s+id\\s*[:#]\\s*${UUID_CAPTURE}\\b`, 'gi'),
  );
  if (labeled) return labeled;
  return undefined;
}

/**
 * Codex CLI prints `codex resume <uuid>` hints on exit and may emit session ids in JSONL.
 */
export function parseCodexConversationId(raw: string): string | undefined {
  const text = stripTerminalControlSequences(raw);
  const fromResumeHint = lastUuidFromMatches(
    text,
    new RegExp(`(?:^|[\\s>\`])codex\\s+resume(?:=|\\s+)${UUID_CAPTURE}\\b`, 'gi'),
  );
  if (fromResumeHint) return fromResumeHint;
  const fromContinueHint = lastUuidFromMatches(
    text,
    new RegExp(
      `(?:to\\s+continue\\s+this\\s+session,\\s+run|to\\s+resume\\s+this\\s+thread\\s+run)[^\\n]*codex\\s+resume\\s+${UUID_CAPTURE}\\b`,
      'gi',
    ),
  );
  if (fromContinueHint) return fromContinueHint;
  const fromJson = lastUuidFromMatches(
    text,
    new RegExp(
      `["'](?:session_id|conversation_id|sessionId)["']\\s*:\\s*["']${UUID_CAPTURE}["']`,
      'gi',
    ),
  );
  if (fromJson) return fromJson;
  const labeled = lastUuidFromMatches(
    text,
    new RegExp(`(?:reviewed\\s+codex\\s+session\\s+id|session\\s+id)\\s*[:#]\\s*${UUID_CAPTURE}\\b`, 'gi'),
  );
  if (labeled) return labeled;
  return undefined;
}

export function parseAgentConversationId(agent: Agent, raw: string): string | undefined {
  switch (agent) {
    case 'cursor':
      return parseCursorConversationId(raw);
    case 'claude-code':
      return parseClaudeConversationId(raw);
    case 'codex':
      return parseCodexConversationId(raw);
    default:
      return undefined;
  }
}

/** Bounded tail for incremental parsing (bytes as UTF-16 length proxy). */
export function appendConversationParseBuffer(prev: string, chunk: string, maxChars: number): string {
  const next = `${prev}${chunk}`;
  if (next.length <= maxChars) return next;
  return next.slice(-maxChars);
}
