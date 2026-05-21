import { loadEnv } from 'vite';

/** Keys inlined into renderer `import.meta.env` and available to main `loadEnv` + process.env fallback. */
export const RELEASE_VITE_ENV_KEYS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
  'VITE_GOOGLE_DESKTOP_CLIENT_ID',
] as const;

export function resolveViteEnvValue(
  env: Record<string, string>,
  key: (typeof RELEASE_VITE_ENV_KEYS)[number] | string,
): string {
  return env[key] ?? process.env[key] ?? '';
}

/** `define` map for renderer: forces CI/process env into the production bundle. */
export function importMetaEnvDefine(
  mode: string,
  keys: readonly string[] = RELEASE_VITE_ENV_KEYS,
): Record<string, string> {
  const env = loadEnv(mode, process.cwd(), '');
  return Object.fromEntries(
    keys.map((key) => [
      `import.meta.env.${key}`,
      JSON.stringify(resolveViteEnvValue(env, key)),
    ]),
  );
}

/** `define` entries for main-process `process.env.*` inlining. */
export function processEnvDefine(
  mode: string,
  keys: readonly string[],
): Record<string, string> {
  const env = loadEnv(mode, process.cwd(), '');
  return Object.fromEntries(
    keys.map((key) => [
      `process.env.${key}`,
      JSON.stringify(resolveViteEnvValue(env, key)),
    ]),
  );
}
