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
    fitAddon.fit();

    termRef.current = term;

    const d1 = term.onData((data) => onDataRef.current?.(data));
    const d2 = term.onResize(({ cols, rows }) =>
      onResizeRef.current?.(cols, rows),
    );

    const ro = new ResizeObserver(() => {
      fitAddon.fit();
    });
    ro.observe(container);

    return () => {
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
      className="h-full w-full min-h-0 overflow-hidden rounded-md border border-white/[0.06] bg-[#09090b]"
    />
  );
});

Terminal.displayName = 'Terminal';

export default Terminal;
