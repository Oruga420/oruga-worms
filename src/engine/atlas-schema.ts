/**
 * Sprite atlas manifest schema (architecture.md section G): TexturePacker "hash" format plus two
 * extensions, animations and attachPoints. Validated once at load; a missing frame, a frame
 * outside the sheet, or an animation that references an unknown frame is a hard failure at boot,
 * never a silent blank at runtime. The validator never throws and never mutates its input.
 */

import { err, ok, type Err, type Result } from '../core/result.ts';

export interface AtlasPoint {
  readonly x: number;
  readonly y: number;
}

export interface AtlasSize {
  readonly w: number;
  readonly h: number;
}

export interface AtlasRect extends AtlasPoint, AtlasSize {}

export interface AtlasMeta {
  readonly image: string;
  readonly format: string;
  readonly size: AtlasSize;
  readonly scale: number;
  readonly frameSize?: AtlasSize;
  readonly pivot?: AtlasPoint;
}

export interface AtlasFrame {
  readonly frame: AtlasRect;
  readonly rotated: boolean;
  readonly trimmed: boolean;
  readonly spriteSourceSize: AtlasRect;
  readonly sourceSize: AtlasSize;
  readonly pivot?: AtlasPoint;
}

export interface AtlasAnimation {
  readonly frames: readonly string[];
  readonly fps: number;
  readonly loop: boolean;
}

/** Keyed by animation or frame id, then by attach point name (for example "hand"). */
export type AtlasAttachPoints = Readonly<Record<string, Readonly<Record<string, AtlasPoint>>>>;

export interface AtlasManifest {
  readonly meta: AtlasMeta;
  readonly frames: Readonly<Record<string, AtlasFrame>>;
  readonly animations: Readonly<Record<string, AtlasAnimation>>;
  readonly attachPoints: AtlasAttachPoints;
}

export type AtlasErrorCode =
  | 'not_an_object'
  | 'meta'
  | 'frames'
  | 'frame'
  | 'animations'
  | 'animation'
  | 'attach_points'
  | 'attach_point';

export interface AtlasError {
  readonly code: AtlasErrorCode;
  /** Dotted path to the offending value, for example "frames.worm_walk_00.frame". */
  readonly path: string;
  readonly message: string;
}

type Check<T> = Result<T, AtlasError>;

function fail(code: AtlasErrorCode, path: string, message: string): Err<AtlasError> {
  return err(Object.freeze({ code, path, message }));
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toFinite(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readPoint(value: unknown, path: string, code: AtlasErrorCode): Check<AtlasPoint> {
  if (!isRecord(value)) return fail(code, path, 'expected an object with x and y');
  const x = toFinite(value['x']);
  const y = toFinite(value['y']);
  if (x === null || y === null) return fail(code, path, 'x and y must be finite numbers');
  return ok(Object.freeze({ x, y }));
}

function readSize(value: unknown, path: string, code: AtlasErrorCode): Check<AtlasSize> {
  if (!isRecord(value)) return fail(code, path, 'expected an object with w and h');
  const w = toFinite(value['w']);
  const h = toFinite(value['h']);
  if (w === null || h === null || !Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0) {
    return fail(code, path, 'w and h must be positive integers');
  }
  return ok(Object.freeze({ w, h }));
}

function readRect(value: unknown, path: string, code: AtlasErrorCode): Check<AtlasRect> {
  const point = readPoint(value, path, code);
  if (!point.ok) return point;
  const size = readSize(value, path, code);
  if (!size.ok) return size;
  const { x, y } = point.value;
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0) {
    return fail(code, path, 'x and y must be non negative integers');
  }
  return ok(Object.freeze({ x, y, w: size.value.w, h: size.value.h }));
}

function readMeta(value: unknown): Check<AtlasMeta> {
  if (!isRecord(value)) return fail('meta', 'meta', 'meta must be an object');
  const image = value['image'];
  if (typeof image !== 'string' || image.trim() === '') {
    return fail('meta', 'meta.image', 'image must be a non empty string');
  }
  const format = typeof value['format'] === 'string' ? value['format'] : 'RGBA8888';
  const size = readSize(value['size'], 'meta.size', 'meta');
  if (!size.ok) return size;
  const scale = value['scale'] === undefined ? 1 : toFinite(value['scale']);
  if (scale === null || scale <= 0) return fail('meta', 'meta.scale', 'scale must be a positive number');

  const base = { image, format, size: size.value, scale };
  const withFrameSize = value['frameSize'] === undefined ? ok(base) : readFrameSize(base, value['frameSize']);
  if (!withFrameSize.ok) return withFrameSize;
  if (value['pivot'] === undefined) return ok(Object.freeze(withFrameSize.value));
  const pivot = readPoint(value['pivot'], 'meta.pivot', 'meta');
  if (!pivot.ok) return pivot;
  return ok(Object.freeze({ ...withFrameSize.value, pivot: pivot.value }));
}

function readFrameSize(base: AtlasMeta, raw: unknown): Check<AtlasMeta> {
  const frameSize = readSize(raw, 'meta.frameSize', 'meta');
  if (!frameSize.ok) return frameSize;
  return ok({ ...base, frameSize: frameSize.value });
}

function readFrame(id: string, value: unknown, sheet: AtlasSize): Check<AtlasFrame> {
  const path = `frames.${id}`;
  if (!isRecord(value)) return fail('frame', path, 'frame entry must be an object');
  const frame = readRect(value['frame'], `${path}.frame`, 'frame');
  if (!frame.ok) return frame;
  const { x, y, w, h } = frame.value;
  if (x + w > sheet.w || y + h > sheet.h) {
    return fail('frame', `${path}.frame`, `frame exceeds the ${sheet.w} x ${sheet.h} sheet`);
  }
  const rotated = value['rotated'] === true;
  const trimmed = value['trimmed'] === true;
  const spriteSourceSize =
    value['spriteSourceSize'] === undefined
      ? ok(Object.freeze({ x: 0, y: 0, w, h }))
      : readRect(value['spriteSourceSize'], `${path}.spriteSourceSize`, 'frame');
  if (!spriteSourceSize.ok) return spriteSourceSize;
  const sourceSize =
    value['sourceSize'] === undefined
      ? ok(Object.freeze({ w, h }))
      : readSize(value['sourceSize'], `${path}.sourceSize`, 'frame');
  if (!sourceSize.ok) return sourceSize;
  const base = {
    frame: frame.value,
    rotated,
    trimmed,
    spriteSourceSize: spriteSourceSize.value,
    sourceSize: sourceSize.value,
  };
  if (value['pivot'] === undefined) return ok(Object.freeze(base));
  const pivot = readPoint(value['pivot'], `${path}.pivot`, 'frame');
  if (!pivot.ok) return pivot;
  return ok(Object.freeze({ ...base, pivot: pivot.value }));
}

function readFrames(value: unknown, sheet: AtlasSize): Check<Readonly<Record<string, AtlasFrame>>> {
  if (!isRecord(value)) return fail('frames', 'frames', 'frames must be an object keyed by frame id');
  const entries = Object.entries(value);
  if (entries.length === 0) return fail('frames', 'frames', 'frames must not be empty');
  const out: Record<string, AtlasFrame> = {};
  for (const [id, raw] of entries) {
    const frame = readFrame(id, raw, sheet);
    if (!frame.ok) return frame;
    out[id] = frame.value;
  }
  return ok(Object.freeze(out));
}

function readAnimation(name: string, value: unknown, frameIds: ReadonlySet<string>): Check<AtlasAnimation> {
  const path = `animations.${name}`;
  if (!isRecord(value)) return fail('animation', path, 'animation must be an object');
  const frames = value['frames'];
  if (!Array.isArray(frames) || frames.length === 0) {
    return fail('animation', `${path}.frames`, 'frames must be a non empty array of frame ids');
  }
  for (const frameId of frames) {
    if (typeof frameId !== 'string' || !frameIds.has(frameId)) {
      return fail('animation', `${path}.frames`, `unknown frame ${String(frameId)}`);
    }
  }
  const fps = toFinite(value['fps']);
  if (fps === null || fps <= 0) return fail('animation', `${path}.fps`, 'fps must be a positive number');
  const loop = value['loop'] === true;
  return ok(Object.freeze({ frames: Object.freeze([...(frames as string[])]), fps, loop }));
}

function readAnimations(
  value: unknown,
  frameIds: ReadonlySet<string>,
): Check<Readonly<Record<string, AtlasAnimation>>> {
  if (value === undefined) return ok(Object.freeze({}));
  if (!isRecord(value)) return fail('animations', 'animations', 'animations must be an object');
  const out: Record<string, AtlasAnimation> = {};
  for (const [name, raw] of Object.entries(value)) {
    const animation = readAnimation(name, raw, frameIds);
    if (!animation.ok) return animation;
    out[name] = animation.value;
  }
  return ok(Object.freeze(out));
}

function readAttachPoints(value: unknown, knownIds: ReadonlySet<string>): Check<AtlasAttachPoints> {
  if (value === undefined) return ok(Object.freeze({}));
  if (!isRecord(value)) return fail('attach_points', 'attachPoints', 'attachPoints must be an object');
  const out: Record<string, Readonly<Record<string, AtlasPoint>>> = {};
  for (const [owner, raw] of Object.entries(value)) {
    const path = `attachPoints.${owner}`;
    if (!knownIds.has(owner)) return fail('attach_point', path, 'owner is not a known animation or frame');
    if (!isRecord(raw)) return fail('attach_point', path, 'expected an object of named points');
    const points: Record<string, AtlasPoint> = {};
    for (const [name, rawPoint] of Object.entries(raw)) {
      const point = readPoint(rawPoint, `${path}.${name}`, 'attach_point');
      if (!point.ok) return point;
      points[name] = point.value;
    }
    out[owner] = Object.freeze(points);
  }
  return ok(Object.freeze(out));
}

/** Validates a parsed atlas JSON document and returns a frozen, normalized manifest. */
export function validateAtlasManifest(input: unknown): Result<AtlasManifest, AtlasError> {
  if (!isRecord(input)) return fail('not_an_object', '', 'atlas manifest must be a JSON object');
  const meta = readMeta(input['meta']);
  if (!meta.ok) return meta;
  const frames = readFrames(input['frames'], meta.value.size);
  if (!frames.ok) return frames;
  const frameIds = new Set(Object.keys(frames.value));
  const animations = readAnimations(input['animations'], frameIds);
  if (!animations.ok) return animations;
  const knownIds = new Set([...frameIds, ...Object.keys(animations.value)]);
  const attachPoints = readAttachPoints(input['attachPoints'], knownIds);
  if (!attachPoints.ok) return attachPoints;
  return ok(
    Object.freeze({
      meta: meta.value,
      frames: frames.value,
      animations: animations.value,
      attachPoints: attachPoints.value,
    }),
  );
}
