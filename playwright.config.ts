/**
 * Playwright config for the smoke tests under tests/e2e. The spec boots the Vite dev server
 * itself on VITE_PORT (and skips gracefully when it cannot), so no webServer block here.
 * @playwright/test is pinned to 1.62.1 because chromium-1234 is already in the browser cache.
 */

import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    headless: true,
    viewport: { width: 1280, height: 720 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
