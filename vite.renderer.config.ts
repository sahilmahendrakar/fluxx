import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { importMetaEnvDefine } from './vite/inlineViteEnv';

// https://vitejs.dev/config
export default defineConfig(({ mode }) => {
  const auxPortRaw = process.env.FLUX_AUX_DEV_SERVER_PORT;
  const auxPort = auxPortRaw ? Number(auxPortRaw) : undefined;
  const port =
    auxPort && Number.isFinite(auxPort) ? auxPort : 5173;
  // Fixed ports so MAIN_WINDOW_VITE_DEV_SERVER_URL always matches the live Vite server.
  return {
    plugins: [react()],
    server: { port, strictPort: true },
    // Renderer only reads .env files by default; CI injects secrets via process.env.
    define: importMetaEnvDefine(mode),
  };
});
