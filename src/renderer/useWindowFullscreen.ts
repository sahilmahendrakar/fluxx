import { useEffect, useState } from 'react';

/** Native OS fullscreen (green button on macOS). */
export function useWindowFullscreen(): boolean {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const api = window.electronAPI?.window;
    if (!api) return;
    let active = true;
    void api.isFullscreen().then((value) => {
      if (active) setIsFullscreen(value);
    });
    const unsub = api.onFullscreenChanged((value) => {
      if (active) setIsFullscreen(value);
    });
    return () => {
      active = false;
      unsub();
    };
  }, []);

  return isFullscreen;
}
