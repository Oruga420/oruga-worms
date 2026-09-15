import { describe, expect, it } from 'vitest';
import {
  ZERO,
  add,
  angleDifference,
  angleOf,
  approxEqual,
  clamp,
  cross,
  dampedBounce,
  degToRad,
  distance,
  distanceSq,
  dot,
  fromAngle,
  inverseLerp,
  length,
  lengthSq,
  lerp,
  lerpVec,
  negate,
  normalize,
  normalizeAngle,
  normalizeDegrees,
  perpendicular,
  radToDeg,
  reflect,
  rotate,
  scale,
  sub,
  vec2,
  vecApproxEqual,
} from '@/core/math.ts';

describe('math: vectors', () => {
  it('builds frozen vectors and never mutates inputs', () => {
    const a = vec2(1, 2);
    const b = vec2(3, 4);
    const sum = add(a, b);
    expect(sum).toEqual({ x: 4, y: 6 });
    expect(Object.isFrozen(sum)).toBe(true);
    expect(a).toEqual({ x: 1, y: 2 });
    expect(ZERO).toEqual({ x: 0, y: 0 });
  });

  it('does arithmetic', () => {
    expect(sub(vec2(5, 5), vec2(2, 3))).toEqual({ x: 3, y: 2 });
    expect(scale(vec2(1, -2), 3)).toEqual({ x: 3, y: -6 });
    expect(negate(vec2(1, -2))).toEqual({ x: -1, y: 2 });
    expect(dot(vec2(1, 2), vec2(3, 4))).toBe(11);
    expect(cross(vec2(1, 0), vec2(0, 1))).toBe(1);
    expect(lengthSq(vec2(3, 4))).toBe(25);
    expect(length(vec2(3, 4))).toBe(5);
    expect(distance(vec2(0, 0), vec2(3, 4))).toBe(5);
    expect(distanceSq(vec2(1, 1), vec2(4, 5))).toBe(25);
  });

  it('normalizes, with the zero vector staying zero', () => {
    expect(normalize(vec2(0, 5))).toEqual({ x: 0, y: 1 });
    expect(normalize(ZERO)).toEqual({ x: 0, y: 0 });
    expect(length(normalize(vec2(3, -7)))).toBeCloseTo(1, 12);
  });

  it('rotates and converts angles', () => {
    expect(vecApproxEqual(rotate(vec2(1, 0), Math.PI / 2), vec2(0, 1))).toBe(true);
    expect(vecApproxEqual(fromAngle(Math.PI, 2), vec2(-2, 0))).toBe(true);
    expect(angleOf(vec2(0, 1))).toBeCloseTo(Math.PI / 2, 12);
    expect(perpendicular(vec2(1, 0))).toEqual({ x: -0, y: 1 });
    expect(lerpVec(vec2(0, 0), vec2(10, -10), 0.25)).toEqual({ x: 2.5, y: -2.5 });
  });
});

describe('math: scalars', () => {
  it('clamps and interpolates', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(clamp(2, 0, 3)).toBe(2);
    expect(lerp(0, 10, 0.3)).toBeCloseTo(3, 12);
    expect(inverseLerp(10, 20, 15)).toBe(0.5);
    expect(inverseLerp(5, 5, 5)).toBe(0);
    expect(approxEqual(0.1 + 0.2, 0.3)).toBe(true);
  });

  it('converts degrees and radians both ways', () => {
    expect(degToRad(180)).toBeCloseTo(Math.PI, 12);
    expect(radToDeg(Math.PI / 2)).toBeCloseTo(90, 12);
    expect(radToDeg(degToRad(37))).toBeCloseTo(37, 12);
  });

  it('normalizes angles into the half open range', () => {
    expect(normalizeAngle(3 * Math.PI)).toBeCloseTo(-Math.PI, 12);
    expect(normalizeAngle(Math.PI / 2)).toBeCloseTo(Math.PI / 2, 12);
    expect(normalizeAngle(-3 * Math.PI)).toBeCloseTo(-Math.PI, 12);
    expect(normalizeDegrees(540)).toBe(-180);
    expect(normalizeDegrees(-190)).toBe(170);
    expect(normalizeDegrees(45)).toBe(45);
  });

  it('finds the shortest signed rotation', () => {
    expect(angleDifference(degToRad(350), degToRad(10))).toBeCloseTo(degToRad(20), 12);
    expect(angleDifference(degToRad(10), degToRad(350))).toBeCloseTo(degToRad(-20), 12);
  });
});

describe('math: reflection and bounce', () => {
  it('reflects across a surface normal', () => {
    expect(vecApproxEqual(reflect(vec2(1, -1), vec2(0, 1)), vec2(1, 1))).toBe(true);
    expect(vecApproxEqual(reflect(vec2(1, -1), vec2(0, 7)), vec2(1, 1))).toBe(true);
    expect(vecApproxEqual(reflect(vec2(-3, 2), vec2(1, 0)), vec2(3, 2))).toBe(true);
  });

  it('scales the normal component by restitution and the tangent by friction', () => {
    const out = dampedBounce(vec2(2, -4), vec2(0, 1), 0.5, 0.9);
    expect(out.x).toBeCloseTo(1.8, 12);
    expect(out.y).toBeCloseTo(2, 12);
  });

  it('matches a perfect reflection when restitution and friction are 1', () => {
    const v = vec2(3, -5);
    const n = normalize(vec2(1, 2));
    expect(vecApproxEqual(dampedBounce(v, n, 1, 1), reflect(v, n), 1e-9)).toBe(true);
  });

  it('kills all motion with zero restitution and zero friction', () => {
    expect(vecApproxEqual(dampedBounce(vec2(3, -5), vec2(0, 1), 0, 0), ZERO)).toBe(true);
  });

  it('accepts an unnormalized normal', () => {
    const a = dampedBounce(vec2(2, -4), vec2(0, 10), 0.6, 0.96);
    const b = dampedBounce(vec2(2, -4), vec2(0, 1), 0.6, 0.96);
    expect(vecApproxEqual(a, b)).toBe(true);
  });
});
