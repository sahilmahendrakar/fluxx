/** Custom URL scheme used to open the installed Fluxx desktop app from email links. */
export const FLUXX_DEEP_LINK_SCHEME = 'fluxx';

/** Default "Open Fluxx" target in invite emails when `FLUXX_APP_URL` is unset. */
export const DEFAULT_FLUXX_INVITE_APP_URL = `${FLUXX_DEEP_LINK_SCHEME}://open`;

/**
 * URL embedded in team-invite emails. Prefer `FLUXX_APP_URL` at build time; fall back to
 * the `fluxx://` deep link so recipients open the desktop app instead of a dev server.
 */
export function resolveFluxxInviteAppUrl(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const configured =
    env.FLUXX_APP_URL?.trim() || env.FLUX_APP_URL?.trim() || '';
  return configured || DEFAULT_FLUXX_INVITE_APP_URL;
}
