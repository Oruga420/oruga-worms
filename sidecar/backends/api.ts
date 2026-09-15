/**
 * The api CPU backend: one Anthropic Messages API call per CPU turn with structured output.
 * Chosen in ultraplan rev 2 after the judge measured the claude -p path at 20.6 to 42.3 s per turn:
 * here the system prompt is about 600 tokens, there is no extended thinking, retries are off so the
 * caller's timeout is the real ceiling, and the model returns the JSON shape directly.
 *
 * This module never logs the key and never logs the prompt. It returns the RAW parsed object; the
 * sanitizer in sanitize.ts is the only thing allowed to turn it into a CpuTurnResponse.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { CpuDifficulty, CpuTurnRequest } from '../../src/ai/contract.ts';
import { err, ok, type Result } from '../../src/core/result.ts';
import { CPU_TURN_OUTPUT_SCHEMA, buildSystemPrompt, buildUserMessage } from '../prompt.ts';

/** Haiku 4.5 for easy and normal, Sonnet 5 for hard (ultraplan rev 2, CPU section). */
export const API_MODEL_DEFAULT = 'claude-haiku-4-5';
export const API_MODEL_HARD = 'claude-sonnet-5';
export const API_MAX_TOKENS = 400;
export const API_TIMEOUT_MS_DEFAULT = 8000;

/** USD per token, Anthropic list prices (claude-api skill table, cached 2026-06-24). */
const PRICE_USD_PER_TOKEN: Readonly<Record<string, { readonly input: number; readonly output: number }>> =
  Object.freeze({
    'claude-haiku-4-5': { input: 1 / 1_000_000, output: 5 / 1_000_000 },
    'claude-sonnet-5': { input: 2 / 1_000_000, output: 10 / 1_000_000 },
  });

export interface ApiBackendOptions {
  readonly apiKey: string;
  /** Overrides the difficulty based model choice. */
  readonly model?: string;
  readonly timeoutMs?: number;
}

export interface ApiDecision {
  /** The parsed JSON object exactly as the model returned it. Untrusted until sanitized. */
  readonly raw: unknown;
  readonly model: string;
  readonly durationMs: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
  readonly stopReason: string | null;
}

export function modelForDifficulty(difficulty: CpuDifficulty): string {
  return difficulty === 'hard' ? API_MODEL_HARD : API_MODEL_DEFAULT;
}

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const price = PRICE_USD_PER_TOKEN[model] ?? PRICE_USD_PER_TOKEN[API_MODEL_DEFAULT];
  if (price === undefined) return 0;
  return inputTokens * price.input + outputTokens * price.output;
}

/** First balanced JSON object in a text, tolerant of code fences or prose around it. */
export function extractFirstJsonObject(text: string): Result<unknown, string> {
  const start = text.indexOf('{');
  if (start === -1) return err('no JSON object in the model output');
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return ok(JSON.parse(text.slice(start, i + 1)) as unknown);
        } catch {
          return err('model output is not valid JSON');
        }
      }
    }
  }
  return err('unbalanced JSON object in the model output');
}

function describeError(error: unknown): string {
  if (error instanceof Anthropic.APIError) {
    return `anthropic api error ${String(error.status)}: ${error.message}`;
  }
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return 'unknown error';
}

/**
 * Asks the model for a turn. Never throws: transport, timeout, refusal and parse problems come back
 * as Err so the handler can fall back to the heuristic. The key never leaves this call.
 */
export async function requestCpuTurnViaApi(
  req: CpuTurnRequest,
  options: ApiBackendOptions,
): Promise<Result<ApiDecision, string>> {
  const model = options.model ?? modelForDifficulty(req.difficulty);
  const timeout = options.timeoutMs ?? API_TIMEOUT_MS_DEFAULT;
  const client = new Anthropic({ apiKey: options.apiKey, maxRetries: 0, timeout });
  const started = performance.now();
  try {
    const message = await client.messages.create({
      model,
      max_tokens: API_MAX_TOKENS,
      system: buildSystemPrompt(req.personality, req.difficulty),
      messages: [{ role: 'user', content: buildUserMessage(req) }],
      output_config: { format: { type: 'json_schema', schema: { ...CPU_TURN_OUTPUT_SCHEMA } } },
    });
    const durationMs = Math.round(performance.now() - started);
    if (message.stop_reason === 'refusal') return err('model refused the request');
    const text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');
    const raw = extractFirstJsonObject(text);
    if (!raw.ok) return err(raw.error);
    const inputTokens = message.usage.input_tokens;
    const outputTokens = message.usage.output_tokens;
    return ok({
      raw: raw.value,
      model,
      durationMs,
      inputTokens,
      outputTokens,
      costUsd: estimateCostUsd(model, inputTokens, outputTokens),
      stopReason: message.stop_reason,
    });
  } catch (error: unknown) {
    return err(describeError(error));
  }
}
