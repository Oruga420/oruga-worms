import { expect, test } from '@playwright/test';

/**
 * Production smoke against the deployed static site. It deliberately does NOT use window.__orugas:
 * that hook is dev only (import.meta.env.DEV), so its absence in production is correct, not a bug.
 * Instead it checks the signals a real visitor depends on: the boot line, a canvas that actually
 * paints, no page errors and no CSP violations.
 */
const LIVE = process.env['LIVE_URL'] ?? 'https://oruga-worms.vercel.app';

let unreachable = '';

test.beforeAll(async () => {
  // Skip rather than fail when offline or the deployment is down, mirroring the local smoke.
  try {
    const response = await fetch(LIVE, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) unreachable = `${LIVE} answered ${response.status}`;
  } catch (error: unknown) {
    unreachable = `${LIVE} unreachable: ${error instanceof Error ? error.message : String(error)}`;
  }
});

test('the deployed game boots and paints', async ({ page }) => {
  test.skip(unreachable !== '', unreachable);

  const errors: string[] = [];
  const csp: string[] = [];
  const logs: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    logs.push(m.text());
    if (/content security policy/i.test(m.text())) csp.push(m.text());
  });

  await page.goto(LIVE, { waitUntil: 'load' });
  await expect(page.locator('canvas#world')).toHaveCount(1);
  await expect.poll(() => logs.some((l) => l.includes('Orugas boot')), { timeout: 15000 }).toBe(true);

  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2500);

  // Exercise the real inventory UI after entering the match, without dev-only hooks.
  await page.keyboard.press('Tab');
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'test-results/live-inventory.png' });
  await page.keyboard.press('Tab');

  // The world canvas must actually be painting, not a blank rectangle.
  const distinct = await page.evaluate(() => {
    const canvas = document.getElementById('world') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return 0;
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const seen = new Set<number>();
    for (let i = 0; i + 2 < data.length; i += 4 * 997) {
      seen.add(((data[i] ?? 0) << 16) | ((data[i + 1] ?? 0) << 8) | (data[i + 2] ?? 0));
    }
    return seen.size;
  });
  console.log(`colores distintos en el canvas: ${distinct}`);
  expect(distinct).toBeGreaterThan(20);

  await page.screenshot({ path: 'test-results/live.png' });
  expect(errors).toEqual([]);
  expect(csp).toEqual([]);
});
