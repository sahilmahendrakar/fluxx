import { Monitor, Server } from 'lucide-react';

/** Local = Monitor, SSH = Server (same glyphs as Settings → Devices). */
export function ExecutionDeviceKindIcon({
  kind,
  className = 'h-4 w-4',
  strokeWidth = 1.75,
}: {
  kind: 'local' | 'ssh';
  className?: string;
  strokeWidth?: number;
}) {
  if (kind === 'ssh') {
    return <Server className={className} strokeWidth={strokeWidth} aria-hidden />;
  }
  return <Monitor className={className} strokeWidth={strokeWidth} aria-hidden />;
}
