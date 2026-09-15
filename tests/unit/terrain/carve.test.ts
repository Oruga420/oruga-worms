import { describe, expect, it } from 'vitest';
import { carveCircle, carveRect, circleRowRange, circleSpanAtRow } from '@/terrain/carve.ts';
import {
  AIR,
  BEDROCK,
  SOLID,
  cloneMask,
  countSolid,
  countValue,
  createMask,
  get,
  index,
  markBorderBedrock,
  set,
  setSpan,
  type Span,
  type TerrainMask,
} from '@/terrain/mask.ts';

function changedPixels(before: TerrainMask, after: TerrainMask): number[] {
  const out: number[] = [];
  for (let i = 0; i < before.data.length; i += 1) {
    if (before.data[i] !== after.data[i]) out.push(i);
  }
  return out;
}

function spanIndices(mask: TerrainMask, spans: readonly Span[]): Set<number> {
  const out = new Set<number>();
  for (const span of spans) {
    expect(span.y).toBeGreaterThanOrEqual(0);
    expect(span.y).toBeLessThan(mask.height);
    expect(span.x0).toBeGreaterThanOrEqual(0);
    expect(span.x1).toBeLessThan(mask.width);
    expect(span.x0).toBeLessThanOrEqual(span.x1);
    for (let x = span.x0; x <= span.x1; x += 1) out.add(index(mask, x, span.y));
  }
  return out;
}

/** Every pixel that changed is inside a span, and every span pixel is air afterwards and was never bedrock. */
function expectSpansMatchDiff(before: TerrainMask, after: TerrainMask, spans: readonly Span[]): void {
  const covered = spanIndices(after, spans);
  for (const i of changedPixels(before, after)) expect(covered.has(i)).toBe(true);
  for (const i of covered) {
    expect(before.data[i]).not.toBe(BEDROCK);
    expect(after.data[i]).toBe(AIR);
  }
}

describe('carveCircle: the one rounding rule', () => {
  it('uses x0 = ceil(cx - dx), x1 = floor(cx + dx) inclusive, dx = sqrt(r*r - dy*dy)', () => {
    // r = 5 around (10, 10). By hand: dy 0 gives 11 px, dy 1 to 3 give 9 px each (sqrt(24), sqrt(21), 4),
    // dy 4 gives 7 px (dx 3) and dy 5 gives the single pixel at the pole: 11 + 2 * (9 + 9 + 9 + 7 + 1) = 81.
    expect(circleRowRange(10, 10, 5)).toEqual({ y0: 5, y1: 15 });
    expect(circleSpanAtRow(10, 10, 5, 10)).toEqual({ x0: 5, x1: 15 });
    expect(circleSpanAtRow(10, 10, 5, 11)).toEqual({ x0: 6, x1: 14 });
    expect(circleSpanAtRow(10, 10, 5, 13)).toEqual({ x0: 6, x1: 14 });
    expect(circleSpanAtRow(10, 10, 5, 14)).toEqual({ x0: 7, x1: 13 });
    expect(circleSpanAtRow(10, 10, 5, 15)).toEqual({ x0: 10, x1: 10 });
    expect(circleSpanAtRow(10, 10, 5, 16)).toBeNull();
    expect(circleSpanAtRow(10, 10, 5, 4)).toBeNull();

    const mask = createMask(21, 21, SOLID);
    const result = carveCircle(mask, 10, 10, 5);
    expect(result.changed).toBe(81);
    expect(countSolid(mask)).toBe(441 - 81);
    expect(result.spans.length).toBe(11);
  });

  it('carves exactly the pixels with (x - cx)^2 + (y - cy)^2 <= r^2, fractional centers included', () => {
    const circles = [
      { cx: 20, cy: 20, r: 7 },
      { cx: 20.5, cy: 19.5, r: 7.5 },
      { cx: 17.5, cy: 22, r: 10 },
      { cx: 21, cy: 21, r: 1 },
      { cx: 20, cy: 20, r: 0 },
    ];
    for (const { cx, cy, r } of circles) {
      const mask = createMask(41, 41, SOLID);
      carveCircle(mask, cx, cy, r);
      for (let y = 0; y < 41; y += 1) {
        for (let x = 0; x < 41; x += 1) {
          const inside = (x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r;
          expect(get(mask, x, y)).toBe(inside ? AIR : SOLID);
        }
      }
    }
  });

  it('removes an area within the lattice error bound of pi r squared', () => {
    for (const r of [8, 20, 37, 48.5, 60]) {
      const size = Math.ceil(2 * r) + 10;
      const mask = createMask(size, size, SOLID);
      const c = size / 2;
      const { changed } = carveCircle(mask, c, c, r);
      expect(Math.abs(changed - Math.PI * r * r)).toBeLessThanOrEqual(2 * Math.PI * r + 4);
      expect(countSolid(mask)).toBe(size * size - changed);
    }
  });

  it('returns rows in ascending order with one span per bedrock free row', () => {
    const mask = createMask(50, 50, SOLID);
    const { spans } = carveCircle(mask, 25, 25, 10);
    expect(spans.length).toBe(21);
    for (let i = 1; i < spans.length; i += 1) {
      expect(spans[i]?.y).toBe((spans[i - 1]?.y ?? 0) + 1);
    }
  });
});

describe('carveCircle: bedrock, clamping and the two paths', () => {
  it('never carves bedrock and splits the spans around it', () => {
    const mask = createMask(40, 40, SOLID);
    markBorderBedrock(mask);
    for (let y = 10; y <= 30; y += 1) set(mask, 20, y, BEDROCK);
    const before = cloneMask(mask);
    const bedrockBefore = countValue(mask, BEDROCK);

    const result = carveCircle(mask, 20, 20, 8);

    expect(countValue(mask, BEDROCK)).toBe(bedrockBefore);
    for (let y = 10; y <= 30; y += 1) expect(get(mask, 20, y)).toBe(BEDROCK);
    for (const span of result.spans) {
      expect(span.x0 <= 20 && 20 <= span.x1).toBe(false);
    }
    const row20 = result.spans.filter((s) => s.y === 20);
    expect(row20).toEqual([
      { y: 20, x0: 12, x1: 19 },
      { y: 20, x0: 21, x1: 28 },
    ]);
    expectSpansMatchDiff(before, mask, result.spans);
    expect(result.changed).toBe(countSolid(before) - countSolid(mask));
  });

  it('clamps at the world edges and does nothing when fully outside', () => {
    const mask = createMask(30, 30, SOLID);
    const result = carveCircle(mask, 0, 0, 10);
    let inside = 0;
    for (let y = 0; y < 30; y += 1) {
      for (let x = 0; x < 30; x += 1) if (x * x + y * y <= 100) inside += 1;
    }
    expect(result.changed).toBe(inside);
    expect(countSolid(mask)).toBe(900 - inside);
    for (const span of result.spans) {
      expect(span.x0).toBeGreaterThanOrEqual(0);
      expect(span.y).toBeGreaterThanOrEqual(0);
    }

    const untouched = createMask(30, 30, SOLID);
    expect(carveCircle(untouched, -50, -50, 10)).toEqual({ spans: [], changed: 0 });
    expect(carveCircle(untouched, 15, 45, 10)).toEqual({ spans: [], changed: 0 });
    expect(carveCircle(untouched, 29.5, 15, 3).changed).toBeGreaterThan(0);
    expect(countSolid(untouched)).toBeLessThan(900);
  });

  it('span fill and per pixel paths give identical masks and identical results', () => {
    const circles = [
      { cx: 30, cy: 30, r: 12 },
      { cx: 5.5, cy: 40.2, r: 9 },
      { cx: 59, cy: 0, r: 20 },
    ];
    for (const { cx, cy, r } of circles) {
      const fast = createMask(60, 60, SOLID);
      for (let i = 0; i < fast.data.length; i += 7) fast.data[i] = AIR;
      const slow = cloneMask(fast);
      // The flag is conservative: forcing it on routes the carve through the bedrock aware path
      // even though the bytes hold no bedrock, which is exactly the comparison we want.
      slow.hasBedrock = true;
      expect(fast.hasBedrock).toBe(false);

      const a = carveCircle(fast, cx, cy, r);
      const b = carveCircle(slow, cx, cy, r);
      expect(Array.from(fast.data)).toEqual(Array.from(slow.data));
      expect(a.changed).toBe(b.changed);
      expect(a.spans).toEqual(b.spans);
    }
  });

  it('returned spans match the mask diff exactly on a mixed mask', () => {
    const mask = createMask(64, 48, SOLID);
    markBorderBedrock(mask);
    carveRect(mask, 28, 20, 6, 3, BEDROCK);
    setSpan(mask, 30, 10, 50, AIR);
    set(mask, 33, 27, AIR);
    const before = cloneMask(mask);

    const result = carveCircle(mask, 32, 24, 14);

    expectSpansMatchDiff(before, mask, result.spans);
    expect(result.changed).toBe(countSolid(before) - countSolid(mask));
    expect(countValue(mask, BEDROCK)).toBe(countValue(before, BEDROCK));
  });
});

describe('carveRect: girders', () => {
  it('adds SOLID or BEDROCK inside a clamped rect and reports the pixels it changed', () => {
    const mask = createMask(20, 10);
    const solid = carveRect(mask, 2, 3, 5, 2, SOLID);
    expect(solid.changed).toBe(10);
    expect(solid.spans).toEqual([
      { y: 3, x0: 2, x1: 6 },
      { y: 4, x0: 2, x1: 6 },
    ]);
    expect(countSolid(mask)).toBe(10);
    expect(mask.hasBedrock).toBe(false);

    const girder = carveRect(mask, 15, 8, 10, 10, BEDROCK);
    expect(girder.spans).toEqual([
      { y: 8, x0: 15, x1: 19 },
      { y: 9, x0: 15, x1: 19 },
    ]);
    expect(girder.changed).toBe(10);
    expect(countValue(mask, BEDROCK)).toBe(10);
    expect(mask.hasBedrock).toBe(true);
  });

  it('does not count pixels that already hold the value, but still returns their span', () => {
    const mask = createMask(20, 10, SOLID);
    const result = carveRect(mask, 0, 0, 4, 1, SOLID);
    expect(result.changed).toBe(0);
    expect(result.spans).toEqual([{ y: 0, x0: 0, x1: 3 }]);
  });

  it('never overwrites bedrock and excludes it from the spans', () => {
    const mask = createMask(20, 10);
    markBorderBedrock(mask);
    set(mask, 10, 5, BEDROCK);
    const result = carveRect(mask, 0, 5, 20, 1, SOLID);
    expect(get(mask, 0, 5)).toBe(BEDROCK);
    expect(get(mask, 10, 5)).toBe(BEDROCK);
    expect(get(mask, 19, 5)).toBe(BEDROCK);
    expect(result.spans).toEqual([
      { y: 5, x0: 2, x1: 9 },
      { y: 5, x0: 11, x1: 17 },
    ]);
    expect(result.changed).toBe(15);
  });

  it('can erase with AIR and ignores rects outside the world or with no area', () => {
    const mask = createMask(20, 10, SOLID);
    expect(carveRect(mask, 5, 5, 2, 2, AIR).changed).toBe(4);
    expect(countSolid(mask)).toBe(196);
    expect(carveRect(mask, 50, 50, 5, 5, SOLID)).toEqual({ spans: [], changed: 0 });
    expect(carveRect(mask, 5, 5, 0, 5, SOLID)).toEqual({ spans: [], changed: 0 });
    expect(carveRect(mask, -10, -10, 5, 5, SOLID)).toEqual({ spans: [], changed: 0 });
  });
});
