import { createRoot } from 'react-dom/client';
import '@xterm/xterm/css/xterm.css';
import './index.css';
import App from './App';
import { FluxThemeProvider } from './renderer/FluxThemeProvider';
import { applyThemeToDocument, readStoredTheme } from './renderer/theme';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Missing #root element');
}

applyThemeToDocument(readStoredTheme());

createRoot(rootEl).render(
  <FluxThemeProvider>
    <App />
  </FluxThemeProvider>,
);
