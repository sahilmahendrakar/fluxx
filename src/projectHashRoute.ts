import { useSyncExternalStore } from 'react';

const ROUTE_SYNC_EVENT = 'flux:project-hash-route';

function normalizePathFromHash(): string {
  const raw = window.location.hash.replace(/^#/, '').trim() || '/';
  return raw.startsWith('/') ? raw : `/${raw}`;
}

export function readProjectHashRoute(): 'workspace' | 'settings' {
  const path = normalizePathFromHash();
  if (path === '/settings' || path.startsWith('/settings/')) return 'settings';
  return 'workspace';
}

export function subscribeProjectHashRoute(onStoreChange: () => void): () => void {
  const run = () => onStoreChange();
  window.addEventListener('hashchange', run);
  window.addEventListener(ROUTE_SYNC_EVENT, run);
  return () => {
    window.removeEventListener('hashchange', run);
    window.removeEventListener(ROUTE_SYNC_EVENT, run);
  };
}

function emitRouteSync(): void {
  window.dispatchEvent(new Event(ROUTE_SYNC_EVENT));
}

/** History entry with `#/settings` so the system back gesture returns to the workspace. */
export function pushProjectSettingsRoute(): void {
  window.location.hash = '#/settings';
}

/** Leave settings on the current history entry (no extra stack frame). */
export function replaceProjectWorkspaceRoute(): void {
  if (readProjectHashRoute() !== 'settings') return;
  const { pathname, search } = window.location;
  window.history.replaceState(window.history.state, '', `${pathname}${search}`);
  emitRouteSync();
}

/** No-op when not on `#/settings` (safe to call before workspace tab changes). */
export function leaveSettingsIfActive(): void {
  replaceProjectWorkspaceRoute();
}

export function useProjectHashRoute(): 'workspace' | 'settings' {
  return useSyncExternalStore(
    subscribeProjectHashRoute,
    readProjectHashRoute,
    readProjectHashRoute,
  );
}
