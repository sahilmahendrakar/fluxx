import { useEffect, useState } from 'react';

const isDarwin =
  typeof window !== 'undefined' && window.electronAPI?.platform === 'darwin';

/**
 * Native macOS window fullscreen (green button), not planning-tab layout fullscreen.
 */
export function useMacWindowFullscreen(): boolean {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (!isDarwin) return;
    const chrome = window.electronAPI.windowChrome;
    if (!chrome) return;
    void chrome.getFullscreen().then(setIsFullscreen);
    return chrome.onFullscreenChanged(setIsFullscreen);
  }, []);

  return isDarwin ? isFullscreen : false;
}
