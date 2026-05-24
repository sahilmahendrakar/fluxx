import type { RemoteRepoBinding, RemoteRepoBindingsByDevice } from './types';

export function parseRemoteRepoBinding(value: unknown): RemoteRepoBinding | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const remotePath = typeof v.remotePath === 'string' ? v.remotePath.trim() : '';
  const boundAt = typeof v.boundAt === 'string' ? v.boundAt.trim() : '';
  if (!remotePath || !boundAt) return null;
  const out: RemoteRepoBinding = { remotePath, boundAt };
  if (typeof v.lastValidatedAt === 'string' && v.lastValidatedAt.trim()) {
    out.lastValidatedAt = v.lastValidatedAt.trim();
  }
  return out;
}

export function parseRemoteRepoBindingsByDevice(
  raw: unknown,
): RemoteRepoBindingsByDevice | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: RemoteRepoBindingsByDevice = {};
  for (const [deviceId, perRepo] of Object.entries(raw as Record<string, unknown>)) {
    const did = deviceId.trim();
    if (!did || !perRepo || typeof perRepo !== 'object') continue;
    const repos: Record<string, RemoteRepoBinding> = {};
    for (const [repoId, bindingRaw] of Object.entries(perRepo as Record<string, unknown>)) {
      const rid = repoId.trim();
      if (!rid) continue;
      const binding = parseRemoteRepoBinding(bindingRaw);
      if (binding) repos[rid] = binding;
    }
    if (Object.keys(repos).length > 0) {
      out[did] = repos;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function getRemoteRepoBinding(
  map: RemoteRepoBindingsByDevice | undefined,
  deviceId: string,
  repoId: string,
): RemoteRepoBinding | undefined {
  const did = deviceId.trim();
  const rid = repoId.trim();
  if (!did || !rid || !map) return undefined;
  return map[did]?.[rid];
}
