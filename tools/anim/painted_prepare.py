"""Fixed-cell painted sprite preparation; no generated geometry or bbox tracking."""

import io
from types import MappingProxyType

import numpy as np
from PIL import Image

from atlas_export import Atlas, Clip, build_atlas

TILE_SIZE = 192
PAINT_SIZE = 168
MARGIN = (TILE_SIZE - PAINT_SIZE) // 2
CELL_SIZE = 256
FRAME_COUNT = 16
FPS = 20
ALPHA_FLOOR = 12
MAX_PNG_BYTES = 8 * 1024 * 1024
SOURCES = MappingProxyType({
    "slash-spark": "v2-samples/claw-sprites/sheet.png",
    "hex-shield": "v2-samples/barrier-sprites/sheet.png",
    "frost-burst": "v2-completion/frost-sprites/sheet.png",
    "room-bloom": "v2-completion/room-sprites/sheet.png",
    "immortality-wings": "v2-completion/immortal-sprites/sheet.png",
    "blast-burst": "v2-blast/blast-sprites/sheet.png",
})
HOLD_WINDOWS = MappingProxyType({
    "hex-shield": (8, 9, 10, 11),
    "frost-burst": (8, 9, 10, 11),
    "room-bloom": (8, 9, 10, 11),
    # The wings begin shedding feathers at 10, unlike the other source sheets.
    "immortality-wings": (6, 7, 8, 9),
})
# Nominal fixed radius, visually calibrated on mature room cells, not a bbox claim.
ROOM_SOURCE_RADIUS = 90
ROOM_TILE_RADIUS = ROOM_SOURCE_RADIUS * PAINT_SIZE / CELL_SIZE


def split_sheet(sheet: Image.Image) -> tuple[Image.Image, ...]:
    if sheet.mode != "RGBA" or sheet.size != (CELL_SIZE * 4, CELL_SIZE * 4):
        raise ValueError("source sheet must be exactly 1024x1024 RGBA with 4x4 cells")
    return tuple(sheet.crop((i % 4 * CELL_SIZE, i // 4 * CELL_SIZE,
                             (i % 4 + 1) * CELL_SIZE, (i // 4 + 1) * CELL_SIZE))
                 for i in range(FRAME_COUNT))


def clean_alpha(image: Image.Image, power: int = 1) -> Image.Image:
    """Smooth remap round((max(0, a-12)/243)**power*255), never binary alpha."""
    if image.mode != "RGBA" or power not in (1, 2, 4):
        raise ValueError("alpha cleanup requires RGBA and an allowed power1,2,4")
    rgba = np.asarray(image)
    alpha = np.rint((np.maximum(rgba[:, :, 3].astype(float) - ALPHA_FLOOR, 0)
                     / (255 - ALPHA_FLOOR)) ** power * 255).astype(np.uint8)
    rgb = np.where(alpha[:, :, None] > 0, rgba[:, :, :3], 0)
    return Image.fromarray(np.dstack((rgb, alpha)))


def preparation_profile(name: str | None) -> dict:
    if name is not None and name not in SOURCES:
        raise ValueError("unknown painted clip")
    if name == "room-bloom":
        return {"alphaPower": 4, "matte": "radial-smoothstep", "center": [128, 128],
                "fullRadius": 100, "zeroRadius": 116}
    if name == "immortality-wings":
        return {"alphaPower": 2, "matte": "cell-edge-smoothstep", "fadeWidth": 12}
    return {"alphaPower": 1, "matte": "none"}


def apply_matte(image: Image.Image, profile: dict) -> Image.Image:
    """Multiply alpha only; no drawn geometry is included in the rendered image."""
    if profile["matte"] == "none":
        return image
    y, x = np.indices(image.size[::-1], dtype=float)
    if profile["matte"] == "radial-smoothstep":
        cx, cy = profile["center"]
        radius = np.hypot(x + 0.5 - cx, y + 0.5 - cy)
        distance = (profile["zeroRadius"] - radius) / (profile["zeroRadius"] - profile["fullRadius"])
    else:
        edge = np.minimum.reduce((x, y, image.width - 1 - x, image.height - 1 - y))
        distance = edge / profile["fadeWidth"]
    t = np.clip(distance, 0, 1)
    rgba = np.asarray(image)
    alpha = np.rint(rgba[:, :, 3] * t * t * (3 - 2 * t)).astype(np.uint8)
    rgb = np.where(alpha[:, :, None] > 0, rgba[:, :, :3], 0)
    return Image.fromarray(np.dstack((rgb, alpha)))


def prepare_tiles(sheet: Image.Image, name: str | None = None) -> tuple[Image.Image, ...]:
    profile = preparation_profile(name)

    def prepare(cell: Image.Image) -> Image.Image:
        # Pillow's RGBA Lanczos resize uses premultiplied filtering, avoiding halos.
        cleaned = apply_matte(clean_alpha(cell, profile["alphaPower"]), profile)
        paint = cleaned.resize((PAINT_SIZE, PAINT_SIZE), Image.Resampling.LANCZOS)
        tile = Image.new("RGBA", (TILE_SIZE, TILE_SIZE))
        tile.paste(paint, (MARGIN, MARGIN))
        return tile

    tiles = tuple(prepare(cell) for cell in split_sheet(sheet))
    if not any(tile.getchannel("A").getbbox() for tile in tiles):
        raise ValueError("source sheet contains no visible painted pixels after alpha cleanup")
    return tiles


def straight_rgba(premultiplied: bytes) -> bytes:
    """Native ManimGX 0.1.1 callbacks are premultiplied; PNG uses straight alpha."""
    if len(premultiplied) % 4:
        raise ValueError("RGBA buffer size must be divisible by four")
    rgba = np.frombuffer(premultiplied, dtype=np.uint8).reshape(-1, 4)
    alpha = rgba[:, 3:4]
    rgb = np.where(alpha > 0, np.minimum(255, np.rint(
        rgba[:, :3].astype(float) * 255 / np.maximum(alpha, 1))), 0).astype(np.uint8)
    return np.hstack((rgb, alpha)).tobytes()


def assemble_atlas(clips: tuple[Clip, ...]) -> Atlas:
    for clip in clips:
        if (clip.name not in SOURCES or clip.fps != FPS or clip.loop
                or len(clip.frames) != FRAME_COUNT or any(f.repeat != 1 for f in clip.frames)):
            raise ValueError("painted clips require a known name and 16 one-shot frames at20fps")
    packed = build_atlas(clips, TILE_SIZE)
    names = tuple(clip.name for clip in clips)
    animations = packed.manifest["animations"]
    points = packed.manifest["attachPoints"]
    if "frost-burst" in names:
        animations = {**animations, "frozen-plate": {
            "frames": [f"frost-burst_{index:03d}" for index in HOLD_WINDOWS["frost-burst"]],
            "fps": FPS, "loop": True,
        }}
        points = {**points, "frozen-plate": {"origin": {"x": TILE_SIZE / 2, "y": TILE_SIZE / 2}}}
    radial_names = tuple(name for name in ("room-bloom", "blast-burst") if name in names)
    points = {**points, **{name: {**points[name], "rim": {
        "x": TILE_SIZE / 2 + ROOM_TILE_RADIUS, "y": TILE_SIZE / 2,
    }} for name in radial_names}}
    return Atlas(packed.png, {**packed.manifest, "animations": animations, "attachPoints": points,
        "meta": {**packed.manifest["meta"], "image": "painted-v2.png",
                 "alphaMode": "straight", "paintSize": PAINT_SIZE, "transparentMargin": MARGIN,
                 "holdFrameIndices": {name: list(indices) for name, indices in HOLD_WINDOWS.items() if name in names},
                 "nominalSourceRadii": {name: ROOM_SOURCE_RADIUS for name in radial_names}}})


def _validate_tile(image: Image.Image, entry: dict) -> None:
    rect = entry["frame"]
    x, y, w, h = (rect[key] for key in ("x", "y", "w", "h"))
    if (any(type(value) is not int for value in (x, y, w, h)) or min(x, y) < 0
            or (w, h) != (TILE_SIZE, TILE_SIZE) or x + w > image.width or y + h > image.height):
        raise ValueError("frame bounds are outside the atlas")
    if (entry["rotated"] or entry["trimmed"] or entry["sourceSize"] != {"w": w, "h": h}
            or entry["spriteSourceSize"] != {"x": 0, "y": 0, "w": w, "h": h}
            or entry["pivot"] != {"x": 0.5, "y": 0.5}):
        raise ValueError("frame must be untrimmed with a fixed center")
    alpha = image.crop((x, y, x + w, y + h)).getchannel("A")
    for border in ((0, 0, w, MARGIN), (0, h - MARGIN, w, h),
                   (0, 0, MARGIN, h), (w - MARGIN, 0, w, h)):
        if alpha.crop(border).getextrema()[1] != 0:
            raise ValueError("painted tile lost its transparent margin")


def validate_atlas(atlas: Atlas, max_bytes: int = MAX_PNG_BYTES) -> None:
    if len(atlas.png) > max_bytes:
        raise ValueError("painted atlas exceeds bounded PNG bytes")
    with Image.open(io.BytesIO(atlas.png)) as image:
        size = atlas.manifest["meta"]["size"]
        if image.mode != "RGBA" or image.size != (size["w"], size["h"]) or max(image.size) > 4096:
            raise ValueError("atlas must be bounded RGBA matching manifest dimensions")
        for entry in atlas.manifest["frames"].values():
            _validate_tile(image, entry)
    for name, clip in atlas.manifest["animations"].items():
        count = 4 if name == "frozen-plate" else FRAME_COUNT
        if len(clip["frames"]) != count or clip["fps"] != FPS or clip["loop"] != (name == "frozen-plate"):
            raise ValueError("animation cadence must match the painted contract")
        if any(key not in atlas.manifest["frames"] for key in clip["frames"]):
            raise ValueError("animation points to a missing frame")
        if atlas.manifest["attachPoints"][name]["origin"] != {"x": 96, "y": 96}:
            raise ValueError("animation origin must stay at the fixed tile center")
