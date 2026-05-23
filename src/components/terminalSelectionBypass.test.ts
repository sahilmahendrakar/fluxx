import { describe, expect, it, vi } from 'vitest';
import type { Terminal as XTerm } from '@xterm/xterm';
import { installMacShiftDragSelectionBypass } from './terminalSelectionBypass';

describe('installMacShiftDragSelectionBypass', () => {
  it('no-ops when not on macOS', () => {
    const selectionService = {
      shouldForceSelection: vi.fn(() => false),
    };
    const term = {
      _core: { _selectionService: selectionService },
    } as unknown as XTerm;

    vi.stubGlobal('window', { electronAPI: { platform: 'linux' } });
    const restore = installMacShiftDragSelectionBypass(term);
    restore();

    expect(selectionService.shouldForceSelection).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('treats Shift+drag as forced selection on macOS', () => {
    const original = vi.fn((event: MouseEvent) => event.altKey);
    const selectionService = {
      shouldForceSelection: original,
    };
    const term = {
      _core: { _selectionService: selectionService },
    } as unknown as XTerm;

    vi.stubGlobal('window', { electronAPI: { platform: 'darwin' } });
    const restore = installMacShiftDragSelectionBypass(term);

    const shiftEvent = { shiftKey: true, altKey: false } as MouseEvent;
    expect(selectionService.shouldForceSelection(shiftEvent)).toBe(true);
    expect(original).not.toHaveBeenCalled();

    const plainEvent = { shiftKey: false, altKey: true } as MouseEvent;
    expect(selectionService.shouldForceSelection(plainEvent)).toBe(true);
    expect(original).toHaveBeenCalledWith(plainEvent);

    restore();
    const afterRestoreEvent = { shiftKey: true, altKey: false } as MouseEvent;
    expect(selectionService.shouldForceSelection(afterRestoreEvent)).toBe(false);
    expect(original).toHaveBeenCalledWith(afterRestoreEvent);
    vi.unstubAllGlobals();
  });
});
