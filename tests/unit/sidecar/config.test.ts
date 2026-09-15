import { describe, expect, it } from 'vitest';
import { buildCpuTurnDeps, DEFAULT_MAX_CALLS_PER_MATCH, describeConfig, readSidecarConfig } from '../../../sidecar/config.ts';

describe('readSidecarConfig', () => {
  it('applies safe defaults: backend off, llm on, default budget, origins from the vite port', () => {
    const config = readSidecarConfig({}, { vitePort: 5174 });
    expect(config.backend).toBe('off');
    expect(config.llmEnabled).toBe(true);
    expect(config.maxCallsPerMatch).toBe(DEFAULT_MAX_CALLS_PER_MATCH);
    expect(config.allowedOrigins).toEqual(['http://127.0.0.1:5174', 'http://localhost:5174']);
    expect(config.apiKey).toBeUndefined();
    expect(config.token).toBeUndefined();
  });

  it('parses every value and ignores blanks', () => {
    const config = readSidecarConfig(
      {
        ORUGAS_CPU_BACKEND: 'API',
        ORUGAS_CPU_LLM: 'off',
        ANTHROPIC_API_KEY: ' secret-value ',
        ORUGAS_CPU_MODEL: 'claude-sonnet-5',
        ORUGAS_CPU_MAX_CALLS_PER_MATCH: '50',
        ORUGAS_ALLOWED_ORIGINS: 'http://127.0.0.1:9000, http://localhost:9000,,',
        ORUGAS_CPU_TOKEN: '',
      },
      { vitePort: 5174 },
    );
    expect(config.backend).toBe('api');
    expect(config.llmEnabled).toBe(false);
    expect(config.apiKey).toBe('secret-value');
    expect(config.modelOverride).toBe('claude-sonnet-5');
    expect(config.maxCallsPerMatch).toBe(50);
    expect(config.allowedOrigins).toEqual(['http://127.0.0.1:9000', 'http://localhost:9000']);
    expect(config.token).toBeUndefined();
  });

  it('falls back to off for an unknown backend and to the default for a bad budget', () => {
    const config = readSidecarConfig({ ORUGAS_CPU_BACKEND: 'gpt', ORUGAS_CPU_MAX_CALLS_PER_MATCH: '-3' }, { vitePort: 1 });
    expect(config.backend).toBe('off');
    expect(config.maxCallsPerMatch).toBe(DEFAULT_MAX_CALLS_PER_MATCH);
  });
});

describe('describeConfig and buildCpuTurnDeps', () => {
  it('never leaks the key and reports presence only', () => {
    const config = readSidecarConfig({ ANTHROPIC_API_KEY: 'sk-ant-secret', ORUGAS_CPU_BACKEND: 'api' }, { vitePort: 5174 });
    const text = describeConfig(config);
    expect(text).not.toContain('secret');
    expect(text).toContain('key=present');
    expect(text).toContain('backend=api');
  });

  it('builds deps with a budget of the configured size', () => {
    const config = readSidecarConfig({ ORUGAS_CPU_MAX_CALLS_PER_MATCH: '3' }, { vitePort: 5174 });
    const deps = buildCpuTurnDeps(config, () => undefined);
    expect(deps.budget.maxCallsPerMatch).toBe(3);
    expect(deps.backend).toBe('off');
  });
});
