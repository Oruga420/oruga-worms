import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const eslint = new ESLint({ cwd: ROOT });

const DIRECT_CALL = [
  'export function probe(ctx: CanvasRenderingContext2D): ImageData {',
  '  return ctx.getImageData(0, 0, 1, 1);',
  '}',
  '',
].join('\n');

const COMPUTED_ACCESS = [
  'export function probe(ctx: CanvasRenderingContext2D): ImageData {',
  "  return ctx['getImageData'](0, 0, 1, 1);",
  '}',
  '',
].join('\n');

const MASK_READ = ['export function solid(mask: Uint8Array, i: number): boolean {', '  return mask[i] === 1;', '}', ''].join('\n');

async function restricted(code: string, relativeFile: string): Promise<string[]> {
  const results = await eslint.lintText(code, { filePath: join(ROOT, relativeFile) });
  return (results[0]?.messages ?? []).filter((m) => m.ruleId === 'no-restricted-syntax').map((m) => m.message);
}

/**
 * The first lintText call boots ESLint with the project's full config, which on this machine costs
 * well over the suite's per test budget while the later calls reuse the instance and are quick.
 * The generous ceiling is for that startup only; the assertions below are untouched.
 */
describe('eslint rule: no getImageData under src/sim and src/terrain', { timeout: 120_000 }, () => {
  it('fires on a direct call under src/sim', async () => {
    const messages = await restricted(DIRECT_CALL, 'src/sim/collision.ts');
    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0]).toContain('getImageData is banned');
  });

  it('fires on a direct call under src/terrain', async () => {
    expect(await restricted(DIRECT_CALL, 'src/terrain/queries.ts')).not.toEqual([]);
  });

  it('fires on computed access too', async () => {
    expect(await restricted(COMPUTED_ACCESS, 'src/sim/worm-controller.ts')).not.toEqual([]);
  });

  it('does not fire in the one allowed readback, src/terrain/png-level.ts', async () => {
    expect(await restricted(DIRECT_CALL, 'src/terrain/png-level.ts')).toEqual([]);
  });

  it('does not fire outside the hot paths', async () => {
    expect(await restricted(DIRECT_CALL, 'src/engine/tint.ts')).toEqual([]);
  });

  it('lets mask reads through', async () => {
    expect(await restricted(MASK_READ, 'src/sim/collision.ts')).toEqual([]);
  });
});
