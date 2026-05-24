/**
 * Shell pipeline target for tmux `copy-pipe-and-cancel` bindings in
 * `resources/fluxx-tmux.conf`. Reads the selection from stdin and writes it to
 * the host clipboard when a helper is available.
 */
export const FLUXX_TMUX_CLIPBOARD_PIPE_COMMAND =
  "command -v pbcopy >/dev/null 2>&1 && pbcopy || { command -v xclip >/dev/null 2>&1 && xclip -in -selection clipboard || { command -v xsel >/dev/null 2>&1 && xsel --clipboard --input || cat >/dev/null; }; }";
