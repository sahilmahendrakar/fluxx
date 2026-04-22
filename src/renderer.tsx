import { createRoot } from 'react-dom/client';
import '@xterm/xterm/css/xterm.css';
import './index.css';
import App from './App';
import { getStoredTheme, isVisuallyDark } from './renderer/theme';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Missing #root element');
}

void window.electronAPI.theme.syncChrome({
  visuallyDark: isVisuallyDark(getStoredTheme()),
});

createRoot(rootEl).render(<App />);
