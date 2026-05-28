import type { HTMLAttributes, ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

/** Outer workspace shell for task / planning / session terminal views. */
export const terminalWorkspaceShellClass =
  'flex min-h-0 flex-1 flex-col bg-status-terminal text-status-terminal-foreground';

/** Toolbar row above terminal panes (tabs + actions). */
export const terminalToolbarClass =
  'flex shrink-0 items-center gap-2 border-b border-status-terminal-foreground/10 bg-status-terminal pl-1 pr-2.5 py-1';

/** xterm container frame — always dark regardless of app theme. */
export const terminalFrameClass =
  'flex h-full min-h-0 w-full min-w-0 flex-col bg-status-terminal';

export function TerminalAttachLoading({
  label,
  className,
}: {
  label: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-md border border-status-terminal-foreground/15 bg-status-terminal/95 text-[13px]',
        className,
      )}
      aria-live="polite"
      aria-busy="true"
    >
      <Loader2
        className="size-4 shrink-0 animate-spin text-status-terminal-foreground/70"
        aria-hidden
      />
      <span className="font-medium text-status-terminal-foreground">{label}</span>
    </div>
  );
}

export function TerminalInlineLoading({ label }: { label: string }) {
  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-2 text-[13px] text-status-terminal-foreground/70"
      aria-live="polite"
      aria-busy="true"
    >
      <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
      <span className="font-medium text-status-terminal-foreground">{label}</span>
    </div>
  );
}

export type TerminalStatusBannerVariant = 'success' | 'error' | 'info';

const statusBannerClass: Record<TerminalStatusBannerVariant, string> = {
  success:
    'border-status-success/25 bg-status-success/10 text-status-success-foreground',
  error: 'border-destructive/25 bg-destructive/10 text-destructive',
  info: 'border-status-terminal-foreground/10 bg-status-terminal-foreground/5 text-status-terminal-foreground/80',
};

export function TerminalStatusBanner({
  variant,
  children,
  role,
  className,
}: {
  variant: TerminalStatusBannerVariant;
  children: ReactNode;
  role?: 'alert' | 'status';
  className?: string;
}) {
  return (
    <div
      role={role ?? (variant === 'error' ? 'alert' : 'status')}
      className={cn(
        'shrink-0 border-b px-3 py-2 text-[12px] leading-snug',
        statusBannerClass[variant],
        className,
      )}
    >
      {children}
    </div>
  );
}

export function TerminalTrustNotice({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      className="absolute left-3 right-3 top-3 z-[5] rounded-md border border-status-success/25 bg-status-success/10 px-2.5 py-1.5 text-[11.5px] leading-snug text-status-success-foreground"
    >
      {children}
    </div>
  );
}

export function TerminalWorkspaceTab({
  label,
  active,
  onClick,
  onClose,
  status,
  icon,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  onClose?: () => void;
  status?: 'running' | 'stopped' | 'error' | 'idle';
  icon?: ReactNode;
}) {
  const running = status === 'running';
  return (
    <div
      className={cn(
        'group flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] transition-colors',
        active
          ? 'bg-status-terminal-foreground/10 text-status-terminal-foreground shadow-[inset_0_0_0_1px_hsl(var(--status-terminal-foreground)/0.12)]'
          : 'text-status-terminal-foreground/55 hover:bg-status-terminal-foreground/5 hover:text-status-terminal-foreground',
      )}
    >
      <button type="button" onClick={onClick} className="flex items-center gap-1.5">
        {icon ? (
          icon
        ) : status ? (
          <span
            className={cn(
              'inline-block size-1.5 rounded-full',
              running ? 'bg-status-success' : 'bg-status-terminal-foreground/35',
            )}
            aria-hidden
          />
        ) : null}
        <span>{label}</span>
      </button>
      {onClose ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Close ${label}`}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="size-3.5 min-h-0 min-w-0 p-0 text-status-terminal-foreground/45 opacity-60 hover:bg-status-terminal-foreground/10 hover:text-status-terminal-foreground hover:opacity-100"
        >
          <span className="text-[12px] leading-none" aria-hidden>
            ×
          </span>
        </Button>
      ) : null}
    </div>
  );
}

export function TerminalResizeHandle({
  orientation,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  orientation: 'horizontal' | 'vertical';
}) {
  const isHorizontal = orientation === 'horizontal';
  return (
    <div
      role="separator"
      aria-orientation={isHorizontal ? 'horizontal' : 'vertical'}
      tabIndex={0}
      className={cn(
        'touch-none outline-none transition focus-visible:ring-2 focus-visible:ring-ring/40',
        isHorizontal
          ? 'relative z-10 h-1.5 w-full shrink-0 cursor-row-resize border-t border-status-terminal-foreground/10 bg-status-terminal before:pointer-events-none before:absolute before:left-2 before:right-2 before:top-1/2 before:h-px before:-translate-y-1/2 before:bg-status-terminal-foreground/20 before:content-[""] hover:before:bg-status-terminal-foreground/35 focus-visible:ring-inset'
          : 'absolute bottom-0 left-0 top-0 z-30 w-3 -translate-x-1/2 cursor-col-resize before:pointer-events-none before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-status-terminal-foreground/15 before:content-[""] hover:before:bg-status-terminal-foreground/30',
        className,
      )}
      {...props}
    />
  );
}

export function TerminalEmptyState({
  title,
  detail,
  children,
}: {
  title: string;
  detail?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-4 py-6 text-center">
      <p className="text-[13px] text-status-terminal-foreground/70">{title}</p>
      {detail ? (
        <div className="max-w-sm text-xs leading-relaxed text-status-terminal-foreground/50">
          {detail}
        </div>
      ) : null}
      {children}
    </div>
  );
}
