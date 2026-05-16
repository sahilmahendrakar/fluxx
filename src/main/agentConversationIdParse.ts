import type { Agent } from '../types';

/** Strip OSC + CSI sequences so regexes match visible CLI text. */
export function stripTerminalControlSequences(data: string): string {
  /* eslint-disable no-control-regex -- strip OSC sequences and CSI SGR from stream text */
  const withoutOsc = data.replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, '');
  const withoutCsi = withoutOsc.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
  /* eslint-enable no-control-regex */
  return withoutCsi;
}

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
    /(?:^|[\s>])agent\s+--resume(?:=|\s+)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/gi,
  );
  if (fromHint) return fromHint;
  const fromJson = lastUuidFromMatches(
    text,
    /["']session_id["']\s*:\s*["']([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})["']/gi,
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
    /(?:^|[\s>])claude(?:\.exe)?\s+--resume(?:=|\s+)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/gi,
  );
  if (fromCli) return fromCli;
  const labeled = lastUuidFromMatches(
    text,
    /(?:conversation|session)\s+id\s*[:#]\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/gi,
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
