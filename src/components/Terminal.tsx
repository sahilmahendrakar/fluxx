import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { terminalFrameClass } from '@/components/terminal/TerminalChrome';
import { cn } from '@/lib/utils';
import { xtermThemeForSurface } from '../terminal/xtermTheme';
import { useAppearance } from '../theme/ThemeProvider';
import { installMacShiftDragSelectionBypass } from './terminalSelectionBypass';
import {
  containerHasUsableSize,
  LAYOUT_FIT_DEBOUNCE_MS,
  MIN_SETTLING_FIT_ATTEMPTS,
  MIN_VISIBILITY_SETTLE_FIT_ATTEMPTS,
  readContainerSize,
  shouldContinueSettlingFit,
  shouldImmediateLayoutFit,
  type SettlingFitOptions,
} from '../terminal/terminalFitScheduling';

export interface TerminalProps {
  sessionId: string | null;
  onData?: (data: string) => void;
  onResize?: (cols: number, rows: number) => void;
  // Claude Code draws its own prompt/cursor; xterm's cursor ends up below
  // the visible input box and reads as a stray second caret. Hide it there.
  hideCursor?: boolean;
  // Drives "became-visible" side effects (repaint, scroll-to-bottom, focus).
  // Parents set this to false when the pane/tab is hidden so we can re-focus
  // and repaint when it returns without ever reflowing the xterm container.
  visible?: boolean;
  // Mirrors use fixed snapshot geometry; owners auto-fit to their container.
  autoFit?: boolean;
}

export interface TerminalHandle {
  write: (data: string, callback?: () => void) => void;
  focus: () => void;
  fit: () => void;
  scrollToBottom: () => void;
  reset: () => void;
  /**
   * Resize the xterm grid to the captured warm-attach geometry before writing
   * `snapshotAnsi` / `replay` so line wrapping/cursor state match. Does not
   * resize the node-pty — parents wire `onResize` only when PTY should track UI.
   */
  setSnapshotGeometry: (cols: number, rows: number) => void;
}

const Terminal = forwardRef<TerminalHandle, TerminalProps>(function Terminal(
  { sessionId, onData, onResize, hideCursor = false, visible = true, autoFit = true },
  ref,
) {
  const { resolved: appearance } = useAppearance();
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const scheduleFitRef = useRef<
    ((afterFit?: () => void, reason?: 'default' | 'visibility') => void) | null
  >(null);
  const focusInteractiveRef = useRef<(() => void) | null>(null);
  const onDataRef = useRef(onData);
  const onResizeRef = useRef(onResize);
  const visibleRef = useRef(visible);
  onDataRef.current = onData;
  onResizeRef.current = onResize;
  visibleRef.current = visible;

  useImperativeHandle(ref, () => ({
    write: (data: string, callback?: () => void) => {
      const t = termRef.current;
      if (t) {
        t.write(data, callback);
      } else {
        callback?.();
      }
    },
    focus: () => {
      termRef.current?.focus();
    },
    fit: () => {
      scheduleFitRef.current?.(() => {
        const t = termRef.current;
        if (!t) return;
        if (t.rows > 0) {
          t.refresh(0, t.rows - 1);
        }
        t.scrollToBottom();
        scrollContainerToBottom(containerRef.current);
      });
    },
    scrollToBottom: () => {
      termRef.current?.scrollToBottom();
      scrollContainerToBottom(containerRef.current);
    },
    reset: () => {
      termRef.current?.reset();
      scrollContainerToBottom(containerRef.current);
    },
    setSnapshotGeometry: (cols: number, rows: number) => {
      const t = termRef.current;
      if (!t) return;
      if (cols <= 0 || rows <= 0) return;
      try {
        t.resize(cols, rows);
        scrollContainerToBottom(containerRef.current);
      } catch {
        // ignore
      }
    },
  }));

  useEffect(() => {
    if (!sessionId) {
      return;
    }

    const container = containerRef.current;
    if (!container) {
      return;
    }

    const term = new XTerm({
      theme: xtermThemeForSurface({ hideCursor, appearance }),
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
      fontSize: 12,
      // Keep at xterm.js's default of 1.0. TUIs (claude-code's banner, fzf
      // panels, separators, progress bars) draw with half-block characters
      // like `▀ ▄ █`. Any lineHeight > 1.0 inserts a transparent stripe
      // between rows, turning what should be a solid block into horizontal
      // slats — what made the Claude robot look fuzzy / "off". Native
      // terminals (iTerm, Terminal.app) and Superset's xterm.js setup also
      // default to 1.0 for this reason.
      lineHeight: 1.0,
      cursorBlink: !hideCursor,
      cursorStyle: 'block',
      cursorInactiveStyle: 'none',
      scrollback: 1000,
      // Preserve PTY/snapshot cursor semantics exactly; the PTY is responsible
      // for CRLF translation when terminal output needs it.
      convertEol: false,
      // With tmux `mouse on`, xterm receives mouse-reporting events and disables
      // normal drag selection. Option+drag forces xterm selection on macOS.
      macOptionClickForcesSelection: true,
    });

    const fitAddon = new FitAddon();
    // Default WebLinksAddon uses `window.open()`, which Electron turns into an
    // in-app BrowserWindow. Delegate http(s) clicks to the main process instead.
    const webLinksAddon = new WebLinksAddon((_event, uri) => {
      void window.electronAPI.openExternalUrl(uri);
    });
    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);

    term.open(container);
    const removeMacShiftDragSelectionBypass = installMacShiftDragSelectionBypass(term);
    termRef.current = term;

    // Swap xterm's default DOM renderer for the GPU-accelerated WebGL one.
    // Why: the DOM renderer paints each row as a separate HTML element and
    // relies on sub-pixel glyph hinting, so adjacent rows often don't meet
    // flush — produces 1-px hairlines between the half-block (`▀ ▄`) tiles
    // that TUIs use to draw pixel-art logos / box borders (the eyes↔body
    // and body↔legs gaps in claude-code's banner). WebGL renders the whole
    // grid as one pixel-aligned GPU texture, so cells tile perfectly.
    // Lazy-load after `term.open(container)` and guard against
    // unsupported / lost contexts; fall back to DOM if anything goes wrong.
    // Pattern lifted from Superset's terminal setup.
    let webglAddon: WebglAddon | null = null;
    const webglRaf = requestAnimationFrame(() => {
      try {
        const addon = new WebglAddon();
        addon.onContextLoss(() => {
          addon.dispose();
          webglAddon = null;
          if (!cancelled && term.rows > 0) {
            term.refresh(0, term.rows - 1);
          }
        });
        term.loadAddon(addon);
        webglAddon = addon;
        if (autoFit) {
          scheduleResizeFit();
        }
      } catch {
        // WebGL unavailable (e.g. blocked GPU, headless context) — leave
        // the DOM renderer in place. Functional, just slightly less crisp.
        webglAddon = null;
      }
    });

    let cancelled = false;
    let immediateRaf = 0;
    let deferredFitRaf = 0;
    let layoutRaf = 0;
    let layoutDebounce: ReturnType<typeof setTimeout> | undefined;
    let layoutFitEstablished = false;

    const doFit = (): boolean => {
      if (cancelled) return false;
      if (!autoFit) return false;
      if (!containerHasUsableSize(container)) return false;
      try {
        fitAddon.fit();
        layoutFitEstablished = true;
        return true;
      } catch {
        return false;
      }
    };

    const cancelPendingLayoutFit = () => {
      if (layoutDebounce !== undefined) {
        clearTimeout(layoutDebounce);
        layoutDebounce = undefined;
      }
      if (layoutRaf) {
        cancelAnimationFrame(layoutRaf);
        layoutRaf = 0;
      }
    };

    let chainedAfterFit: (() => void) | undefined;

    const runSettlingFit = (
      afterFit?: () => void,
      attempt = 0,
      settling: SettlingFitOptions = {},
    ) => {
      if (deferredFitRaf) {
        cancelAnimationFrame(deferredFitRaf);
        deferredFitRaf = 0;
      }
      deferredFitRaf = requestAnimationFrame(() => {
        deferredFitRaf = 0;
        if (cancelled) return;
        const sizeBeforeFit = readContainerSize(container);
        doFit();
        if (shouldContinueSettlingFit(attempt, sizeBeforeFit, container, settling)) {
          runSettlingFit(afterFit, attempt + 1, settling);
          return;
        }
        afterFit?.();
      });
    };

    /** Imminent refit: after attach, tab focus, or imperative `fit()`. */
    const scheduleResizeFit = (
      afterFit?: () => void,
      reason: 'default' | 'visibility' = 'default',
    ) => {
      if (afterFit) {
        const previous = chainedAfterFit;
        chainedAfterFit = previous
          ? () => {
              previous();
              afterFit();
            }
          : afterFit;
      }
      if (reason === 'visibility') {
        layoutFitEstablished = false;
      }
      cancelPendingLayoutFit();
      if (immediateRaf) cancelAnimationFrame(immediateRaf);
      immediateRaf = requestAnimationFrame(() => {
        immediateRaf = 0;
        if (cancelled) return;
        requestAnimationFrame(() => {
          if (cancelled) return;
          runSettlingFit(() => {
            const run = chainedAfterFit;
            chainedAfterFit = undefined;
            run?.();
          }, 0, {
            minAttempts:
              reason === 'visibility'
                ? MIN_VISIBILITY_SETTLE_FIT_ATTEMPTS
                : MIN_SETTLING_FIT_ATTEMPTS,
          });
        });
      });
    };
    scheduleFitRef.current = scheduleResizeFit;

    const scheduleLayoutFit = () => {
      cancelPendingLayoutFit();
      layoutDebounce = setTimeout(() => {
        layoutDebounce = undefined;
        if (cancelled) return;
        layoutRaf = requestAnimationFrame(() => {
          layoutRaf = 0;
          if (cancelled) return;
          doFit();
        });
      }, LAYOUT_FIT_DEBOUNCE_MS);
    };

    const focusInteractiveIfVisible = () => {
      if (!onDataRef.current || !visibleRef.current) return;
      term.focus();
    };

    const onWindowFocus = () => {
      if (!onDataRef.current || !visibleRef.current) return;
      const active = document.activeElement;
      if (active && active !== document.body && container.contains(active)) {
        return;
      }
      focusInteractiveIfVisible();
    };
    window.addEventListener('focus', onWindowFocus);
    focusInteractiveRef.current = focusInteractiveIfVisible;

    const afterInitFit = () => {
      if (term.rows > 0) {
        term.refresh(0, term.rows - 1);
      }
      term.scrollToBottom();
      scrollContainerToBottom(container);
      focusInteractiveIfVisible();
    };

    // xterm measures the rendered font to compute cols/rows. If the
    // configured fonts ("JetBrains Mono" etc.) haven't loaded yet the
    // cell metrics are wrong and fit() produces a garbled layout.
    // Wait for fonts, then scheduleResizeFit (double-rAF + deferred retry).
    const initFit = async () => {
      try {
        await document.fonts.ready;
      } catch {
        // fonts.ready not supported — fall through
      }
      if (cancelled) return;
      scheduleResizeFit(afterInitFit);
    };

    void initFit();

    const d1 = term.onData((data) => onDataRef.current?.(data));
    const d2 = term.onResize(({ cols, rows }) =>
      onResizeRef.current?.(cols, rows),
    );

    const onWindowResize = () => {
      if (autoFit) scheduleLayoutFit();
    };
    if (autoFit) {
      window.addEventListener('resize', onWindowResize);
    }

    const ro = autoFit
      ? new ResizeObserver(() => {
          if (shouldImmediateLayoutFit(layoutFitEstablished, container)) {
            scheduleResizeFit();
            return;
          }
          scheduleLayoutFit();
        })
      : null;
    ro?.observe(container);

    return () => {
      cancelled = true;
      if (autoFit) {
        window.removeEventListener('resize', onWindowResize);
      }
      window.removeEventListener('focus', onWindowFocus);
      if (layoutDebounce !== undefined) {
        clearTimeout(layoutDebounce);
        layoutDebounce = undefined;
      }
      if (layoutRaf) {
        cancelAnimationFrame(layoutRaf);
        layoutRaf = 0;
      }
      if (immediateRaf) {
        cancelAnimationFrame(immediateRaf);
        immediateRaf = 0;
      }
      if (deferredFitRaf) {
        cancelAnimationFrame(deferredFitRaf);
        deferredFitRaf = 0;
      }
      cancelAnimationFrame(webglRaf);
      // Dispose BEFORE term.dispose() — WebglAddon holds GPU resources tied
      // to the terminal's <canvas>, and disposing it after the terminal
      // leaves orphaned GL contexts.
      webglAddon?.dispose();
      webglAddon = null;
      chainedAfterFit = undefined;
      scheduleFitRef.current = null;
      focusInteractiveRef.current = null;
      ro?.disconnect();
      d1.dispose();
      d2.dispose();
      removeMacShiftDragSelectionBypass();
      term.dispose();
      termRef.current = null;
    };
  }, [sessionId, autoFit]);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.theme = xtermThemeForSurface({ hideCursor, appearance });
    if (term.rows > 0) {
      term.refresh(0, term.rows - 1);
    }
  }, [appearance, hideCursor]);

  // Parents mark the pane/tab hidden by passing visible=false. We don't toggle
  // display on the container (that would reflow xterm and wipe the rendered
  // history); instead the wrapper flips CSS visibility. When visible flips
  // back to true we repaint, scroll to latest output, and take focus so the
  // user can immediately resume typing without clicking in.
  const prevVisibleRef = useRef(false);
  useEffect(() => {
    const term = termRef.current;
    const wasVisible = prevVisibleRef.current;
    prevVisibleRef.current = visible;
    if (!term) return;
    if (!visible || wasVisible) return;
    const afterFit = () => {
      if (term.rows > 0) {
        term.refresh(0, term.rows - 1);
      }
      term.scrollToBottom();
      scrollContainerToBottom(containerRef.current);
      // Parents gate `onResize` while hidden; xterm only emits resize when
      // cols/rows change, so push the current grid after a visibility refit.
      if (term.cols > 0 && term.rows > 0) {
        onResizeRef.current?.(term.cols, term.rows);
      }
      // Only focus interactive, visible terminals.
      focusInteractiveRef.current?.();
    };
    const scheduleFit = scheduleFitRef.current;
    if (scheduleFit && autoFit) {
      scheduleFit(afterFit, 'visibility');
    } else {
      afterFit();
    }
  }, [visible, autoFit]);

  if (!sessionId) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-[13px] leading-relaxed text-status-terminal-foreground/50">
        No active session — start a session to use the terminal.
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn(terminalFrameClass, autoFit ? 'overflow-hidden' : 'overflow-auto')}
    />
  );
});

Terminal.displayName = 'Terminal';

export default Terminal;

function scrollContainerToBottom(container: HTMLElement | null): void {
  if (!container) return;
  requestAnimationFrame(() => {
    container.scrollTop = container.scrollHeight;
  });
}
