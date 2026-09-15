/**
 * Vec2 and scalar helpers (architecture.md section I, core/math.ts). Every vector function
 * returns a new frozen object; nothing here mutates its inputs. Angles are radians unless the
 * name says degrees. Screen space has y pointing down, so "up" is negative y everywhere in the
 * sim and these helpers make no assumption about it.
 */

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export const ZERO: Vec2 = Object.freeze({ x: 0, y: 0 });
export const TWO_PI = Math.PI * 2;

export function vec2(x: number, y: number): Vec2 {
  return Object.freeze({ x, y });
}

export function add(a: Vec2, b: Vec2): Vec2 {
  return vec2(a.x + b.x, a.y + b.y);
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return vec2(a.x - b.x, a.y - b.y);
}

export function scale(v: Vec2, s: number): Vec2 {
  return vec2(v.x * s, v.y * s);
}

export function negate(v: Vec2): Vec2 {
  return vec2(-v.x, -v.y);
}

export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

/** The z component of the 3D cross product, positive when b is clockwise from a on screen. */
export function cross(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x;
}

export function lengthSq(v: Vec2): number {
  return v.x * v.x + v.y * v.y;
}

export function length(v: Vec2): number {
  return Math.hypot(v.x, v.y);
}

export function distanceSq(a: Vec2, b: Vec2): number {
  return lengthSq(sub(a, b));
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Unit vector; the zero vector stays zero instead of producing NaN. */
export function normalize(v: Vec2): Vec2 {
  const len = length(v);
  return len === 0 ? ZERO : vec2(v.x / len, v.y / len);
}

/** Rotated 90 degrees counter clockwise in math coordinates (x right, y up). */
export function perpendicular(v: Vec2): Vec2 {
  return vec2(-v.y, v.x);
}

export function fromAngle(radians: number, magnitude = 1): Vec2 {
  return vec2(Math.cos(radians) * magnitude, Math.sin(radians) * magnitude);
}

export function angleOf(v: Vec2): number {
  return Math.atan2(v.y, v.x);
}

export function rotate(v: Vec2, radians: number): Vec2 {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return vec2(v.x * c - v.y * s, v.x * s + v.y * c);
}

export function lerpVec(a: Vec2, b: Vec2, t: number): Vec2 {
  return vec2(lerp(a.x, b.x, t), lerp(a.y, b.y, t));
}

export function approxEqual(a: number, b: number, epsilon = 1e-9): boolean {
  return Math.abs(a - b) <= epsilon;
}

export function vecApproxEqual(a: Vec2, b: Vec2, epsilon = 1e-9): boolean {
  return approxEqual(a.x, b.x, epsilon) && approxEqual(a.y, b.y, epsilon);
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Where value sits between a and b, 0 at a and 1 at b; 0 when a equals b. */
export function inverseLerp(a: number, b: number, value: number): number {
  return a === b ? 0 : (value - a) / (b - a);
}

export function degToRad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function radToDeg(radians: number): number {
  return (radians * 180) / Math.PI;
}

/** Wraps an angle into [-PI, PI). */
export function normalizeAngle(radians: number): number {
  const wrapped = ((((radians + Math.PI) % TWO_PI) + TWO_PI) % TWO_PI) - Math.PI;
  return wrapped;
}

/** Wraps an angle in degrees into [-180, 180). */
export function normalizeDegrees(degrees: number): number {
  return ((((degrees + 180) % 360) + 360) % 360) - 180;
}

/** Shortest signed rotation from one angle to another, in [-PI, PI). */
export function angleDifference(from: number, to: number): number {
  return normalizeAngle(to - from);
}

/** Mirror of v across the plane with unit normal n: v minus 2 (v dot n) n. */
export function reflect(v: Vec2, normal: Vec2): Vec2 {
  const n = normalize(normal);
  const along = 2 * dot(v, n);
  return vec2(v.x - along * n.x, v.y - along * n.y);
}

/**
 * Damped bounce used by the projectile and grenade collision response. The component of the
 * velocity along the surface normal flips and is scaled by restitution; the tangential
 * component keeps its direction and is scaled by friction (1 keeps all of it, 0 stops sliding).
 */
export function dampedBounce(velocity: Vec2, normal: Vec2, restitution: number, friction: number): Vec2 {
  const n = normalize(normal);
  const normalSpeed = dot(velocity, n);
  const normalPart = scale(n, normalSpeed);
  const tangentPart = sub(velocity, normalPart);
  return add(scale(normalPart, -restitution), scale(tangentPart, friction));
}
