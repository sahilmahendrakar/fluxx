import type { Terminal as XTerm } from '@xterm/xterm';

interface XtermSelectionService {
  shouldForceSelection(event: MouseEvent): boolean;
}

interface XtermCoreWithSelection {
  _selectionService?: XtermSelectionService;
}

function selectionServiceFor(term: XTerm): XtermSelectionService | undefined {
  return (term as unknown as { _core?: XtermCoreWithSelection })._core?._selectionService;
}

function isMacPlatform(): boolean {
  if (typeof window === 'undefined') return false;
  return window.electronAPI?.platform === 'darwin';
}

/**
 * xterm.js treats Shift+drag as a selection bypass when mouse reporting is on,
 * but only on Linux/Windows. Patch the internal selection service on macOS so
 * Shift+drag matches iTerm/Terminal.app muscle memory under tmux mouse mode.
 */
export function installMacShiftDragSelectionBypass(term: XTerm): () => void {
  if (!isMacPlatform()) {
    return () => {};
  }

  const selectionService = selectionServiceFor(term);
  if (!selectionService) {
    return () => {};
  }

  const original = selectionService.shouldForceSelection.bind(selectionService);
  selectionService.shouldForceSelection = (event: MouseEvent) => {
    if (event.shiftKey) {
      return true;
    }
    return original(event);
  };

  return () => {
    selectionService.shouldForceSelection = original;
  };
}
