export function LoadingScreen() {
  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-flux-canvas text-flux-fg">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-1/2 h-[280px] w-[280px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-violet-600/[0.1] blur-[80px]" />
      </div>
      <div className="relative flex flex-col items-center gap-5">
        <div
          className="h-5 w-5 animate-spin rounded-full border-2 border-flux-border/15 border-t-flux-fg-muted"
          aria-hidden
        />
        <div className="text-sm font-medium tracking-tight text-flux-fg-muted">Flux</div>
      </div>
    </div>
  );
}
