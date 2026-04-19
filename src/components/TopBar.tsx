interface TopBarProps {
  title: string;
  statusLine: string;
}

export function TopBar({ title, statusLine }: TopBarProps) {
  return (
    <header className="flex shrink-0 items-center justify-between border-b border-gray-800 px-4 py-3">
      <h1 className="text-base font-medium text-gray-100">{title}</h1>
      <p className="text-xs text-gray-500">{statusLine}</p>
    </header>
  );
}
