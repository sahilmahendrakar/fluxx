import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';

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

const MIN_CONTAINER_PX = 8;
/** Layout-driven (ResizeObserver / window) refits: debounce so we do not
 * clear+resize the xterm grid on every frame while a splitter is dragging. */
const LAYOUT_FIT_DEBOUNCE_MS = 100;

function containerHasUsableSize(el: HTMLElement): boolean {
  return (
    el.clientWidth >= MIN_CONTAINER_PX && el.clientHeight >= MIN_CONTAINER_PX
  );
}

const Terminal = forwardRef<TerminalHandle, TerminalProps>(function Terminal(
  { sessionId, onData, onResize, hideCursor = false, visible = true, autoFit = true },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const scheduleFitRef = useRef<((afterFit?: () => void) => void) | null>(
    null,
  );
  const onDataRef = useRef(onData);
  const onResizeRef = useRef(onResize);
  onDataRef.current = onData;
  onResizeRef.current = onResize;

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
      theme: {
        background: '#09090b',
        foreground: '#d4d4d8',
        cursor: hideCursor ? 'rgba(0,0,0,0)' : '#a1a1aa',
        cursorAccent: '#09090b',
        selectionBackground: 'rgba(255,255,255,0.12)',
        black: '#09090b',
        brightBlack: '#52525b',
      },
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
      fontSize: 12,
      lineHeight: 1.4,
      cursorBlink: !hideCursor,
      cursorStyle: 'block',
      cursorInactiveStyle: 'none',
      scrollback: 1000,
      // Preserve PTY/snapshot cursor semantics exactly; the PTY is responsible
      // for CRLF translation when terminal output needs it.
      convertEol: false,
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
    termRef.current = term;

    let cancelled = false;
    let immediateRaf = 0;
    let layoutRaf = 0;
    let layoutDebounce: ReturnType<typeof setTimeout> | undefined;

    const doFit = () => {
      if (cancelled) return;
      if (!autoFit) return;
      if (!containerHasUsableSize(container)) return;
      try {
        fitAddon.fit();
      } catch {
        // noop
      }
    };

    /** Imminent refit: after attach, tab focus, or imperative `fit()`. */
    const scheduleResizeFit = (afterFit?: () => void) => {
      if (layoutDebounce !== undefined) {
        clearTimeout(layoutDebounce);
        layoutDebounce = undefined;
      }
      if (layoutRaf) {
        cancelAnimationFrame(layoutRaf);
        layoutRaf = 0;
      }
      if (immediateRaf) cancelAnimationFrame(immediateRaf);
      immediateRaf = requestAnimationFrame(() => {
        immediateRaf = 0;
        doFit();
        if (!cancelled) {
          afterFit?.();
        }
      });
    };
    scheduleFitRef.current = scheduleResizeFit;

    const scheduleLayoutFit = () => {
      if (layoutDebounce !== undefined) clearTimeout(layoutDebounce);
      if (layoutRaf) {
        cancelAnimationFrame(layoutRaf);
        layoutRaf = 0;
      }
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

    // xterm measures the rendered font to compute cols/rows. If the
    // configured fonts ("JetBrains Mono" etc.) haven't loaded yet the
    // cell metrics are wrong and fit() produces a garbled layout.
    // Wait for fonts + two rAF ticks (browser needs a
    // layout pass after fonts swap) before the first fit.
    const initFit = async () => {
      try {
        await document.fonts.ready;
      } catch {
        // fonts.ready not supported — fall through
      }
      if (cancelled) return;
      // Double-rAF: first rAF gets us to after layout, second ensures
      // the browser has actually painted with the loaded font metrics.
      requestAnimationFrame(() => {
        if (cancelled) return;
        requestAnimationFrame(() => {
          if (cancelled) return;
          doFit();
          if (term.rows > 0) {
            term.refresh(0, term.rows - 1);
          }
          term.scrollToBottom();
          scrollContainerToBottom(container);
          // Only focus interactive terminals. Read-only mirrors (onData=undefined)
          // must NOT steal focus — and must not trigger focus-tracking escape
          // sequences that the agent would interpret as activity, causing a
          // false needs-input → in-progress reversion.
          if (onDataRef.current) {
            term.focus();
          }
        });
      });
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
          scheduleLayoutFit();
        })
      : null;
    ro?.observe(container);

    return () => {
      cancelled = true;
      if (autoFit) {
        window.removeEventListener('resize', onWindowResize);
      }
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
      scheduleFitRef.current = null;
      ro?.disconnect();
      d1.dispose();
      d2.dispose();
      term.dispose();
      termRef.current = null;
    };
  }, [sessionId, autoFit]);

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
      // Only focus interactive terminals — same reasoning as initFit above.
      if (onDataRef.current) {
        term.focus();
      }
    };
    const scheduleFit = scheduleFitRef.current;
    if (scheduleFit && autoFit) {
      scheduleFit(afterFit);
    } else {
      afterFit();
    }
  }, [visible, autoFit]);

  if (!sessionId) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-[13px] leading-relaxed text-zinc-600">
        No active session — start a session to use the terminal.
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={[
        'flex h-full min-h-0 w-full min-w-0 flex-col rounded-md border border-white/[0.06] bg-[#09090b]',
        autoFit ? 'overflow-hidden' : 'overflow-auto',
      ].join(' ')}
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
