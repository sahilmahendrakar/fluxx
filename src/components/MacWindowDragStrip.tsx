import { useMacWindowFullscreen } from '../renderer/useMacWindowFullscreen';

const isDarwin =
  typeof window !== 'undefined' && window.electronAPI?.platform === 'darwin';

/**
 * macOS-only top drag strip for `hiddenInset` title bars. Windowed mode reserves
 * space for traffic lights; native fullscreen uses a minimal band.
 */
export function MacWindowDragStrip() {
  const isFullscreen = useMacWindowFullscreen();

  if (!isDarwin) return null;

  return (
    <div
      className={[
        'app-window-drag mac-window-title-drag-strip w-full shrink-0 bg-[#09090b]',
        isFullscreen
          ? 'mac-window-title-drag-strip--fullscreen'
          : 'mac-window-title-drag-strip--windowed',
      ].join(' ')}
      aria-hidden
    />
  );
}
