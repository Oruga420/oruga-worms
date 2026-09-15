#!/usr/bin/env node
// Free port scan for Orugas (ultraplan.html, Phase 0.2 and the "ports from .env with strictPort" rule).
//
// Picks VITE_PORT and SIDECAR_PORT from candidate ranges, never 5173 (Kairos dev server) and
// never 8787 (scribe relay), by actually binding each candidate on 127.0.0.1 and ::1.
// Writes the two keys into <projectRoot>/.env, keeping any other lines that file already has.
// .env carries ports only, never secrets.
//
// Usage:
//   node scripts/find-ports.mjs            scan, write .env, print the result
//   node scripts/find-ports.mjs --dry-run  scan and print, do not write
//   node scripts/find-ports.mjs --check    verify the ports already in .env are still free (exit 1 if not)

import { createServer } from 'node:net';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = resolve(ROOT, '.env');
const FORBIDDEN_PORTS = Object.freeze([5173, 8787]);
const HOSTS = Object.freeze(['127.0.0.1', '::1']);
const CANDIDATES = Object.freeze({
  VITE_PORT: range(5174, 5199),
  SIDECAR_PORT: range(8788, 8820),
});

function range(from, to) {
  return Object.freeze(Array.from({ length: to - from + 1 }, (_, i) => from + i));
}

function canBind(port, host) {
  return new Promise((done) => {
    const server = createServer();
    server.unref();
    server.once('error', (error) => {
      // A host we cannot bind at all (no IPv6 loopback) does not mean the port is busy.
      const softErrors = new Set(['EADDRNOTAVAIL', 'EAFNOSUPPORT', 'EINVAL']);
      done(softErrors.has(error.code) ? true : false);
    });
    server.listen({ port, host, exclusive: true }, () => server.close(() => done(true)));
  });
}

async function isFree(port) {
  if (FORBIDDEN_PORTS.includes(port)) return false;
  for (const host of HOSTS) {
    if (!(await canBind(port, host))) return false;
  }
  return true;
}

async function firstFree(candidates, taken) {
  for (const port of candidates) {
    if (taken.has(port)) continue;
    if (await isFree(port)) return port;
  }
  return null;
}

function parseEnv(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/))
    .filter(Boolean)
    .reduce((acc, m) => ({ ...acc, [m[1]]: m[2] }), {});
}

function mergeEnvText(existing, values) {
  const lines = existing ? existing.split(/\r?\n/) : [];
  const pending = new Set(Object.keys(values));
  const rewritten = lines.map((line) => {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (!m || !pending.has(m[1])) return line;
    pending.delete(m[1]);
    return `${m[1]}=${values[m[1]]}`;
  });
  const trimmed = rewritten.filter((line, i) => !(i === rewritten.length - 1 && line === ''));
  const appended = [...pending].map((key) => `${key}=${values[key]}`);
  return [...trimmed, ...appended].join('\n') + '\n';
}

async function scan() {
  const taken = new Set();
  const chosen = {};
  for (const [key, candidates] of Object.entries(CANDIDATES)) {
    const port = await firstFree(candidates, taken);
    if (port === null) throw new Error(`no free port for ${key} in ${candidates[0]}..${candidates.at(-1)}`);
    taken.add(port);
    chosen[key] = port;
  }
  return chosen;
}

async function check() {
  if (!existsSync(ENV_FILE)) {
    console.error('find-ports --check: .env does not exist, run the scan first');
    return 1;
  }
  const env = parseEnv(readFileSync(ENV_FILE, 'utf8'));
  let failures = 0;
  for (const key of Object.keys(CANDIDATES)) {
    const port = Number.parseInt(env[key] ?? '', 10);
    if (!Number.isInteger(port)) {
      console.error(`find-ports --check: ${key} missing or not an integer in .env`);
      failures += 1;
      continue;
    }
    const free = await isFree(port);
    console.log(`${key}=${port} ${free ? 'free' : 'BUSY or forbidden'}`);
    if (!free) failures += 1;
  }
  return failures === 0 ? 0 : 1;
}

async function main(argv) {
  if (argv.includes('--check')) return check();
  const chosen = await scan();
  for (const [key, port] of Object.entries(chosen)) console.log(`${key}=${port}`);
  if (argv.includes('--dry-run')) return 0;
  const existing = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, 'utf8') : '';
  writeFileSync(ENV_FILE, mergeEnvText(existing, chosen), 'utf8');
  console.log(`wrote ${ENV_FILE}`);
  return 0;
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(`find-ports: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
