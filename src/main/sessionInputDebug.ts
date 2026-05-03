/**
 * Opt-in logging for bytes sent to task session PTYs (`session:write` /
 * `sendTaskSessionTerminalInput`). Compare with physical Enter from xterm.
 *
 * Enable: `FLUX_LOG_SESSION_INPUT=1` (or `true`) when starting Flux, then
 * watch the **main** process terminal (Electron devtools only show renderer).
 */

export function isSessionInputDebugEnabled(): boolean {
  const v = (process.env.FLUX_LOG_SESSION_INPUT ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/** xterm bracketed paste (same bytes as a multi-line paste from @xterm/xterm). */
const BRACKETED_PASTE_BEGIN = '\x1b[200~';
const BRACKETED_PASTE_END = '\x1b[201~';

/**
 * Wrap `body` so readline / agent CLIs treat embedded newlines as one pasted
 * block; follow with a literal `\r` (Enter) from the caller to submit.
 */
export function wrapAsXtermBracketedPaste(body: string): string {
  return `${BRACKETED_PASTE_BEGIN}${body}${BRACKETED_PASTE_END}`;
}

/** Make control / non-printable characters visible in logs. */
export function describeSessionInputForLog(data: string, maxCodeUnits = 600): string {
  const slice = data.length > maxCodeUnits ? data.slice(0, maxCodeUnits) : data;
  const tail = data.length > maxCodeUnits ? ` …<truncated, ${data.length} code units total>` : '';
  let out = '';
  for (let i = 0; i < slice.length; i += 1) {
    const c = slice.charAt(i);
    const code = c.charCodeAt(0);
    if (c === '\r') out += '\\r';
    else if (c === '\n') out += '\\n';
    else if (c === '\t') out += '\\t';
    else if (c === '\x1b') out += '\\x1b';
    else if (code < 0x20 || code === 0x7f)
      out += `\\x${code.toString(16).padStart(2, '0')}`;
    else if (code >= 0x80) out += c;
    else out += c;
  }
  return `${out}${tail}`;
}
