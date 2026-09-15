/**
 * Playwright smoke (ultraplan.html Phase 0.2): boot the Vite dev server on VITE_PORT, open the
 * page, assert both canvases exist, the console printed "Orugas boot", the frame counter
 * advances, no page errors and no CSP violations, and the /api routes answer as designed.
 * Skips gracefully when the dev server cannot start.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { loadDotEnv, mergeEnv, readPort } from '../../sidecar/env.ts';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const VITE_BIN = resolve(ROOT, 'node_modules/vite/bin/vite.js');
const START_TIMEOUT_MS = 30_000;

let child: ChildProcess | null = null;
let baseUrl = '';
let skipReason = '';

async function isServing(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

test.beforeAll(async () => {
  const env = mergeEnv(loadDotEnv(resolve(ROOT, '.env')), process.env);
  const port = readPort(env, 'VITE_PORT');
  if (!port.ok) {
    skipReason = port.error;
    return;
  }
  baseUrl = `http://127.0.0.1:${port.value}`;
  if (await isServing(`${baseUrl}/`)) return;

  let stderr = '';
  child = spawn(process.execPath, [VITE_BIN, '--port', String(port.value), '--strictPort', '--host', '127.0.0.1'], {
    cwd: ROOT,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    if (await isServing(`${baseUrl}/`)) return;
    await sleep(250);
  }
  skipReason = `dev server did not start on ${baseUrl}${stderr.trim() === '' ? '' : `: ${stderr.trim().slice(0, 300)}`}`;
  child.kill();
  child = null;
});

test.afterAll(() => {
  child?.kill();
});

/**
 * Waits for the dev hook after a navigation. The first client after the dev server rebuilds its
 * module graph gets one full reload right after load; while that reload is in flight an evaluate
 * throws "execution context was destroyed", which is reported as 'reloading' so the poll simply
 * keeps waiting instead of failing the test on a dev server artefact.
 */
async function waitForHook(page: import('@playwright/test').Page): Promise<void> {
  await expect
    .poll(
      async () => {
        try {
          return await page.evaluate(() => typeof window.__orugas);
        } catch {
          return 'reloading';
        }
      },
      { timeout: 10000, intervals: [200, 400, 800] },
    )
    .toBe('object');
}

/**
 * Title, then the team setup card, then the match: one Enter leaves the title and a second one
 * accepts the default teams (Reds human against Blues CPU) and starts.
 */
async function startGame(page: import('@playwright/test').Page): Promise<void> {
  await page.keyboard.press('Enter');
  await page.waitForTimeout(120);
  await page.keyboard.press('Enter');
}

/**
 * The widest test in the suite and it keeps growing: title to team setup to match, the CSP and
 * health checks, all 26 panel weapons fired, crates, drowning, sudden death, a CPU turn, the
 * camera ride and the restart. It sat just under Playwright's 60 s default and now runs past it,
 * so it gets a budget of its own rather than being trimmed.
 */
test('boots, draws the canvases and logs Orugas boot', async ({ page }) => {
  test.setTimeout(180_000);
  test.skip(skipReason !== '', skipReason);

  const logs: string[] = [];
  const errors: string[] = [];
  page.on('console', (message) => logs.push(`${message.type()}: ${message.text()}`));
  page.on('pageerror', (error) => errors.push(error.message));

  // Statuses of the browser's own CPU turn calls, so we can tell whether a backend actually
  // served the CPU turn or the controller fell back to its heuristic floor.
  const cpuPosts: number[] = [];
  page.on('response', (response) => {
    if (response.request().method() === 'POST' && response.url().includes('/api/cpu-turn')) cpuPosts.push(response.status());
  });

  // Pinned island: this test drives gameplay (walk, fire, crates), so it runs on one known map and
  // its assertions never depend on the roll. Islands are random per game; randomness and pinning
  // have their own test below. (The pin also caught a real sim bug: on 3 of 10 seeds the first
  // worm froze on a ridge crest, backlog 4.5, fixed in run #39.)
  await page.goto(`${baseUrl}/?seed=1`, { waitUntil: 'load' });
  // The first client after the dev server rebuilds its module graph can get one full reload right
  // after load; wait for the dev hook to exist before reading anything from the page.
  await waitForHook(page);
  await expect(page.locator('canvas#world')).toHaveCount(1);
  await expect(page.locator('canvas#hud')).toHaveCount(1);
  await expect.poll(() => logs.some((line) => line.includes('Orugas boot'))).toBe(true);

  const first = await page.evaluate(() => window.__orugas?.frames() ?? -1);
  await page.waitForTimeout(300);
  const later = await page.evaluate(() => window.__orugas?.frames() ?? -1);
  expect(first).toBeGreaterThanOrEqual(0);
  expect(later).toBeGreaterThan(first);

  expect(errors).toEqual([]);
  expect(logs.filter((line) => /content security policy/i.test(line))).toEqual([]);

  const health = await page.request.get(`${baseUrl}/api/cpu-turn/health`);
  expect(health.status()).toBe(200);
  const healthBody = (await health.json()) as { ok: boolean; backend: string };
  expect(healthBody.ok).toBe(true);
  expect(['api', 'cli', 'off']).toContain(healthBody.backend);

  // The generated audio ships in the served build and boot fetches it from /audio/manifest.json.
  const manifest = await page.request.get(`${baseUrl}/audio/manifest.json`);
  expect(manifest.status()).toBe(200);
  const manifestBody = (await manifest.json()) as { assets?: readonly { id: string; status: string }[] };
  expect(Array.isArray(manifestBody.assets)).toBe(true);
  expect((manifestBody.assets ?? []).some((entry) => entry.status === 'ok')).toBe(true);

  // Without an allowlisted Origin the turn route refuses before reading the body (security requirements).
  const foreign = await page.request.post(`${baseUrl}/api/cpu-turn`, { data: { schema: 'cpu-turn/2' }, headers: { origin: 'http://evil.example' } });
  expect(foreign.status()).toBe(403);

  // With the page origin a malformed body is rejected before any backend runs: 400 with an active backend, 503 fallback without one.
  const turn = await page.request.post(`${baseUrl}/api/cpu-turn`, { data: { schema: 'cpu-turn/2' }, headers: { origin: baseUrl } });
  expect([400, 503]).toContain(turn.status());
  const turnBody = (await turn.json()) as { error?: string; fallback?: boolean };
  expect(turnBody.error !== undefined || turnBody.fallback === true).toBe(true);

  // The match opens on a title screen; capture it, then start with Enter (also unlocks audio).
  await page.waitForTimeout(200);
  await page.screenshot({ path: resolve(ROOT, 'test-results/orugas-title.png') });
  await startGame(page);

  // First playable: wait until the match reaches the Active phase (the sim steps there) and the terrain has land.
  await expect
    .poll(() => page.evaluate(() => window.__orugas?.phase() ?? ''), { timeout: 8000 })
    .toBe('Active');
  const solidBefore = await page.evaluate(() => window.__orugas?.solidCount() ?? 0);
  expect(solidBefore).toBeGreaterThan(0);
  // Islands are random per game: print the seed so any failure below can be brought back with ?seed=N.
  console.log(`island seed ${await page.evaluate(() => window.__orugas?.seed() ?? -1)}`);

  // Weapon panel: Shift+Q opens it, a click on the grenade cell selects it and closes the panel.
  // The pointer origin is the stage element, so the cell rect is offset by its page position.
  expect(await page.evaluate(() => window.__orugas?.selectedWeapon() ?? '')).toBe('bazooka');
  await page.keyboard.press('Shift+KeyQ');
  await expect.poll(() => page.evaluate(() => window.__orugas?.panelOpen() ?? false), { timeout: 2000 }).toBe(true);
  const stage = await page.locator('#stage').boundingBox();
  if (stage === null) throw new Error('stage element has no bounding box');
  const cells = await page.evaluate(() => window.__orugas?.panelCells() ?? []);
  expect(cells.map((cell) => cell.id)).toContain('sonic_blast');
  const grenade = cells.find((cell) => cell.id === 'grenade');
  if (grenade === undefined) throw new Error('grenade cell missing from the panel');
  expect(grenade.enabled).toBe(true);
  await page.mouse.click(stage.x + grenade.x + grenade.w / 2, stage.y + grenade.y + grenade.h / 2);
  await expect.poll(() => page.evaluate(() => window.__orugas?.selectedWeapon() ?? ''), { timeout: 2000 }).toBe('grenade');
  expect(await page.evaluate(() => window.__orugas?.panelOpen() ?? true)).toBe(false);

  // Movement budget: a fresh turn has every step, and walking spends them. Only real displacement
  // is billed, so a worm spawned against a wall spends nothing walking into it: try right, and if
  // that did not move the worm, left. A surface spawn is never boxed in on both sides.
  expect(await page.evaluate(() => window.__orugas?.stepsRemaining() ?? -1)).toBe(10);
  const walk = async (code: 'ArrowRight' | 'ArrowLeft'): Promise<number> => {
    await page.keyboard.down(code);
    await page.waitForTimeout(1200);
    await page.keyboard.up(code);
    return page.evaluate(() => window.__orugas?.stepsRemaining() ?? -1);
  };
  let stepsAfterWalk = await walk('ArrowRight');
  if (stepsAfterWalk === 10) stepsAfterWalk = await walk('ArrowLeft');
  expect(stepsAfterWalk).toBeGreaterThanOrEqual(0);
  expect(stepsAfterWalk).toBeLessThan(10);

  // Visual evidence of the render (gitignored under test-results): the worms on the island.
  await page.waitForTimeout(400);
  await page.locator('canvas#world').screenshot({ path: resolve(ROOT, 'test-results/orugas-active.png') });

  // Fire a bazooka through the debug hook and let the shell detonate; the crater drops the solid count.
  await page.evaluate(() => window.__orugas?.fireBazooka());
  await expect
    .poll(async () => page.evaluate(() => window.__orugas?.solidCount() ?? 0), { timeout: 10000 })
    .toBeLessThan(solidBefore);

  await page.locator('canvas#world').screenshot({ path: resolve(ROOT, 'test-results/orugas-shot.png') });

  // The camera rides a fired shot so the player sees the impact, then hands back to the worm.
  // Wait for the human's turn to come round again: the shot above ended the previous one, and
  // firing into the wrong phase leaves no shell to follow.
  await expect
    .poll(() => page.evaluate(() => `${window.__orugas?.phase() ?? ''}:${window.__orugas?.activeController() ?? ''}`), { timeout: 30000 })
    .toBe('Active:human');
  // Sampling runs INSIDE the page, one round trip for the whole flight. Sampling from the test
  // meant a waitForTimeout plus an evaluate per sample, and on a loaded machine those round trips
  // stretched the window past the shell's flight, so the ride was missed and the test failed on a
  // camera that had worked (three times, run #44).
  const flight = await page.evaluate(async () => {
    const api = window.__orugas;
    if (api === undefined) return [] as { d: number; focus: string }[];
    api.fireBazooka(38, 1);
    const out: { d: number; focus: string }[] = [];
    const started = performance.now();
    while (performance.now() - started < 2000) {
      await new Promise((done) => requestAnimationFrame(() => done(null)));
      const s = api.cameraDebug();
      const d = s.projX === null || s.projY === null ? -1 : Math.hypot(s.projX - s.camX, s.projY - s.camY);
      out.push({ d, focus: s.focus });
    }
    return out;
  });
  expect(flight.some((f) => f.focus === 'projectile')).toBe(true);
  const framed = flight.filter((f) => f.d >= 0);
  expect(framed.length).toBeGreaterThan(0);
  // Half the viewport is about 320 world px at this zoom, so the shell must stay well inside it.
  expect(Math.max(...framed.map((f) => f.d))).toBeLessThan(260);
  await expect
    .poll(() => page.evaluate(() => window.__orugas?.cameraDebug().focus ?? ''), { timeout: 8000 })
    .toBe('worm');

  // Enable the frame time overlay (F3) and capture it as evidence it renders.
  await page.keyboard.press('F3');
  await page.waitForTimeout(700);
  await page.screenshot({ path: resolve(ROOT, 'test-results/orugas-overlay.png') });

  // Crates: a dropped crate exists in the world and parachutes in.
  const cratesBefore = await page.evaluate(() => window.__orugas?.crateCount() ?? 0);
  await page.evaluate(() => window.__orugas?.dropCrate());
  await expect
    .poll(() => page.evaluate(() => window.__orugas?.crateCount() ?? 0), { timeout: 5000 })
    .toBeGreaterThan(cratesBefore);

  // Drowning: sink a non-active worm and watch the match ledger lose it.
  const aliveBefore = await page.evaluate(() => window.__orugas?.aliveCount() ?? 0);
  expect(await page.evaluate(() => window.__orugas?.drownOne() ?? false)).toBe(true);
  await expect
    .poll(() => page.evaluate(() => window.__orugas?.aliveCount() ?? 0), { timeout: 10000 })
    .toBeLessThan(aliveBefore);

  // Every panel weapon fires in a real browser without throwing: the Goal's 23 slots plus the
  // tank cannon, napalm gun and sonic blast gun.
  const fired = await page.evaluate(() => window.__orugas?.fireAll() ?? []);
  expect(fired).toHaveLength(26);
  expect(fired.filter((entry) => !entry.ok)).toEqual([]);
  await page.waitForTimeout(500);

  // Drive the match to a real end (surrender every other team), capture the victory screen, restart.
  await page.evaluate(() => window.__orugas?.forceWin());
  await expect.poll(() => page.evaluate(() => window.__orugas?.phase() ?? ''), { timeout: 8000 }).toBe('MatchEnd');
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(ROOT, 'test-results/orugas-victory.png') });

  await page.keyboard.press('r');
  // Waiting for Active proves the restart left MatchEnd, and the clock jump below only ends the
  // turn (the path into the SuddenDeathCheck) when it lands in Active, not during a banner phase.
  await expect.poll(() => page.evaluate(() => window.__orugas?.phase() ?? ''), { timeout: 10000 }).toBe('Active');

  // Fall damage, and the design rule that the first landing after a blast is free. Dropping the
  // same way with the flag off and on isolates the exemption from any blast damage.
  const faller = await page.evaluate(() => window.__orugas?.dropWorm(false) ?? null);
  expect(faller).not.toBeNull();
  const hpBeforeFall = await page.evaluate((id: string) => window.__orugas?.wormHp(id) ?? -1, faller as string);
  await expect
    .poll(() => page.evaluate((id: string) => window.__orugas?.wormHp(id) ?? -1, faller as string), { timeout: 10000 })
    .toBeLessThan(hpBeforeFall);

  const exempt = await page.evaluate(() => window.__orugas?.dropWorm(true) ?? null);
  expect(exempt).not.toBeNull();
  const hpBeforeExempt = await page.evaluate((id: string) => window.__orugas?.wormHp(id) ?? -1, exempt as string);
  await expect
    .poll(() => page.evaluate((id: string) => window.__orugas?.onGround(id) ?? false, exempt as string), { timeout: 10000 })
    .toBe(true);
  expect(await page.evaluate((id: string) => window.__orugas?.wormHp(id) ?? -1, exempt as string)).toBe(hpBeforeExempt);

  // The CPU plays a real turn in the browser. End the human turn, wait for the CPU to take over,
  // then watch its turn finish well inside the 45 s turn timer: finishing early is the proof it
  // actually decided and fired rather than idling until the timeout.
  expect(await page.evaluate(() => window.__orugas?.activeController() ?? '')).toBe('human');
  await page.evaluate(() => window.__orugas?.endTurn());
  await expect
    .poll(() => page.evaluate(() => window.__orugas?.activeController() ?? ''), { timeout: 15000 })
    .toBe('cpu');
  const cpuTurn = await page.evaluate(() => window.__orugas?.turn() ?? 0);
  await expect
    .poll(() => page.evaluate(() => window.__orugas?.turn() ?? 0), { timeout: 25000 })
    .toBeGreaterThan(cpuTurn);

  // With a backend configured the browser must actually have called the sidecar for that turn.
  // Any status is acceptable: a non-200 means the controller used its heuristic floor, which is
  // the designed fallback, but the call itself proves the client is wired to the sidecar.
  if (healthBody.backend !== 'off') expect(cpuPosts.length).toBeGreaterThan(0);

  // Sudden death, on the fresh match the restart just built (it caps every worm to 1 hp, so it
  // would wreck the checks above if it ran earlier).
  await expect.poll(() => page.evaluate(() => window.__orugas?.phase() ?? ''), { timeout: 15000 }).toBe('Active');
  expect(await page.evaluate(() => window.__orugas?.suddenDeath() ?? true)).toBe(false);
  await page.evaluate(() => window.__orugas?.forceSuddenDeath());
  await expect
    .poll(() => page.evaluate(() => window.__orugas?.suddenDeath() ?? false), { timeout: 10000 })
    .toBe(true);

  expect(errors).toEqual([]);

  // This run was pinned to seed 1 at the top; the game must report exactly that.
  expect(await page.evaluate(() => window.__orugas?.seed() ?? -1)).toBe(1);

  await page.screenshot({ path: resolve(ROOT, 'test-results/orugas-sudden-death.png'), fullPage: true });
});

/**
 * The plan's frame budget check. Headless Chromium at deviceScaleFactor 2 is a proxy for the
 * laptop's HiDPI display, not the laptop itself, so this proves the renderer holds the budget
 * when it is actually pushing 2x pixels, which is the part the DPR policy governs.
 */
test('holds the frame budget at device scale factor 2', async ({ browser }) => {
  test.skip(skipReason !== '', skipReason);

  const context = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  try {
    await page.goto(`${baseUrl}/`, { waitUntil: 'load' });
    await startGame(page);
    await expect
      .poll(() => page.evaluate(() => window.__orugas?.phase() ?? ''), { timeout: 10000 })
      .toBe('Active');

    // Boot is expensive enough to push the rolling average past stepDownAtMs, so the DPR ladder
    // drops a rung to 1.5. Climbing back needs a 10 s continuous calm window by design
    // (DEFAULT_DPR_POLICY.calmWindowMs), so poll for the climb rather than sampling too early.
    // Reaching 2 again is the real assertion: the ladder recovers and holds the budget there.
    await expect
      .poll(() => page.evaluate(() => window.__orugas?.dpr() ?? 0), { timeout: 30000, intervals: [1000] })
      .toBe(2);

    const frameMs = await page.evaluate(() => window.__orugas?.frameMs() ?? 999);
    console.log(`dpr 2 reached, frame ${frameMs.toFixed(2)} ms`);
    expect(frameMs).toBeLessThan(14);
  } finally {
    await context.close();
  }
});

test('pins the island and the spawns with ?seed=N', async ({ page }) => {
  test.skip(skipReason !== '', skipReason);
  // Two loads of the same pinned seed must build the same island (same solid pixel count is the
  // cheap fingerprint) and report the seed back; this is how a bug report brings back one map.
  await page.goto(`${baseUrl}/?seed=123`, { waitUntil: 'load' });
  await expect.poll(() => page.evaluate(() => window.__orugas?.seed() ?? -1), { timeout: 8000 }).toBe(123);
  const firstSolid = await page.evaluate(() => window.__orugas?.solidCount() ?? 0);
  expect(firstSolid).toBeGreaterThan(0);
  await page.goto(`${baseUrl}/?seed=123`, { waitUntil: 'load' });
  await expect.poll(() => page.evaluate(() => window.__orugas?.seed() ?? -1), { timeout: 8000 }).toBe(123);
  expect(await page.evaluate(() => window.__orugas?.solidCount() ?? 0)).toBe(firstSolid);
  // A different pin is a different island.
  await page.goto(`${baseUrl}/?seed=124`, { waitUntil: 'load' });
  await expect.poll(() => page.evaluate(() => window.__orugas?.seed() ?? -1), { timeout: 8000 }).toBe(124);
  expect(await page.evaluate(() => window.__orugas?.solidCount() ?? 0)).not.toBe(firstSolid);
});

test('remembers the audio levels across a reload through localStorage', async ({ page }) => {
  test.skip(skipReason !== '', skipReason);
  await page.goto(`${baseUrl}/?seed=1`, { waitUntil: 'load' });
  await waitForHook(page);
  // A fresh browser context starts from the defaults.
  expect(await page.evaluate(() => window.__orugas?.settings().audio.music ?? -1)).toBe(1);
  expect(await page.evaluate(() => window.__orugas?.setVolume('music', 0.25) ?? false)).toBe(true);
  // An unknown bus is refused and changes nothing.
  expect(await page.evaluate(() => window.__orugas?.setVolume('bass', 0.5) ?? true)).toBe(false);
  await page.reload({ waitUntil: 'load' });
  await waitForHook(page);
  const after = await page.evaluate(() => window.__orugas?.settings().audio ?? null);
  expect(after).toEqual({ master: 1, sfx: 1, voice: 1, music: 0.25, ui: 1 });
});

test('pauses on Escape, holds the clock, resumes, and surrender ends the match', async ({ page }) => {
  test.skip(skipReason !== '', skipReason);
  await page.goto(`${baseUrl}/?seed=1`, { waitUntil: 'load' });
  await waitForHook(page);
  await startGame(page);
  await expect.poll(() => page.evaluate(() => window.__orugas?.phase() ?? ''), { timeout: 8000 }).toBe('Active');

  // Escape pauses: the turn clock holds while the page keeps rendering. (The frame loop's own tick
  // counter keeps going by design; it is the controller that is not ticked.)
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => window.__orugas?.paused() ?? false), { timeout: 2000 }).toBe(true);
  const clockPaused = await page.evaluate(() => window.__orugas?.turnRemainingMs() ?? -1);
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => window.__orugas?.turnRemainingMs() ?? -1)).toBe(clockPaused);

  // Clicking Resume unpauses and the sim ticks again.
  const stage = await page.locator('#stage').boundingBox();
  if (stage === null) throw new Error('stage element has no bounding box');
  const cells = await page.evaluate(() => window.__orugas?.pauseCells() ?? []);
  const resume = cells.find((cell) => cell.id === 'resume');
  const surrender = cells.find((cell) => cell.id === 'surrender');
  if (resume === undefined || surrender === undefined) throw new Error('pause buttons missing');
  await page.mouse.click(stage.x + resume.x + resume.w / 2, stage.y + resume.y + resume.h / 2);
  await expect.poll(() => page.evaluate(() => window.__orugas?.paused() ?? true), { timeout: 2000 }).toBe(false);
  await expect.poll(() => page.evaluate(() => window.__orugas?.turnRemainingMs() ?? Number.MAX_SAFE_INTEGER), { timeout: 2000 }).toBeLessThan(clockPaused);

  // P pauses too; Surrender hands the match to the CPU team and the end screen follows.
  await page.keyboard.press('p');
  await expect.poll(() => page.evaluate(() => window.__orugas?.paused() ?? false), { timeout: 2000 }).toBe(true);
  await page.mouse.click(stage.x + surrender.x + surrender.w / 2, stage.y + surrender.y + surrender.h / 2);
  await expect.poll(() => page.evaluate(() => window.__orugas?.phase() ?? ''), { timeout: 8000 }).toBe('MatchEnd');
  expect(await page.evaluate(() => window.__orugas?.paused() ?? true)).toBe(false);

  // The end screen's scoreboard: the CPU team (Blues) won by surrender and leads the table with
  // its survivors intact; the human team (Reds) is listed second with no worms left standing.
  const rows = await page.evaluate(() => window.__orugas?.scoreboard() ?? []);
  expect(rows.map((row) => row.name)).toEqual(['Blues', 'Reds']);
  expect(rows[0]?.winner).toBe(true);
  expect(rows[0]?.aliveWorms).toBe(3);
  expect(rows[1]?.winner).toBe(false);
  expect(rows[1]?.aliveWorms).toBe(0);
  expect(rows[0]?.points ?? 0).toBeGreaterThan(rows[1]?.points ?? 0);
});

test('mouse: dragging pans the camera without firing, a click fires a targeted weapon where it points', async ({ page }) => {
  test.skip(skipReason !== '', skipReason);
  await page.goto(`${baseUrl}/?seed=1`, { waitUntil: 'load' });
  await waitForHook(page);
  await startGame(page);
  await expect.poll(() => page.evaluate(() => window.__orugas?.phase() ?? ''), { timeout: 10000 }).toBe('Active');
  const stage = await page.locator('#stage').boundingBox();
  if (stage === null) throw new Error('stage element has no bounding box');
  const cx = stage.x + stage.width / 2;
  const cy = stage.y + stage.height / 2;

  // Drag 200 px to the left: the camera moves the other way and the turn is untouched.
  const before = await page.evaluate(() => window.__orugas?.cameraDebug());
  if (before === undefined) throw new Error('no camera debug');
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 10; i += 1) {
    await page.mouse.move(cx - i * 20, cy);
    await page.waitForTimeout(30);
  }
  await page.mouse.up();
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => window.__orugas?.cameraDebug());
  if (after === undefined) throw new Error('no camera debug');
  expect(after.camX).toBeGreaterThan(before.camX + 40);
  expect(await page.evaluate(() => window.__orugas?.phase() ?? '')).toBe('Active');

  // A plain click with a targeted weapon selected fires it where it points. The teleport is the
  // one available on turn 1 (the air strike sits behind a five turn scheme delay, and the
  // controller rightly refuses it). After the 200 px drag the worm sits about 200 screen px left
  // of centre, so this click lands in the air just above and beside it: a legal destination.
  await page.evaluate(() => window.__orugas?.selectWeapon('teleport'));
  expect(await page.evaluate(() => window.__orugas?.selectedWeapon() ?? '')).toBe('teleport');
  await page.mouse.click(cx - 140, cy - 200);
  await expect.poll(() => page.evaluate(() => window.__orugas?.phase() ?? ''), { timeout: 4000 }).not.toBe('Active');
});

test('team setup: the weapon art ships, and switching Blues to human starts a two human match', async ({ page }) => {
  test.skip(skipReason !== '', skipReason);
  await page.goto(`${baseUrl}/?seed=1`, { waitUntil: 'load' });
  await waitForHook(page);

  // The generated weapon atlas is served and carries an icon for every panel weapon.
  await expect.poll(() => page.evaluate(() => window.__orugas?.weaponFrames() ?? 0), { timeout: 8000 }).toBe(26);

  // Title to the team setup card.
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.__orugas?.appPhase() ?? ''), { timeout: 4000 }).toBe('setup');
  const stage = await page.locator('#stage').boundingBox();
  if (stage === null) throw new Error('stage element has no bounding box');
  const cells = await page.evaluate(() => window.__orugas?.teamSetupCells() ?? []);
  const controllerCell = cells.find((c) => c.id === 'team:1:controller');
  const startCell = cells.find((c) => c.id === 'start');
  if (controllerCell === undefined || startCell === undefined) throw new Error('team setup cells missing');

  // Blues from CPU to human, then Start: the match runs with two human teams (hot seat).
  await page.mouse.click(stage.x + controllerCell.x + controllerCell.w / 2, stage.y + controllerCell.y + controllerCell.h / 2);
  await expect.poll(() => page.evaluate(() => window.__orugas?.teamSetupCells().some((cell) => cell.id === 'team:1:difficulty'))).toBe(false);
  await page.mouse.click(stage.x + startCell.x + startCell.w / 2, stage.y + startCell.y + startCell.h / 2);
  await expect.poll(() => page.evaluate(() => window.__orugas?.appPhase() ?? ''), { timeout: 8000 }).toBe('playing');
  expect(await page.evaluate(() => window.__orugas?.teamControllers() ?? [])).toEqual(['human', 'human']);
});

test('options from the pause overlay: a volume step and a key rebind survive a reload', async ({ page }) => {
  test.skip(skipReason !== '', skipReason);
  await page.goto(`${baseUrl}/?seed=1`, { waitUntil: 'load' });
  await waitForHook(page);
  await startGame(page);
  await expect.poll(() => page.evaluate(() => window.__orugas?.phase() ?? ''), { timeout: 8000 }).toBe('Active');
  const stage = await page.locator('#stage').boundingBox();
  if (stage === null) throw new Error('stage element has no bounding box');
  const click = async (cell: { x: number; y: number; w: number; h: number }): Promise<void> => {
    await page.mouse.click(stage.x + cell.x + cell.w / 2, stage.y + cell.y + cell.h / 2);
  };
  const cellById = async (getter: 'pauseCells' | 'optionsCells', id: string) => {
    await expect.poll(() => page.evaluate(({ name, wanted }) => {
      const cells = name === 'pauseCells' ? window.__orugas?.pauseCells() : window.__orugas?.optionsCells();
      return cells?.some((cell) => cell.id === wanted) ?? false;
    }, { name: getter, wanted: id })).toBe(true);
    const cells = await page.evaluate((name) => (name === 'pauseCells' ? window.__orugas?.pauseCells() : window.__orugas?.optionsCells()) ?? [], getter);
    const cell = cells.find((c) => c.id === id);
    if (cell === undefined) throw new Error(`${getter} has no ${id}`);
    return cell;
  };

  // Pause, open Options.
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => window.__orugas?.paused() ?? false), { timeout: 2000 }).toBe(true);
  await click(await cellById('pauseCells', 'options'));
  await expect.poll(() => page.evaluate(() => window.__orugas?.optionsOpen() ?? false), { timeout: 2000 }).toBe(true);

  // One step down on the music bus: 1.0 to 0.9, applied and saved.
  await click(await cellById('optionsCells', 'vol:music:minus'));
  await expect.poll(() => page.evaluate(() => window.__orugas?.settings().audio.music ?? -1), { timeout: 2000 }).toBeCloseTo(0.9, 5);

  // Rebind fire to F: click the row, press the key. Space is now free and F fires.
  await click(await cellById('optionsCells', 'key:fire'));
  await page.keyboard.press('f');
  await expect.poll(() => page.evaluate(() => window.__orugas?.keybinds().fire.join(',') ?? ''), { timeout: 2000 }).toBe('KeyF');
  // A duplicate is refused: try to give jump the F key too; fire keeps it and jump is unchanged.
  await click(await cellById('optionsCells', 'key:jump'));
  await page.keyboard.press('f');
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.__orugas?.keybinds().jump.join(',') ?? '')).toBe('Enter');
  expect(await page.evaluate(() => window.__orugas?.keybinds().fire.join(',') ?? '')).toBe('KeyF');

  // Back returns to the pause overlay; Escape resumes.
  await click(await cellById('optionsCells', 'back'));
  await expect.poll(() => page.evaluate(() => window.__orugas?.optionsOpen() ?? true), { timeout: 2000 }).toBe(false);
  expect(await page.evaluate(() => window.__orugas?.paused() ?? false)).toBe(true);
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => window.__orugas?.paused() ?? true), { timeout: 2000 }).toBe(false);

  // Both changes come back after a reload.
  await page.reload({ waitUntil: 'load' });
  await waitForHook(page);
  expect(await page.evaluate(() => window.__orugas?.settings().audio.music ?? -1)).toBeCloseTo(0.9, 5);
  expect(await page.evaluate(() => window.__orugas?.keybinds().fire.join(',') ?? '')).toBe('KeyF');
});

test('jetpack from inventory survives a pause after activation and flies with Enter and arrows', async ({ page }) => {
  test.skip(skipReason !== '', skipReason);
  await page.goto(`${baseUrl}/?seed=1`, { waitUntil: 'load' });
  await waitForHook(page);
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.__orugas?.teamSetupCells().length ?? 0)).toBeGreaterThan(0);
  const stage = await page.locator('#stage').boundingBox();
  const setup = await page.evaluate(() => window.__orugas!.teamSetupCells());
  const human = setup.find((cell) => cell.id === 'team:1:controller');
  if (stage === null || human === undefined) throw new Error('Missing team setup');
  await page.mouse.click(stage.x + human.x + human.w / 2, stage.y + human.y + human.h / 2);
  await expect.poll(() => page.evaluate(() => window.__orugas!.teamSetupCells().some((cell) => cell.id === 'team:1:difficulty'))).toBe(false);
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.__orugas!.phase())).toBe('Active');
  // Jetpack unlocks on turn 2; ending turn 1 leaves another human in control.
  const firstTurn = await page.evaluate(() => window.__orugas!.turn());
  await page.evaluate(() => window.__orugas!.endTurn());
  await expect.poll(() => page.evaluate(() => window.__orugas!.turn()), { timeout: 15000 }).toBeGreaterThan(firstTurn);
  await expect.poll(() => page.evaluate(() => window.__orugas!.phase())).toBe('Active');
  await expect.poll(() => page.evaluate(() => window.__orugas!.activeBody()?.onGround)).toBe(true);
  await page.keyboard.press('Tab');
  await expect.poll(() => page.evaluate(() => window.__orugas!.panelOpen())).toBe(true);
  const jetpack = (await page.evaluate(() => window.__orugas!.panelCells())).find((cell) => cell.id === 'jetpack');
  if (jetpack === undefined) throw new Error('Missing jetpack inventory cell');
  expect(jetpack.enabled).toBe(true);
  await page.mouse.click(stage.x + jetpack.x + jetpack.w / 2, stage.y + jetpack.y + jetpack.h / 2);
  await expect.poll(() => page.evaluate(() => window.__orugas!.selectedWeapon())).toBe('jetpack');
  const inventory = await page.evaluate(() => window.__orugas!.inventory());
  const originalAmmo = inventory.worms.find((worm) => worm.id === inventory.activeId)!.ammo.jetpack!;
  await page.keyboard.down('Space');
  await page.waitForTimeout(100);
  await page.keyboard.up('Space');
  await page.waitForTimeout(700);
  const grounded = await page.evaluate(() => window.__orugas!.activeBody());
  expect(grounded?.motion).toBe('jetpacking');
  if (grounded === null) throw new Error('Missing active body');
  await page.keyboard.down('Enter');
  await page.keyboard.down('ArrowRight');
  try {
    await expect.poll(() => page.evaluate(() => window.__orugas!.activeBody()?.y ?? Infinity)).toBeLessThan(grounded.y - 20);
    await expect.poll(() => page.evaluate(() => window.__orugas!.activeBody()?.x ?? -Infinity)).toBeGreaterThan(grounded.x + 10);
    expect(await page.evaluate(() => window.__orugas!.activeBody()?.fuelMs)).toBeLessThan(grounded.fuelMs);
    await page.screenshot({ path: resolve(ROOT, 'test-results/jetpack-flight.png') });
  } finally {
    await page.keyboard.up('Enter');
    await page.keyboard.up('ArrowRight');
  }
  await expect.poll(() => page.evaluate(() => window.__orugas!.activeBody()?.onGround), { timeout: 10000 }).toBe(true);
  const landed = await page.evaluate(() => window.__orugas!.activeBody());
  expect(landed?.motion).toBe('jetpacking');
  if (landed === null) throw new Error('Missing landed body');
  await page.keyboard.down('ArrowUp');
  try {
    await expect.poll(() => page.evaluate(() => window.__orugas!.activeBody()?.y ?? Infinity)).toBeLessThan(landed.y - 20);
    expect(await page.evaluate(() => window.__orugas!.activeBody()?.fuelMs)).toBeLessThan(landed.fuelMs);
  } finally {
    await page.keyboard.up('ArrowUp');
  }
  const after = await page.evaluate(() => window.__orugas!.inventory());
  expect(after.worms.find((worm) => worm.id === inventory.activeId)?.ammo.jetpack).toBe(originalAmmo - 1);
});

test('individual inventories, fuse controls, and the third-turn parachute drop', async ({ page }) => {
  test.skip(skipReason !== '', skipReason);
  await page.goto(`${baseUrl}/?seed=1`, { waitUntil: 'load' });
  await waitForHook(page);
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.__orugas?.teamSetupCells().length ?? 0)).toBeGreaterThan(0);
  const stage = await page.locator('#stage').boundingBox();
  const setupCells = await page.evaluate(() => window.__orugas?.teamSetupCells() ?? []);
  const human = setupCells.find((cell) => cell.id === 'team:1:controller');
  if (stage === null || human === undefined) throw new Error('Missing team setup');
  await page.mouse.click(stage.x + human.x + human.w / 2, stage.y + human.y + human.h / 2);
  await expect.poll(() => page.evaluate(() => window.__orugas?.teamSetupCells().some((cell) => cell.id === 'team:1:difficulty'))).toBe(false);
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.__orugas?.phase())).toBe('Active');
  const before = await page.evaluate(() => window.__orugas!.inventory());
  const original = before.worms.find((worm) => worm.id === before.activeId)!;

  await page.evaluate(() => window.__orugas!.selectWeapon('grenade'));
  await page.keyboard.press('5');
  await expect.poll(() => page.evaluate(() => window.__orugas!.inventory().fuseMs)).toBe(5000);
  await page.evaluate(() => window.__orugas!.selectWeapon('parachute'));
  await page.keyboard.down('Space');
  await page.waitForTimeout(100);
  await page.keyboard.up('Space');
  await expect.poll(() => page.evaluate(() => {
    const state = window.__orugas!.inventory();
    return state.worms.find((worm) => worm.id === state.activeId)?.ammo['parachute'];
  })).toBe(original.ammo['parachute']! - 1);
  const after = await page.evaluate(() => window.__orugas!.inventory());
  expect(after.worms.filter((worm) => worm.id !== before.activeId)).toEqual(before.worms.filter((worm) => worm.id !== before.activeId));

  for (let completed = 1; completed <= 3; completed += 1) {
    await expect.poll(() => page.evaluate(() => window.__orugas!.phase())).toBe('Active');
    const turn = await page.evaluate(() => window.__orugas!.turn());
    await page.evaluate(() => window.__orugas!.endTurn());
    await expect.poll(() => page.evaluate(() => window.__orugas!.turn()), { timeout: 15000 }).toBeGreaterThan(turn);
    if (completed < 3) expect(await page.evaluate(() => window.__orugas!.inventory().drops)).toHaveLength(0);
  }
  await expect.poll(() => page.evaluate(() => window.__orugas!.inventory().drops.length), { timeout: 10000 }).toBe(1);
  const drop = await page.evaluate(() => window.__orugas!.inventory().drops[0]);
  expect(drop?.landed).toBe(false);
  await page.screenshot({ path: resolve(ROOT, 'test-results/third-turn-drop.png') });
  await expect.poll(() => page.evaluate(() => window.__orugas!.inventory().drops[0]?.landed), { timeout: 20000 }).toBe(true);
  await page.keyboard.press('Tab');
  await expect.poll(() => page.evaluate(() => window.__orugas!.panelOpen())).toBe(true);
  await page.screenshot({ path: resolve(ROOT, 'test-results/individual-inventory.png') });
});
