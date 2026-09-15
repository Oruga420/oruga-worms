/**
 * Atlas (architecture.md section G): a validated manifest plus its image, with frame lookup,
 * animation lookup and attach points. All frames are authored facing right; facing left is a
 * flipX at draw time and the hand attach point x is mirrored across the frame with it, which is
 * what lets 17 held weapon sprites replace 136 baked sheets.
 *
 * Attach points are keyed by animation or frame id and expressed in untrimmed frame pixels of
 * the owner's first frame. Rotated TexturePacker frames are refused at index time because the
 * sprite drawer does not unrotate them; our packer never emits them.
 */

import { vec2, type Vec2 } from '../core/math.ts';
import { err, ok, type Result } from '../core/result.ts';
import {
  validateAtlasManifest,
  type AtlasAnimation,
  type AtlasError,
  type AtlasFrame,
  type AtlasManifest,
  type AtlasPoint,
} from './atlas-schema.ts';
import type { ImageSource } from './canvas-types.ts';

export const DEFAULT_PIVOT: AtlasPoint = Object.freeze({ x: 0.5, y: 0.5 });

export interface Atlas {
  readonly manifest: AtlasManifest;
  readonly image: ImageSource;
  frame(id: string): AtlasFrame | undefined;
  animation(name: string): AtlasAnimation | undefined;
  /** The frames behind an id: the animation's list, or the single frame, or empty. */
  frameIds(idOrAnimation: string): readonly string[];
  /** Pivot as a fraction of the untrimmed source size: frame pivot, else meta pivot, else center. */
  pivotOf(frame: AtlasFrame): AtlasPoint;
  /** Attach point in frame px of the owner's first frame, mirrored when facing left. */
  attachPoint(owner: string, name: string, facingLeft?: boolean): AtlasPoint | undefined;
  /** Attach point relative to the pivot in frame px, mirrored when facing left. */
  attachOffset(owner: string, name: string, facingLeft?: boolean): Vec2 | undefined;
}

export interface AtlasIndexError {
  readonly code: 'rotated_frame';
  readonly path: string;
  readonly message: string;
}

/** Mirrors a frame space point across the vertical axis of a frame this wide. */
export function mirrorPoint(point: AtlasPoint, frameWidth: number): AtlasPoint {
  return Object.freeze({ x: frameWidth - point.x, y: point.y });
}

export function resolvePivot(frame: AtlasFrame, manifest: AtlasManifest): AtlasPoint {
  return frame.pivot ?? manifest.meta.pivot ?? DEFAULT_PIVOT;
}

/** The frame an owner id stands for: itself when it is a frame, else the animation's first frame. */
export function ownerFrame(manifest: AtlasManifest, owner: string): AtlasFrame | undefined {
  const direct = manifest.frames[owner];
  if (direct !== undefined) return direct;
  const first = manifest.animations[owner]?.frames[0];
  return first === undefined ? undefined : manifest.frames[first];
}

function findRotated(manifest: AtlasManifest): string | null {
  for (const [id, frame] of Object.entries(manifest.frames)) {
    if (frame.rotated) return id;
  }
  return null;
}

export function createAtlas(manifest: AtlasManifest, image: ImageSource): Result<Atlas, AtlasIndexError> {
  const rotated = findRotated(manifest);
  if (rotated !== null) {
    return err(
      Object.freeze({
        code: 'rotated_frame' as const,
        path: `frames.${rotated}`,
        message: `frame ${rotated} is rotated; the sprite drawer only handles upright frames`,
      }),
    );
  }

  const attachPoint = (owner: string, name: string, facingLeft = false): AtlasPoint | undefined => {
    const point = manifest.attachPoints[owner]?.[name];
    if (point === undefined) return undefined;
    if (!facingLeft) return point;
    const frame = ownerFrame(manifest, owner);
    return frame === undefined ? undefined : mirrorPoint(point, frame.sourceSize.w);
  };

  const atlas: Atlas = {
    manifest,
    image,
    frame: (id) => manifest.frames[id],
    animation: (name) => manifest.animations[name],
    frameIds: (id) => {
      const animation = manifest.animations[id];
      if (animation !== undefined) return animation.frames;
      return manifest.frames[id] === undefined ? [] : [id];
    },
    pivotOf: (frame) => resolvePivot(frame, manifest),
    attachPoint,
    attachOffset: (owner, name, facingLeft = false) => {
      const point = attachPoint(owner, name, facingLeft);
      const frame = ownerFrame(manifest, owner);
      if (point === undefined || frame === undefined) return undefined;
      const pivot = resolvePivot(frame, manifest);
      return vec2(point.x - pivot.x * frame.sourceSize.w, point.y - pivot.y * frame.sourceSize.h);
    },
  };
  return ok(Object.freeze(atlas));
}

/** Validates raw atlas JSON and indexes it in one step. */
export function loadAtlas(json: unknown, image: ImageSource): Result<Atlas, AtlasError | AtlasIndexError> {
  const manifest = validateAtlasManifest(json);
  if (!manifest.ok) return manifest;
  return createAtlas(manifest.value, image);
}
