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
}

export interface TerminalHandle {
  write: (data: string) => void;
  focus: () => void;
}

const MIN_CONTAINER_PX = 8;

function containerHasUsableSize(el: HTMLElement): boolean {
  return (
    el.clientWidth >= MIN_CONTAINER_PX && el.clientHeight >= MIN_CONTAINER_PX
  );
}

const Terminal = forwardRef<TerminalHandle, TerminalProps>(function Terminal(
  { sessionId, onData, onResize, hideCursor = false, visible = true },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const onDataRef = useRef(onData);
  const onResizeRef = useRef(onResize);
  onDataRef.current = onData;
  onResizeRef.current = onResize;

  useImperativeHandle(ref, () => ({
    write: (data: string) => {
      termRef.current?.write(data);
    },
    focus: () => {
      termRef.current?.focus();
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
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);

    term.open(container);
    termRef.current = term;

    let cancelled = false;
    let resizeRaf = 0;

    const doFit = () => {
      if (cancelled) return;
      if (!containerHasUsableSize(container)) return;
      try {
        fitAddon.fit();
      } catch {
        // noop
      }
    };

    const scheduleResizeFit = () => {
      if (resizeRaf) cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = 0;
        doFit();
      });
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
          // Focus here too so a remount (e.g. sessionId change) that doesn't
          // flip the `visible` prop still picks up keystrokes immediately.
          term.focus();
        });
      });
    };

    void initFit();

    const d1 = term.onData((data) => onDataRef.current?.(data));
    const d2 = term.onResize(({ cols, rows }) =>
      onResizeRef.current?.(cols, rows),
    );

    const onWindowResize = () => scheduleResizeFit();
    window.addEventListener('resize', onWindowResize);

    const ro = new ResizeObserver(() => scheduleResizeFit());
    ro.observe(container);

    return () => {
      cancelled = true;
      window.removeEventListener('resize', onWindowResize);
      if (resizeRaf) cancelAnimationFrame(resizeRaf);
      ro.disconnect();
      d1.dispose();
      d2.dispose();
      term.dispose();
      termRef.current = null;
    };
  }, [sessionId]);

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
    if (term.rows > 0) {
      term.refresh(0, term.rows - 1);
    }
    term.scrollToBottom();
    term.focus();
  }, [visible]);

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
      className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-md border border-white/[0.06] bg-[#09090b]"
    />
  );
});

Terminal.displayName = 'Terminal';

export default Terminal;
