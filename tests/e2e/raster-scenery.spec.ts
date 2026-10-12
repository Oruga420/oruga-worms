import { test, expect, type Page } from '@playwright/test';

const BASE = process.env.ORUGAS_E2E_URL ?? 'http://127.0.0.1:4319';
const MAPS = ['spaceship', 'castle', 'kame_house'] as const;

/** Use the actual wheel/pan controls so the screenshot includes the map asset, not only its spawn beach. */
async function overview(page: Page, scenario: string): Promise<void> {
  const frame = await page.evaluate(() => window.__orugas?.frames() ?? 0);
  await page.mouse.wheel(0, 120);
  await page.mouse.wheel(0, 120);
  await page.waitForFunction((previous) => (window.__orugas?.frames() ?? 0) > previous + 3, frame);
  const target = scenario === 'kame_house' ? 1120 : 960;
  for (let i = 0; i < 2; i += 1) {
    const current = await page.evaluate(() => window.__orugas?.cameraDebug().camX ?? 960);
    const dx = Math.max(-850, Math.min(850, (current - target) * 2));
    await page.mouse.move(1024, 550);
    await page.mouse.down();
    await page.mouse.move(1024 + dx, 550, { steps: 12 });
    await page.mouse.up();
  }
}

test.describe('real rendered Meshy terrain', () => {
  for (const scenario of MAPS) {
    test(`${scenario}: decoded art, crater and restart`, async ({ page }, testInfo) => {
      const errors: string[] = [];
      await page.setViewportSize({ width: 2048, height: 1280 });
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`${BASE}/?map=${scenario}&gl=0&seed=19`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__orugas?.rasterized() === true);
      await page.keyboard.press('Enter');
      await expect.poll(() => page.evaluate(() => window.__orugas?.appPhase())).toBe('setup');
      await page.keyboard.press('Enter');
      await expect.poll(() => page.evaluate(() => window.__orugas?.appPhase())).toBe('playing');
      await overview(page, scenario);
      await page.screenshot({ path: testInfo.outputPath(`${scenario}-before.png`) });
      const before = await page.evaluate(() => window.__orugas?.solidCount() ?? 0);
      await page.evaluate(() => window.__orugas?.fireBazooka(-80, 0.22));
      await expect.poll(() => page.evaluate(() => window.__orugas?.solidCount() ?? 0), { timeout: 12000 }).toBeLessThan(before);
      await overview(page, scenario);
      await page.screenshot({ path: testInfo.outputPath(`${scenario}-after.png`) });
      expect(await page.evaluate(() => window.__orugas?.rasterized())).toBe(true);

      // Supplemental real-browser compositing check at a known pixel in the ART,
      // not just a shot into the ground. This uses real Canvas2D tile surfaces.
      const alpha = await page.evaluate(async (id) => {
        const terrainUrl = '/src/terrain/terrain.ts';
        const contextUrl = '/src/terrain/context.ts';
        const assetsUrl = '/src/game/scenery-assets.ts';
        const { createScenario, carve } = await import(terrainUrl) as typeof import('../../src/terrain/terrain.ts');
        const { createDomContextFactory } = await import(contextUrl) as typeof import('../../src/terrain/context.ts');
        const { loadSceneryAssets } = await import(assetsUrl) as typeof import('../../src/game/scenery-assets.ts');
        const factory = createDomContextFactory(document);
        if (factory === null) throw new Error('Canvas unavailable');
        const result = createScenario(id, { width: 1920, height: 696, seed: 19, sceneryAssets: await loadSceneryAssets() }, factory);
        if (!result.ok) throw new Error(result.error.message);
        const terrain = result.value.terrain;
        const point = id === 'spaceship' ? { x: 960, y: 360 } : id === 'castle' ? { x: 960, y: 250 } : { x: 1120, y: 450 };
        const tile = terrain.tiles.tiles.find((candidate) => point.x >= candidate.x && point.x < candidate.x + candidate.w && point.y >= candidate.y && point.y < candidate.y + candidate.h);
        if (tile === undefined) throw new Error('Tile missing');
        const ctx = tile.ctx as CanvasRenderingContext2D;
        const sample = () => ctx.getImageData((point.x - tile.x) * terrain.tiles.scale, (point.y - tile.y) * terrain.tiles.scale, 1, 1).data[3];
        const solidBefore = terrain.mask.data[point.y * terrain.width + point.x];
        const alphaBefore = sample();
        carve(terrain, point.x, point.y, 20);
        return { solidBefore, alphaBefore, alphaAfter: sample(), solidAfter: terrain.mask.data[point.y * terrain.width + point.x] };
      }, scenario);
      expect(alpha).toEqual({ solidBefore: 1, alphaBefore: 255, alphaAfter: 0, solidAfter: 0 });

      await page.evaluate(() => window.__orugas?.forceWin());
      await expect.poll(() => page.evaluate(() => window.__orugas?.phase())).toBe('MatchEnd');
      await page.keyboard.press('r');
      await expect.poll(() => page.evaluate(() => window.__orugas?.solidCount())).toBe(before);
      expect(await page.evaluate(() => window.__orugas?.rasterized())).toBe(true);
      expect(await page.evaluate(() => window.__orugas?.scenario())).toBe(scenario);
      expect(errors).toEqual([]);
    });
  }
});
