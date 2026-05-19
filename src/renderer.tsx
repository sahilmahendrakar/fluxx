import { Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import '@xterm/xterm/css/xterm.css';
import './index.css';
import { LoadingScreen } from './components/LoadingScreen';

const App = lazy(() => import('./App'));

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Missing #root element');
}
createRoot(rootEl).render(
  <Suspense
    fallback={
      <div className="flex min-h-screen w-screen flex-col">
        <LoadingScreen />
      </div>
    }
  >
    <App />
  </Suspense>,
);
