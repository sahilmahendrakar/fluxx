import { useWindowFullscreen } from '@/renderer/useWindowFullscreen';

/** Reserved drag region for macOS `hiddenInset` title bar; omitted in native fullscreen. */
export function MacTitleBarInset() {
  const isFullscreen = useWindowFullscreen();
  if (window.electronAPI.platform !== 'darwin' || isFullscreen) return null;
  return <div className="app-window-drag h-10 w-full shrink-0" aria-hidden />;
}
