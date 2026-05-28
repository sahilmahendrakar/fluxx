import { Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import '@xterm/xterm/css/xterm.css';
import './index.css';
import { applyAppearanceEarly } from './theme/applyAppearanceEarly';
import { ThemeProvider } from './theme/ThemeProvider';
import { Toaster } from './components/ui/sonner';
import { LoadingScreen } from './components/LoadingScreen';

applyAppearanceEarly();

const App = lazy(() => import('./App'));

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Missing #root element');
}
createRoot(rootEl).render(
  <ThemeProvider>
    <Suspense
      fallback={
        <div className="flex min-h-screen w-screen flex-col">
          <LoadingScreen />
        </div>
      }
    >
      <App />
    </Suspense>
    <Toaster />
  </ThemeProvider>,
);
