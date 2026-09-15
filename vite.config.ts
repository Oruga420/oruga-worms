/**
 * Vite config. Ports come from .env (VITE_PORT, SIDECAR_PORT) with strictPort, never 5173 or
 * 8787. The dev server mounts the sidecar handler at /api with RELATIVE routes inside, so
 * `npm run dev` needs no second process and serves real CPU turns with the same guards and the
 * same config (sidecar/.env) as the standalone sidecar; `vite preview` proxies /api to it.
 * The CSP meta in index.html gets the sidecar origin in connect-src at build time, and in dev
 * only the HMR websocket sources plus 'unsafe-inline' for the styles Vite injects.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { createThrottle } from './sidecar/auth.ts';
import { buildCpuTurnDeps, describeConfig, readSidecarConfig, type SidecarConfig } from './sidecar/config.ts';
import { loadDotEnv, mergeEnv, readPort, type EnvMap } from './sidecar/env.ts';
import type { HandlerOptions } from './sidecar/handler.ts';
import { serveApiRequest, writeJson } from './sidecar/server.ts';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const SRC = fileURLToPath(new URL('./src', import.meta.url));
const CSP_META = /(<meta\s+http-equiv="Content-Security-Policy"\s+content=")([^"]*)(")/;

interface OrugasPluginOptions {
  readonly vitePort: number;
  readonly sidecarOrigin: string;
  readonly dev: boolean;
  readonly config: SidecarConfig;
}

/** Only used when building without a .env, where the value is inert. */
const DEV_PORT_FALLBACK = 5174;

function mustPort(env: EnvMap, key: string): number {
  const port = readPort(env, key);
  if (!port.ok) throw new Error(`vite.config: ${port.error}`);
  return port.value;
}

export function applyCsp(html: string, options: Pick<OrugasPluginOptions, 'vitePort' | 'sidecarOrigin' | 'dev'>): string {
  const match = CSP_META.exec(html);
  if (match === null || match[2] === undefined) {
    throw new Error('index.html lost its Content-Security-Policy meta; the strict CSP is required');
  }
  const devSockets = options.dev ? ` ws://localhost:${options.vitePort} ws://127.0.0.1:${options.vitePort}` : '';
  // An empty sidecar origin means a static build with no backend: keep connect-src at 'self' rather
  // than advertising a localhost origin a public visitor could never reach anyway.
  const sidecar = options.sidecarOrigin === '' ? '' : ` ${options.sidecarOrigin}`;
  const withConnect = match[2].replace("connect-src 'self'", `connect-src 'self'${sidecar}${devSockets}`);
  const csp = options.dev ? withConnect.replace("style-src 'self'", "style-src 'self' 'unsafe-inline'") : withConnect;
  return html.replace(CSP_META, (_all, open: string, _old: string, close: string) => `${open}${csp}${close}`);
}

function orugasPlugin(options: OrugasPluginOptions): Plugin {
  const handlerOptions: HandlerOptions = Object.freeze({
    backend: options.config.backend,
    deps: buildCpuTurnDeps(options.config, (line) => console.log(`[sidecar] ${line}`)),
  });
  const throttle = createThrottle(options.config.throttle ?? {});
  return {
    name: 'orugas-dev-api-and-csp',
    configureServer(server) {
      console.log(`[sidecar] dev middleware at /api (${describeConfig(options.config)})`);
      // Mounted at /api: inside the handler req.url is relative ("/cpu-turn", "/cpu-turn/health").
      server.middlewares.use('/api', (req: IncomingMessage, res: ServerResponse) => {
        serveApiRequest(req, res, req.url ?? '/', handlerOptions, options.config, throttle).catch(() => {
          if (!res.headersSent) writeJson(res, { status: 500, body: { error: 'internal error' } });
        });
      });
    },
    transformIndexHtml(html) {
      return applyCsp(html, options);
    },
  };
}

export default defineConfig(({ command, mode }) => {
  const env: EnvMap = mergeEnv(loadEnv(mode, ROOT, ''), loadDotEnv(resolve(ROOT, 'sidecar', '.env')), process.env);
  // The ports are a dev server concern. `vite build` for a static host has no .env at all, so
  // requiring them there fails the build for no reason; only `serve` genuinely needs them, and the
  // contract's "never 5173 or 8787" rule is enforced where it matters, on the running server.
  const serving = command === 'serve';
  const vitePort = serving ? mustPort(env, 'VITE_PORT') : (readPort(env, 'VITE_PORT').ok ? mustPort(env, 'VITE_PORT') : DEV_PORT_FALLBACK);
  const sidecarConfigured = readPort(env, 'SIDECAR_PORT').ok;
  if (serving && !sidecarConfigured) mustPort(env, 'SIDECAR_PORT');
  const sidecarOrigin = sidecarConfigured ? `http://127.0.0.1:${mustPort(env, 'SIDECAR_PORT')}` : '';
  const config = readSidecarConfig(env, { vitePort });

  return {
    root: ROOT,
    resolve: { alias: { '@': SRC } },
    server: { host: '127.0.0.1', port: vitePort, strictPort: true },
    preview: {
      host: '127.0.0.1',
      port: vitePort,
      strictPort: true,
      ...(sidecarOrigin === '' ? {} : { proxy: { '/api': { target: sidecarOrigin, changeOrigin: true } } }),
    },
    plugins: [orugasPlugin({ vitePort, sidecarOrigin, dev: command === 'serve', config })],
    build: { target: 'es2022', sourcemap: true, outDir: 'dist', emptyOutDir: true },
  };
});
