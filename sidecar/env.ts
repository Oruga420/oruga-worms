/**
 * Tiny .env reader shared by the sidecar entry, the Vite config and the e2e helper.
 * KEY=value lines, # comments, optional single or double quotes. No dependency, no interpolation.
 * Values are never logged: a caller that prints must print the key, never the value.
 */

import { existsSync, readFileSync } from 'node:fs';
import { err, ok, type Result } from '../src/core/result.ts';

export type EnvMap = Readonly<Record<string, string>>;

const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Ports held by other local projects; never chosen, never accepted (ultraplan.html risk row). */
export const FORBIDDEN_PORTS: readonly number[] = Object.freeze([5173, 8787]);
export const PORT_MIN = 1024;
export const PORT_MAX = 65535;

function unquote(value: string): string {
  const quoted =
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")));
  return quoted ? value.slice(1, -1) : value;
}

export function parseDotEnv(text: string): EnvMap {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!KEY_PATTERN.test(key)) continue;
    out[key] = unquote(line.slice(eq + 1).trim());
  }
  return Object.freeze(out);
}

/** Reads a .env file; a missing file is an empty map, never an error. */
export function loadDotEnv(file: string): EnvMap {
  return existsSync(file) ? parseDotEnv(readFileSync(file, 'utf8')) : Object.freeze({});
}

/** Later maps win. Undefined values (process.env can carry them in types) are dropped. */
export function mergeEnv(...maps: readonly Readonly<Record<string, string | undefined>>[]): EnvMap {
  const out: Record<string, string> = {};
  for (const map of maps) {
    for (const [key, value] of Object.entries(map)) {
      if (typeof value === 'string') out[key] = value;
    }
  }
  return Object.freeze(out);
}

/** Validates a port from the env: present, an integer in range, and not held by another project. */
export function readPort(env: EnvMap, key: string): Result<number, string> {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') {
    return err(`${key} is not set; run "npm run ports" to write it into .env`);
  }
  if (!/^\d{1,5}$/.test(raw.trim())) return err(`${key} must be an integer, got a non numeric value`);
  const port = Number.parseInt(raw, 10);
  if (port < PORT_MIN || port > PORT_MAX) return err(`${key} must be between ${PORT_MIN} and ${PORT_MAX}`);
  if (FORBIDDEN_PORTS.includes(port)) return err(`${key} ${port} belongs to another local project`);
  return ok(port);
}
