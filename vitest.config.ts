/**
 * Vitest config, separate from vite.config.ts so unit tests never load the dev middleware or
 * need the ports. Unit tests live under tests/unit and mirror src and sidecar; Playwright owns
 * tests/e2e.
 */

import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    // The suite is 90 files and transforming them costs about 15 s per run, which the default 5 s
    // per test budget does not account for: with every worker transforming at once, pure functions
    // like the RNG and the heuristic timed out while nothing was actually broken (measured on an
    // idle machine, run #44: heuristic.test alone passes 10 of 10 in 36 s, 42 percent of it
    // transform). The cache is Vitest's own suggestion for this and the ceiling stays finite.
    fsModuleCache: true,
    testTimeout: 20_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'sidecar/**/*.ts'],
      exclude: ['src/main.ts', 'sidecar/index.ts'],
      reporter: ['text', 'html', 'json-summary'],
      reportsDirectory: 'coverage',
    },
  },
});
