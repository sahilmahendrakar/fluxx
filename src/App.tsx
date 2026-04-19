export default function App() {
  const isMac = window.electronAPI.platform === 'darwin';

  return (
    <div className="flex h-screen w-screen flex-col bg-gray-950 text-white">
      {isMac ? (
        <div
          className="app-window-drag h-14 w-full shrink-0 bg-gray-950"
          aria-hidden
        />
      ) : null}
      <div className="app-window-no-drag flex flex-1 flex-col items-center justify-center">
        <h1 className="text-5xl font-semibold tracking-tight">Flux</h1>
        <p className="mt-3 text-lg text-gray-400">AI agent task manager</p>
        <p className="mt-6 text-sm text-gray-600">
          Running on {window.electronAPI.platform}
        </p>
      </div>
    </div>
  );
}
