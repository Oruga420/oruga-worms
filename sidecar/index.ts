/**
 * Sidecar entry: `npm run sidecar` (Node 24 runs TypeScript natively, no transpiler).
 * Reads SIDECAR_PORT and VITE_PORT from the project .env (ports only, never 5173 or 8787) and the
 * CPU settings from sidecar/.env (backend, kill switch, key, budget, allowed origins, token), then
 * serves /api on 127.0.0.1 with every guard from the security requirements in front of the turn
 * route. Nothing here ever prints a key.
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCpuTurnDeps, describeConfig, readSidecarConfig } from './config.ts';
import { loadDotEnv, mergeEnv, readPort } from './env.ts';
import { startSidecar } from './server.ts';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const projectEnv = loadDotEnv(resolve(ROOT, '.env'));
const sidecarEnv = loadDotEnv(resolve(ROOT, 'sidecar', '.env'));
const env = mergeEnv(projectEnv, sidecarEnv, process.env);

const port = readPort(env, 'SIDECAR_PORT');
const vitePort = readPort(env, 'VITE_PORT');
if (!port.ok || !vitePort.ok) {
  console.error(`sidecar: ${port.ok ? '' : port.error} ${vitePort.ok ? '' : vitePort.error}`.trim());
  process.exit(1);
}

const config = readSidecarConfig(env, { vitePort: vitePort.value });
const deps = buildCpuTurnDeps(config, (line) => console.log(line));

startSidecar({ port: port.value, backend: config.backend, deps, guards: config })
  .then((running) => {
    console.log(`orugas sidecar listening on http://${running.host}:${running.port}/api (${describeConfig(config)})`);
  })
  .catch((error: unknown) => {
    console.error(`sidecar: could not listen on 127.0.0.1:${port.value}: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
