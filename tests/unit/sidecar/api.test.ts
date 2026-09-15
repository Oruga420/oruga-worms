import { describe, expect, it } from 'vitest';
import {
  API_MODEL_DEFAULT,
  API_MODEL_HARD,
  estimateCostUsd,
  extractFirstJsonObject,
  modelForDifficulty,
} from '../../../sidecar/backends/api.ts';

describe('extractFirstJsonObject', () => {
  it('parses a bare object', () => {
    const result = extractFirstJsonObject('{"a":1,"b":[1,2]}');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ a: 1, b: [1, 2] });
  });

  it('parses an object wrapped in a code fence with prose around it', () => {
    const text = 'Here you go:\n```json\n{"weapon":"bazooka","power":70}\n```\nGood luck.';
    const result = extractFirstJsonObject(text);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ weapon: 'bazooka', power: 70 });
  });

  it('handles braces and escaped quotes inside strings', () => {
    const text = '{"taunt":"say \\"hi}\\" {now}","n":{"x":1}} trailing {';
    const result = extractFirstJsonObject(text);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ taunt: 'say "hi}" {now}', n: { x: 1 } });
  });

  it('rejects text without an object', () => {
    const result = extractFirstJsonObject('no json here');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('no JSON object');
  });

  it('rejects an unbalanced object', () => {
    const result = extractFirstJsonObject('{"a": {"b": 1}');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('unbalanced');
  });

  it('rejects a balanced but invalid object', () => {
    const result = extractFirstJsonObject('{a: 1}');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('not valid JSON');
  });
});

describe('estimateCostUsd', () => {
  it('prices Haiku at 1 and 5 USD per million tokens', () => {
    expect(estimateCostUsd(API_MODEL_DEFAULT, 1_000_000, 1_000_000)).toBeCloseTo(6, 6);
    expect(estimateCostUsd(API_MODEL_DEFAULT, 1873, 120)).toBeCloseTo(0.002473, 6);
  });

  it('prices Sonnet at 2 and 10 USD per million tokens', () => {
    expect(estimateCostUsd(API_MODEL_HARD, 1_000_000, 1_000_000)).toBeCloseTo(12, 6);
  });

  it('falls back to Haiku pricing for an unknown model', () => {
    expect(estimateCostUsd('claude-unknown', 1_000_000, 0)).toBeCloseTo(1, 6);
  });
});

describe('modelForDifficulty', () => {
  it('uses Haiku for easy and normal and Sonnet for hard', () => {
    expect(modelForDifficulty('easy')).toBe(API_MODEL_DEFAULT);
    expect(modelForDifficulty('normal')).toBe(API_MODEL_DEFAULT);
    expect(modelForDifficulty('hard')).toBe(API_MODEL_HARD);
  });
});
