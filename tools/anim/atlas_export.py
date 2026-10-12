"""Pack ManimGX's top-down RGBA callbacks into the game's atlas contract."""

import io
import json
import math
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from PIL import Image

MAX_TILE_SIZE = 192
MAX_TILES = 256
MAX_TIMELINE_FRAMES = 240
SAFE_ID = re.compile(r"[a-z][a-z0-9_-]*\Z")


@dataclass(frozen=True)
class CapturedFrame:
    index: int
    repeat: int
    pixels: bytes


@dataclass(frozen=True)
class Clip:
    name: str
    frames: tuple[CapturedFrame, ...]
    fps: float
    loop: bool = False


@dataclass(frozen=True)
class Atlas:
    png: bytes
    manifest: dict[str, Any]


def _validate(clips: tuple[Clip, ...], size: int, columns: int) -> None:
    if type(size) is not int or not 1 <= size <= MAX_TILE_SIZE:
        raise ValueError(f"tile size must be 1..{MAX_TILE_SIZE}")
    if type(columns) is not int or not 1 <= columns <= 16:
        raise ValueError("columns must be 1..16")
    names = tuple(clip.name for clip in clips)
    if not names or len(set(names)) != len(names):
        raise ValueError("clips must be nonempty and have unique names")
    if sum(len(clip.frames) for clip in clips) > MAX_TILES:
        raise ValueError(f"atlas exceeds {MAX_TILES} unique frames")
    for clip in clips:
        if not SAFE_ID.fullmatch(clip.name) or not clip.frames:
            raise ValueError("clip needs a safe name and at least one frame")
        if not math.isfinite(clip.fps) or not 0 < clip.fps <= 60:
            raise ValueError("fps must be finite and in (0, 60]")
        expected = 0
        for frame in clip.frames:
            if type(frame.index) is not int or frame.index != expected:
                raise ValueError("frame indices must form a contiguous timeline from zero")
            if type(frame.repeat) is not int or frame.repeat <= 0:
                raise ValueError("repeat must be a positive integer")
            if len(frame.pixels) != size * size * 4:
                raise ValueError("frame must contain one RGBA byte per channel per pixel")
            expected += frame.repeat
        if expected > MAX_TIMELINE_FRAMES:
            raise ValueError(f"clip exceeds {MAX_TIMELINE_FRAMES} timeline frames")


def _frame_metadata(tile: int, size: int, columns: int) -> dict[str, Any]:
    return {
        "frame": {"x": tile % columns * size, "y": tile // columns * size,
                  "w": size, "h": size},
        "rotated": False, "trimmed": False,
        "spriteSourceSize": {"x": 0, "y": 0, "w": size, "h": size},
        "sourceSize": {"w": size, "h": size},
        "pivot": {"x": 0.5, "y": 0.5},
    }


def build_atlas(clips: tuple[Clip, ...], size: int, columns: int = 8) -> Atlas:
    _validate(clips, size, columns)
    tiles = tuple((clip.name, frame) for clip in clips for frame in clip.frames)
    columns = min(columns, len(tiles))
    sheet_size = (columns * size, math.ceil(len(tiles) / columns) * size)
    image = Image.new("RGBA", sheet_size, (0, 0, 0, 0))
    frames = {
        f"{name}_{frame.index:03d}": _frame_metadata(tile, size, columns)
        for tile, (name, frame) in enumerate(tiles)
    }
    for tile, (_, frame) in enumerate(tiles):
        picture = Image.frombytes("RGBA", (size, size), frame.pixels)
        image.paste(picture, (tile % columns * size, tile // columns * size))
    encoded = io.BytesIO()
    image.save(encoded, format="PNG", optimize=True)
    manifest = {
        "meta": {"image": "manimgx-fx.png", "format": "RGBA8888",
                 "size": {"w": sheet_size[0], "h": sheet_size[1]}, "scale": 1,
                 "frameSize": {"w": size, "h": size}, "pivot": {"x": 0.5, "y": 0.5}},
        "frames": frames,
        "animations": {
            clip.name: {
                "frames": [f"{clip.name}_{frame.index:03d}" for frame in clip.frames
                           for _ in range(frame.repeat)],
                "fps": clip.fps, "loop": clip.loop,
            } for clip in clips
        },
        "attachPoints": {clip.name: {"origin": {"x": size / 2, "y": size / 2}}
                         for clip in clips},
    }
    return Atlas(encoded.getvalue(), manifest)


def save_atlas(atlas: Atlas, directory: Path, basename: str = "manimgx-fx") -> tuple[Path, Path]:
    if not SAFE_ID.fullmatch(basename):
        raise ValueError("output basename must be a safe lowercase identifier")
    directory.mkdir(parents=True, exist_ok=True)
    png, metadata = directory / f"{basename}.png", directory / f"{basename}.json"
    manifest = {**atlas.manifest, "meta": {**atlas.manifest["meta"], "image": png.name}}
    png.write_bytes(atlas.png)
    metadata.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return png, metadata
