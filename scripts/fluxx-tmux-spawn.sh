#!/usr/bin/env bash
# Runs fluxx-tmux-spawn.cjs via Electron in Run-as-Node mode so macOS does not
# add a new Dock icon per tmux pane (see scripts/fluxx-shim).
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAUNCHER="${DIR}/fluxx-tmux-spawn.cjs"
if [ ! -f "$LAUNCHER" ]; then
  echo "fluxx-tmux-spawn: missing ${LAUNCHER}" >&2
  exit 1
fi
if [ -n "${FLUXX_ELECTRON_EXE:-}" ] && [ -x "${FLUXX_ELECTRON_EXE}" ]; then
  export ELECTRON_RUN_AS_NODE=1
  exec "${FLUXX_ELECTRON_EXE}" "$LAUNCHER" "$@"
fi
if [ -n "${FLUX_ELECTRON_EXE:-}" ] && [ -x "${FLUX_ELECTRON_EXE}" ]; then
  export ELECTRON_RUN_AS_NODE=1
  exec "${FLUX_ELECTRON_EXE}" "$LAUNCHER" "$@"
fi
if command -v node >/dev/null 2>&1; then
  exec node "$LAUNCHER" "$@"
fi
echo "fluxx-tmux-spawn: need FLUXX_ELECTRON_EXE or node on PATH" >&2
exit 127
