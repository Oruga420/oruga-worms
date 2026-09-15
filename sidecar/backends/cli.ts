/**
 * The cli CPU backend: claude -p with the isolation set, kept behind ORUGAS_CPU_BACKEND=cli for
 * the house rule. Facts measured by the judge on 2026-09-03 (docs/research/judge-charly): --bare
 * cannot authenticate on this laptop (OAuth only), the non bare isolation set fires no global
 * hook, a Haiku turn took 20 to 42 s, and spawning the npm shim with shell:true drops the empty
 * --allowedTools value. So: no --bare, spawn process.execPath with the CLI entry file (no shim,
 * no shell), prompt on stdin, MAX_THINKING_TOKENS capped, --no-session-persistence, a long
 * timeout, and the api backend stays the default.
 */

import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { CpuTurnRequest } from '../../src/ai/contract.ts';
import { err, ok, type Result } from '../../src/core/result.ts';
import { buildSystemPrompt, buildUserMessage } from '../prompt.ts';
import { extractFirstJsonObject, type ApiDecision } from './api.ts';

export const CLI_MODEL_DEFAULT = 'claude-haiku-4-5-20251001';
export const CLI_TIMEOUT_MS_DEFAULT = 45_000;
export const CLI_MAX_THINKING_TOKENS = '1024';
/** Cap the buffered cli stdout so a runaway response cannot grow memory until the timeout. */
export const CLI_MAX_OUTPUT_CHARS = 256 * 1024;

/** Isolation set verified live by the judge (no --bare). --allowedTools stays LAST: it is greedy. */
export function buildCliArgs(model: string, systemPrompt: string): readonly string[] {
  return Object.freeze([
    '-p',
    '--output-format',
    'json',
    '--model',
    model,
    '--permission-mode',
    'dontAsk',
    '--strict-mcp-config',
    '--setting-sources=',
    '--tools=',
    '--disable-slash-commands',
    '--no-session-persistence',
    '--append-system-prompt',
    systemPrompt,
    '--allowedTools',
    '',
  ]);
}

/** Candidate paths of the CLI entry file, most specific first. The env override wins. */
export function cliEntryCandidates(env: Readonly<Record<string, string | undefined>>): readonly string[] {
  const out: string[] = [];
  const override = env['ORUGAS_CLAUDE_CLI'];
  if (override !== undefined && override.trim() !== '') out.push(override.trim());
  const appData = env['APPDATA'];
  if (appData !== undefined && appData.trim() !== '') {
    out.push(join(appData, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'));
  }
  const prefix = env['NPM_CONFIG_PREFIX'] ?? env['npm_config_prefix'];
  if (prefix !== undefined && prefix.trim() !== '') {
    out.push(join(prefix, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'));
    out.push(join(prefix, 'lib', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'));
  }
  return out;
}

export function resolveCliEntry(
  env: Readonly<Record<string, string | undefined>> = process.env,
  exists: (path: string) => boolean = existsSync,
): Result<string, string> {
  const found = cliEntryCandidates(env).find((candidate) => exists(candidate));
  return found === undefined ? err('claude CLI entry file not found; set ORUGAS_CLAUDE_CLI') : ok(found);
}

export interface CliEnvelope {
  readonly result: string;
  readonly costUsd: number;
  readonly durationMs: number;
}

/** Parses the --output-format json envelope. is_error or a non string result is a failure even when subtype says success. */
export function parseCliEnvelope(stdout: string): Result<CliEnvelope, string> {
  const parsed = extractFirstJsonObject(stdout);
  if (!parsed.ok) return err(`cli envelope: ${parsed.error}`);
  const envelope = parsed.value as Readonly<Record<string, unknown>>;
  if (envelope['is_error'] === true) return err(`cli reported an error: ${String(envelope['result'] ?? 'unknown')}`);
  const result = envelope['result'];
  if (typeof result !== 'string') return err('cli envelope has no result text');
  const cost = envelope['total_cost_usd'];
  const duration = envelope['duration_ms'];
  return ok({
    result,
    costUsd: typeof cost === 'number' && Number.isFinite(cost) ? cost : 0,
    durationMs: typeof duration === 'number' && Number.isFinite(duration) ? duration : 0,
  });
}

export type SpawnFn = (command: string, args: readonly string[], options: { readonly env: NodeJS.ProcessEnv }) => ChildProcess;

export interface CliBackendOptions {
  readonly model?: string;
  readonly timeoutMs?: number;
  readonly cliEntry?: string;
  readonly spawn?: SpawnFn;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

function defaultSpawn(command: string, args: readonly string[], options: { readonly env: NodeJS.ProcessEnv }): ChildProcess {
  return nodeSpawn(command, [...args], { env: options.env, stdio: ['pipe', 'pipe', 'pipe'], shell: false, windowsHide: true });
}

/** Runs one CPU turn through claude -p. Never throws; every failure is an Err the handler turns into a fallback. */
export function requestCpuTurnViaCli(req: CpuTurnRequest, options: CliBackendOptions = {}): Promise<Result<ApiDecision, string>> {
  const env = options.env ?? process.env;
  const entry = options.cliEntry === undefined ? resolveCliEntry(env) : ok(options.cliEntry);
  if (!entry.ok) return Promise.resolve(err(entry.error));
  const model = options.model ?? CLI_MODEL_DEFAULT;
  const timeoutMs = options.timeoutMs ?? CLI_TIMEOUT_MS_DEFAULT;
  const spawn = options.spawn ?? defaultSpawn;
  const args = [entry.value, ...buildCliArgs(model, buildSystemPrompt(req.personality, req.difficulty))];
  const childEnv: NodeJS.ProcessEnv = { ...env, MAX_THINKING_TOKENS: CLI_MAX_THINKING_TOKENS };
  const started = performance.now();

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: Result<ApiDecision, string>): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    let child: ChildProcess;
    try {
      child = spawn(process.execPath, args, { env: childEnv });
    } catch (error: unknown) {
      finish(err(`cli spawn failed: ${error instanceof Error ? error.message : String(error)}`));
      return;
    }
    const chunks: string[] = [];
    let total = 0;
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(err(`cli timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      // Bound the buffer like readJsonBody does for the http path: a pathological response must not
      // grow memory unchecked until the timeout.
      total += chunk.length;
      if (total > CLI_MAX_OUTPUT_CHARS) {
        clearTimeout(timer);
        child.kill('SIGKILL');
        finish(err(`cli output exceeded ${CLI_MAX_OUTPUT_CHARS} chars`));
        return;
      }
      chunks.push(chunk);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      finish(err(`cli process error: ${error.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const envelope = parseCliEnvelope(chunks.join(''));
      if (!envelope.ok) {
        finish(err(code === 0 ? envelope.error : `cli exited with code ${String(code)}: ${envelope.error}`));
        return;
      }
      const raw = extractFirstJsonObject(envelope.value.result);
      if (!raw.ok) {
        finish(err(raw.error));
        return;
      }
      finish(
        ok({
          raw: raw.value,
          model,
          durationMs: Math.round(performance.now() - started),
          inputTokens: 0,
          outputTokens: 0,
          costUsd: envelope.value.costUsd,
          stopReason: null,
        }),
      );
    });
    child.stdin?.on('error', () => undefined);
    child.stdin?.end(buildUserMessage(req));
  });
}
