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
}

export interface TerminalHandle {
  write: (data: string) => void;
}

const MIN_CONTAINER_PX = 8;
const MAX_LAYOUT_RETRY_FRAMES = 60;

function containerHasUsableSize(el: HTMLElement): boolean {
  return (
    el.clientWidth >= MIN_CONTAINER_PX && el.clientHeight >= MIN_CONTAINER_PX
  );
}

const Terminal = forwardRef<TerminalHandle, TerminalProps>(function Terminal(
  { sessionId, onData, onResize },
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
        cursor: '#a1a1aa',
        selectionBackground: 'rgba(255,255,255,0.12)',
        black: '#09090b',
        brightBlack: '#52525b',
      },
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      scrollback: 1000,
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);

    term.open(container);

    let cancelled = false;
    let resizeRaf = 0;
    let layoutRetryFrame = 0;
    let layoutRetryRaf = 0;
    let didFirstGoodFit = false;

    const runFit = () => {
      if (cancelled || !containerHasUsableSize(container)) {
        return false;
      }
      try {
        fitAddon.fit();
      } catch {
        return false;
      }
      return true;
    };

    const schedulePostLayoutRefits = () => {
      requestAnimationFrame(() => {
        if (cancelled) return;
        runFit();
        requestAnimationFrame(() => {
          if (cancelled) return;
          if (runFit() && term.rows > 0) {
            term.refresh(0, term.rows - 1);
          }
        });
      });
    };

    const tryInitialFit = () => {
      if (cancelled) return;
      if (runFit()) {
        didFirstGoodFit = true;
        termRef.current = term;
        schedulePostLayoutRefits();
        if (term.rows > 0) {
          term.refresh(0, term.rows - 1);
        }
        return;
      }
      layoutRetryFrame += 1;
      if (layoutRetryFrame >= MAX_LAYOUT_RETRY_FRAMES) {
        didFirstGoodFit = true;
        termRef.current = term;
        return;
      }
      layoutRetryRaf = requestAnimationFrame(tryInitialFit);
    };

    termRef.current = term;
    tryInitialFit();

    const d1 = term.onData((data) => onDataRef.current?.(data));
    const d2 = term.onResize(({ cols, rows }) =>
      onResizeRef.current?.(cols, rows),
    );

    const scheduleResizeFit = () => {
      if (resizeRaf) {
        cancelAnimationFrame(resizeRaf);
      }
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = 0;
        if (cancelled) return;
        if (!containerHasUsableSize(container)) return;
        if (runFit() && didFirstGoodFit && term.rows > 0) {
          term.refresh(0, term.rows - 1);
        }
      });
    };

    const ro = new ResizeObserver(() => {
      scheduleResizeFit();
    });
    ro.observe(container);

    return () => {
      cancelled = true;
      if (layoutRetryRaf) cancelAnimationFrame(layoutRetryRaf);
      if (resizeRaf) cancelAnimationFrame(resizeRaf);
      ro.disconnect();
      d1.dispose();
      d2.dispose();
      term.dispose();
      termRef.current = null;
    };
  }, [sessionId]);

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
