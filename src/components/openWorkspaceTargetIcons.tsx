/**
 * Cursor and VS Code paths are from Simple Icons (MIT): https://github.com/simple-icons/simple-icons
 * — rendered at small size for the “Open in” menu; VS Code uses brand blue.
 */
import { FolderOpen, Terminal } from 'lucide-react';
import type { OpenWorkspaceTarget } from '../types';

export function CursorBrandIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        fill="currentColor"
        d="M11.503.131 1.891 5.678a.84.84 0 0 0-.42.726v11.188c0 .3.162.575.42.724l9.609 5.55a1 1 0 0 0 .998 0l9.61-5.55a.84.84 0 0 0 .42-.724V6.404a.84.84 0 0 0-.42-.726L12.497.131a1.01 1.01 0 0 0-.996 0M2.657 6.338h18.55c.263 0 .43.287.297.515L12.23 22.918c-.062.107-.229.064-.229-.06V12.335a.59.59 0 0 0-.295-.51l-9.11-5.257c-.109-.063-.064-.23.061-.23"
      />
    </svg>
  );
}

export function VsCodeBrandIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        fill="#007ACC"
        d="M23.15 2.587L18.21.21a1.494 1.494 0 0 0-1.705.29l-9.46 8.63-4.12-3.128a.999.999 0 0 0-1.276.057L.327 7.261A1 1 0 0 0 .326 8.74L3.899 12 .326 15.26a1 1 0 0 0 .001 1.479L1.65 17.94a.999.999 0 0 0 1.276.057l4.12-3.128 9.46 8.63a1.492 1.492 0 0 0 1.704.29l4.942-2.377A1.5 1.5 0 0 0 24 20.06V3.939a1.5 1.5 0 0 0-.85-1.352zm-5.146 14.861L10.826 12l7.178-5.448v10.896z"
      />
    </svg>
  );
}

const MENU_ICON = 'h-4 w-4 shrink-0';

/** macOS-style window chrome (original artwork; not Apple’s Finder mark). */
function DarwinFileBrowserHintIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <rect
        x="3.25"
        y="5.25"
        width="17.5"
        height="13.5"
        rx="2"
        className="stroke-sky-400/85"
        strokeWidth="1.4"
      />
      <path d="M3.25 9.75h17.5" className="stroke-sky-400/85" strokeWidth="1.4" />
      <circle cx="6.35" cy="7.35" r="1" className="fill-red-400/90" />
      <circle cx="9.55" cy="7.35" r="1" className="fill-amber-300/90" />
      <circle cx="12.75" cy="7.35" r="1" className="fill-emerald-500/85" />
    </svg>
  );
}

function FileManagerMenuIcon({ className }: { className?: string }) {
  if (window.electronAPI.platform === 'darwin') {
    return <DarwinFileBrowserHintIcon className={className} />;
  }
  return (
    <FolderOpen
      className={className}
      strokeWidth={1.75}
      aria-hidden
      stroke="currentColor"
    />
  );
}

export function OpenWorkspaceTargetIcon({ target }: { target: OpenWorkspaceTarget }) {
  switch (target) {
    case 'cursor':
      return <CursorBrandIcon className={`${MENU_ICON} text-zinc-100`} />;
    case 'vscode':
      return <VsCodeBrandIcon className={MENU_ICON} />;
    case 'terminal':
      return (
        <Terminal
          className={`${MENU_ICON} text-zinc-300`}
          strokeWidth={1.75}
          aria-hidden
        />
      );
    case 'file-manager':
      return (
        <FileManagerMenuIcon className={`${MENU_ICON} text-sky-300/90`} />
      );
  }
}
