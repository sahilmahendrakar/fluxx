/** Protocol + bundled artifact version for `fluxx-remote-helper`. */
export const FLUXX_REMOTE_HELPER_VERSION = '0.2.1';

export const FLUXX_REMOTE_HELPER_COMMAND = 'fluxx-remote-helper';

/** Remote install dir relative to `$HOME` (matches planning doc). */
export const FLUXX_REMOTE_HELPER_REMOTE_BIN_DIR = '.fluxx/bin';

export function fluxxRemoteHelperVersionedFilename(version: string = FLUXX_REMOTE_HELPER_VERSION): string {
  return `${FLUXX_REMOTE_HELPER_COMMAND}-${version}.js`;
}
