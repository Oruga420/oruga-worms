import { expect, test, type Page } from '@playwright/test';

const BASE = process.env.UPGRADE_URL ?? 'http://127.0.0.1:4319';
interface Status { id: string; hp: number; alive: boolean; frozenTurns: number; shieldDurability: number; immortalityCharges: number }
interface Cell { id: string; x: number; y: number; w: number; h: number }

async function statuses(page: Page): Promise<Status[]> {
  return page.evaluate('window.__orugas.powerStatus()') as Promise<Status[]>;
}

async function start(page: Page, device = 'desktop'): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${BASE}/?gl=0&seed=19&device=${device}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__orugas), undefined, { timeout: 45000 });
  await expect.poll(() => page.evaluate('window.__orugas.authoredPowerClips().length')).toBe(5);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__orugas?.appPhase() === 'setup');
  const cells = await page.evaluate('window.__orugas.teamSetupCells()') as Cell[];
  const cpu = cells.find((cell) => cell.id === 'team:1:controller');
  if (!cpu) throw new Error('Missing second-team controller control');
  await page.mouse.click(cpu.x + cpu.w / 2, cpu.y + cpu.h / 2);
  await expect.poll(() => page.evaluate('window.__orugas.teamControllers()')).toEqual(['human', 'cpu']); // Boot roster stays immutable until Start.
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__orugas?.appPhase() === 'playing' && window.__orugas.phase() === 'Active');
  expect(await page.evaluate('window.__orugas.teamControllers()')).toEqual(['human', 'human']);
  return errors;
}

async function unlock(page: Page, weapon: string): Promise<string> {
  const caster = await page.evaluate('window.__orugas.skipTurns(12)') as string;
  await page.evaluate((id) => window.__orugas?.selectWeapon(id), weapon);
  await expect.poll(() => page.evaluate('window.__orugas.selectedWeapon()')).toBe(weapon);
  return caster;
}

async function releaseFire(page: Page): Promise<void> {
  await page.keyboard.down('Space');
  await page.waitForTimeout(80);
  await page.keyboard.up('Space');
}

test('loads real ManimGX clips and raises the force field through player controls', async ({ page }, info) => {
  const errors = await start(page);
  const caster = await unlock(page, 'force_field');
  await releaseFire(page);
  await expect.poll(async () => (await statuses(page)).find((worm) => worm.id === caster)?.shieldDurability).toBe(100);
  await page.screenshot({ path: info.outputPath('force-field.png') });
  expect(errors).toEqual([]);
});

test('global freeze includes allies but excludes the caster', async ({ page }, info) => {
  const errors = await start(page);
  const caster = await unlock(page, 'time_stop');
  const living = (await statuses(page)).filter((worm) => worm.alive).length;
  await releaseFire(page);
  await expect.poll(async () => (await statuses(page)).filter((worm) => worm.frozenTurns === 1).length).toBe(living - 1);
  expect((await statuses(page)).find((worm) => worm.id === caster)?.frozenTurns).toBe(0);
  await page.screenshot({ path: info.outputPath('time-stop.png') });
  expect(errors).toEqual([]);
});

test('ROOM reaches its 99 percent setting using the aim controls and charges the caster', async ({ page }, info) => {
  const errors = await start(page);
  const caster = await unlock(page, 'room');
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(1600);
  await page.keyboard.up('ArrowUp');
  await page.screenshot({ path: info.outputPath('room-preview.png') });
  await releaseFire(page);
  await expect.poll(async () => (await statuses(page)).find((worm) => worm.id === caster)?.hp).toBe(1);
  expect((await statuses(page)).find((worm) => worm.id === caster)?.alive).toBe(true);
  expect(errors).toEqual([]);
});

test('claws execute a nearby visible target without killing their caster', async ({ page }, info) => {
  const errors = await start(page);
  const caster = await unlock(page, 'adamantium_claws');
  const target = await page.evaluate('window.__orugas.lineUpEnemy(26)') as string | null;
  expect(target).not.toBeNull();
  await page.waitForTimeout(250);
  const aimError = await page.evaluate((id) => window.__orugas?.aimOffBy(id), target ?? '') ?? 0;
  if (Math.abs(aimError) > 2) {
    const key = aimError > 0 ? 'ArrowDown' : 'ArrowUp';
    await page.keyboard.down(key);
    try {
      await page.waitForFunction((id) => Math.abs(window.__orugas?.aimOffBy(id) ?? 999) < 2, target ?? '', { polling: 'raf', timeout: 5000 });
    } finally { await page.keyboard.up(key); }
  }
  await releaseFire(page);
  await expect.poll(async () => (await statuses(page)).find((worm) => worm.id === target)?.alive).toBe(false);
  await page.screenshot({ path: info.outputPath('claw-finisher.png') });
  expect((await statuses(page)).find((worm) => worm.id === caster)?.alive).toBe(true);
  expect(errors).toEqual([]);
});

test('the unique immortality pickup grants three charges and resets with a new match', async ({ page }) => {
  const errors = await start(page);
  const caster = await page.evaluate('window.__orugas.inventory().activeId') as string;
  await page.evaluate('window.__orugas.dropCrate("immortality", 0)');
  await expect.poll(async () => (await statuses(page)).find((worm) => worm.id === caster)?.immortalityCharges, { timeout: 20000 }).toBe(3);
  await page.evaluate('window.__orugas.forceWin()');
  await page.waitForFunction(() => window.__orugas?.phase() === 'MatchEnd');
  await page.keyboard.press('r');
  await page.waitForFunction(() => window.__orugas?.phase() !== 'MatchEnd');
  expect((await statuses(page)).every((worm) => worm.immortalityCharges === 0)).toBe(true);
  expect(errors).toEqual([]);
});

test('mobile title, touch controls and end screen remain on screen', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = await start(page, 'touch');
  expect(await page.evaluate('window.__orugas.deviceMode()')).toBe('touch');
  await page.screenshot({ path: info.outputPath('mobile-game.png') });
  await page.evaluate('window.__orugas.forceWin()');
  await page.waitForFunction(() => window.__orugas?.phase() === 'MatchEnd');
  await page.screenshot({ path: info.outputPath('mobile-end.png') });
  expect(errors).toEqual([]);
});
