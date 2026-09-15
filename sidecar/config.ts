/**
 * Turns environment values into the sidecar runtime configuration, shared by the standalone
 * server (sidecar/index.ts) and the Vite dev middleware (vite.config.ts) so both behave the same.
 * Keys are read here and handed to the backends; describeConfig() is the only thing that may be
 * logged and it never contains a secret.
 */

import { CPU_BACKENDS, type CpuBackend } from '../src/ai/contract.ts';
import type { CpuTurnDeps } from './cpu-turn.ts';
import type { EnvMap } from './env.ts';
import { createMatchBudget } from './rate-limit.ts';
import type { GuardConfig } from './server.ts';

export const DEFAULT_MAX_CALLS_PER_MATCH = 200;
export const TOKEN_HEADER = 'x-orugas-token';

export interface SidecarConfig extends GuardConfig {
  readonly backend: CpuBackend;
  readonly llmEnabled: boolean;
  readonly apiKey?: string;
  readonly modelOverride?: string;
  readonly maxCallsPerMatch: number;
}

export interface ConfigDefaults {
  readonly vitePort: number;
}

function parseBackend(raw: string | undefined): CpuBackend {
  const value = (raw ?? 'off').trim().toLowerCase();
  return (CPU_BACKENDS as readonly string[]).includes(value) ? (value as CpuBackend) : 'off';
}

function parseSwitch(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  const value = raw.trim().toLowerCase();
  if (['on', 'true', '1', 'yes'].includes(value)) return true;
  if (['off', 'false', '0', 'no'].includes(value)) return false;
  return fallback;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || !/^\d{1,6}$/.test(raw.trim())) return fallback;
  const n = Number.parseInt(raw, 10);
  return n > 0 ? n : fallback;
}

function nonEmpty(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const value = raw.trim();
  return value === '' ? undefined : value;
}

export function defaultAllowedOrigins(vitePort: number): readonly string[] {
  return Object.freeze([`http://127.0.0.1:${vitePort}`, `http://localhost:${vitePort}`]);
}

export function readSidecarConfig(env: EnvMap, defaults: ConfigDefaults): SidecarConfig {
  const origins = nonEmpty(env['ORUGAS_ALLOWED_ORIGINS']);
  const apiKey = nonEmpty(env['ANTHROPIC_API_KEY']);
  const modelOverride = nonEmpty(env['ORUGAS_CPU_MODEL']);
  const token = nonEmpty(env['ORUGAS_CPU_TOKEN']);
  return Object.freeze({
    backend: parseBackend(env['ORUGAS_CPU_BACKEND']),
    llmEnabled: parseSwitch(env['ORUGAS_CPU_LLM'], true),
    maxCallsPerMatch: parsePositiveInt(env['ORUGAS_CPU_MAX_CALLS_PER_MATCH'], DEFAULT_MAX_CALLS_PER_MATCH),
    allowedOrigins: origins === undefined
      ? defaultAllowedOrigins(defaults.vitePort)
      : Object.freeze(origins.split(',').map((o) => o.trim()).filter((o) => o !== '')),
    ...(apiKey === undefined ? {} : { apiKey }),
    ...(modelOverride === undefined ? {} : { modelOverride }),
    ...(token === undefined ? {} : { token }),
  });
}

export function buildCpuTurnDeps(config: SidecarConfig, log: (line: string) => void): CpuTurnDeps {
  return Object.freeze({
    backend: config.backend,
    llmEnabled: config.llmEnabled,
    budget: createMatchBudget(config.maxCallsPerMatch),
    ...(config.apiKey === undefined ? {} : { apiKey: config.apiKey }),
    ...(config.modelOverride === undefined ? {} : { modelOverride: config.modelOverride }),
    log,
  });
}

/** Safe to log: names the backend and whether a key is present, never the key. */
export function describeConfig(config: SidecarConfig): string {
  return [
    `backend=${config.backend}`,
    `llm=${config.llmEnabled ? 'on' : 'off'}`,
    `key=${config.apiKey === undefined ? 'absent' : 'present'}`,
    `model=${config.modelOverride ?? 'by difficulty'}`,
    `budget=${config.maxCallsPerMatch}/match`,
    `origins=${config.allowedOrigins.length}`,
    `token=${config.token === undefined ? 'none' : 'required'}`,
  ].join(' ');
}
