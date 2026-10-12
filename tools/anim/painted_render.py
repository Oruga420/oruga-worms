"""Painted image frames composited with ManimGX, never geometry-generated artwork.

Run with .venv-animation/Scripts/python.exe tools/anim/painted_render.py
Only final PNG/JSON ship. --clips slash-spark hex-shield supports offline sample checks.
"""

import argparse
import hashlib
import json
import logging
from contextlib import contextmanager
from importlib.metadata import version
from pathlib import Path
from typing import Any, Iterator

import manimgx as m
import numpy as np
from PIL import Image, ImageDraw
from manimgx.rendering.film import Frame

from atlas_export import CapturedFrame, Clip, save_atlas
from painted_prepare import (
    ALPHA_FLOOR, CELL_SIZE, FPS, FRAME_COUNT, HOLD_WINDOWS, MARGIN, PAINT_SIZE,
    ROOM_SOURCE_RADIUS, ROOM_TILE_RADIUS, SOURCES, TILE_SIZE, assemble_atlas,
    preparation_profile, prepare_tiles, split_sheet, straight_rgba, validate_atlas,
)

ROOT = Path(__file__).resolve().parents[2]
LOG = logging.getLogger(__name__)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class PaintedScene(m.Scene):
    def __init__(self, tiles: tuple[Image.Image, ...]) -> None:
        super().__init__()
        self.tiles = tiles

    def construct(self) -> None:
        for index, tile in enumerate(self.tiles):
            self.clear()
            self.add(m.ImageMobject(np.asarray(tile), scale_to_resolution=TILE_SIZE,
                                    resampling_algorithm=0))
            # Native render emits its own closing frame. A 16th wait adds frame17.
            if index < FRAME_COUNT - 1:
                self.wait(1 / FPS)


@contextmanager
def raster_config() -> Iterator[None]:
    """ManimGX exposes global configuration only; restore it even on native failure."""
    keys = ("pixel_width", "pixel_height", "_frame_height", "frame_rate", "background_opacity")
    previous = tuple(getattr(m.config, key) for key in keys)
    try:
        for key, value in zip(keys, (TILE_SIZE, TILE_SIZE, 8, FPS, 0)):
            setattr(m.config, key, value)
        yield
    finally:
        for key, value in zip(keys, previous):
            setattr(m.config, key, value)


def check_fidelity(tile: Image.Image, pixels: bytes) -> float:
    expected = np.asarray(tile).astype(float).reshape(-1, 4)
    actual = np.frombuffer(pixels, dtype=np.uint8).astype(float).reshape(-1, 4)
    if not np.array_equal(expected[:, 3], actual[:, 3]):
        raise ValueError("native compositor changed painted alpha or pixel alignment")
    delta = np.abs((expected[:, :3] - actual[:, :3]) * expected[:, 3:] / 255)
    maximum = float(delta.max())
    if maximum > 1.5:
        raise ValueError("native compositor exceeded1.5byte premultiply/unpremultiply quantization bound")
    return round(maximum, 6)


def render_tiles(name: str, tiles: tuple[Image.Image, ...]) -> tuple[Clip, dict[str, Any]]:
    if len(tiles) != FRAME_COUNT or any(tile.mode != "RGBA" or tile.size != (TILE_SIZE, TILE_SIZE) for tile in tiles):
        raise ValueError("native raster compositor needs exactly16 RGBA192px tiles")
    captured: tuple[CapturedFrame, ...] = ()
    evidence: tuple[dict[str, Any], ...] = ()
    native_calls = 0

    def capture(frame: Frame) -> None:
        nonlocal captured, evidence, native_calls
        raw = frame.pixels()  # Evaluate synchronously, before the next native frame.
        if len(raw) != TILE_SIZE * TILE_SIZE * 4:
            raise ValueError("native callback returned wrong RGBA buffer size")
        if (type(frame.index) is not int or type(frame.repeat) is not int
                or frame.index != len(captured) or frame.repeat < 1
                or frame.index + frame.repeat > FRAME_COUNT):
            raise ValueError("native callback timeline must cover16 chronological frames")
        pixels = straight_rgba(raw)
        native_calls += 1
        for index in range(frame.index, frame.index + frame.repeat):
            delta = check_fidelity(tiles[index], pixels)
            captured = (*captured, CapturedFrame(index, 1, pixels))
            evidence = (*evidence, {
                "index": index, "repeat": 1, "nativeCallbackIndex": frame.index,
                "nativeRepeat": frame.repeat, "preparedRgbaSha256": sha256(tiles[index].tobytes()),
                "nativePremultipliedRgbaSha256": sha256(raw), "rgbaSha256": sha256(pixels),
                "alphaMin": min(pixels[3::4]), "alphaMax": max(pixels[3::4]),
                "maxCompositedChannelError": delta,
            })

    with raster_config():
        film = PaintedScene(tiles).render(frames=capture)
    if len(captured) != FRAME_COUNT or film.frame_count != FRAME_COUNT:
        raise ValueError("native callback timeline does not match16 source frames")
    return Clip(name, captured, FPS), {
        "name": name, "nativeFrameCount": film.frame_count,
        "nativeCallbackCount": native_calls, "frames": list(evidence),
    }


def source_evidence(path: Path, sheet: Image.Image, source_root: Path) -> dict[str, Any]:
    def cell_evidence(index: int, cell: Image.Image) -> dict[str, Any]:
        alpha = np.asarray(cell)[:, :, 3]
        edges = np.concatenate((alpha[0], alpha[-1], alpha[1:-1, 0], alpha[1:-1, -1]))
        return {"index": index, "sourceCellRgbaSha256": sha256(cell.tobytes()),
                "cell": {"x": index % 4 * CELL_SIZE, "y": index // 4 * CELL_SIZE,
                         "w": CELL_SIZE, "h": CELL_SIZE},
                "sourceEdgePixelsAboveAlphaFloor": int(np.count_nonzero(edges > ALPHA_FLOOR)),
                "alphaMin": int(alpha.min()), "alphaMax": int(alpha.max())}

    return {"path": path.relative_to(source_root).as_posix(), "sha256": sha256(path.read_bytes()),
            "bytes": path.stat().st_size, "size": list(sheet.size), "mode": sheet.mode,
            "frames": [cell_evidence(i, cell) for i, cell in enumerate(split_sheet(sheet))]}


def render_source(name: str, source_root: Path) -> tuple[Clip, dict[str, Any]]:
    path = source_root / SOURCES[name]
    with Image.open(path) as image:
        sheet = image.copy()
    clip, proof = render_tiles(name, prepare_tiles(sheet, name=name))
    hold = HOLD_WINDOWS.get(name)
    return clip, {**proof, "source": source_evidence(path, sheet, source_root),
                  "preparationProfile": preparation_profile(name),
                  "fps": FPS, "loop": False, "holdStart": hold[0] if hold else None,
                  "holdEnd": hold[-1] if hold else None}


def write_contact_proof(clips: tuple[Clip, ...], destination: Path) -> None:
    indices = (4, 8, 11, 15)
    row_height = TILE_SIZE + 32
    width = TILE_SIZE * len(indices)
    proof = Image.new("RGB", (width, row_height * len(clips)), (80, 80, 80))
    labels = ImageDraw.Draw(proof)
    for row, clip in enumerate(clips):
        labels.text((8, row * row_height + 4), f"{clip.name} | source frames4,8,11,15 | 20fps", fill=(245, 245, 245))
        for col, index in enumerate(indices):
            tile = Image.frombytes("RGBA", (TILE_SIZE, TILE_SIZE), clip.frames[index].pixels)
            background = Image.new("RGBA", tile.size, (80, 80, 80, 255))
            proof.paste(Image.alpha_composite(background, tile).convert("RGB"), (col * TILE_SIZE, row * row_height + 28))
    destination.parent.mkdir(parents=True, exist_ok=True)
    proof.save(destination, format="PNG")


def make_provenance(atlas: Any, rendered: tuple, png: Path, metadata: Path) -> dict[str, Any]:
    frost_hold = HOLD_WINDOWS["frost-burst"]
    room = {"nominalSourceRadius": ROOM_SOURCE_RADIUS, "nominalTileRadius": ROOM_TILE_RADIUS,
            "basis": "Fixed nominal radius calibrated by inspecting mature raster cells, not a per-frame bbox or exact outline."}
    return {
        "description": "Painted raster cells composited with ManimGX ImageMobject; no visible vector artwork",
        "renderer": {"name": "ManimGX", "version": version("manimgx"),
                     "api": "ImageMobject -> Scene.render(frames=callback) -> Frame.pixels()",
                     "backgroundOpacity": 0, "resamplingAlgorithm": "nearest at1:1",
                     "nativeAlpha": "premultiplied", "pngAlpha": "straight (explicit unpremultiply)"},
        "preparation": {"cellSize": CELL_SIZE, "frameOrder": "row-major top-left to bottom-right",
                        "paintSize": PAINT_SIZE, "tileSize": TILE_SIZE, "transparentMargin": MARGIN,
                        "scale": PAINT_SIZE / CELL_SIZE, "recenter": False,
                        "alphaRemap": "round((max(0, alpha-12)/243)**clip.preparationProfile.alphaPower*255)",
                        "matte": "Multiply alpha by smoothstep weight in clip.preparationProfile; RGB art is not replaced",
                        "resize": "Pillow RGBA Lanczos",
                        "sourceBoundaryCaveat": "Some source art touches cell boundaries; padding prevents atlas bleed but cannot restore cropped source art."},
        **({"roomRim": room} if "room-bloom" in atlas.manifest["animations"] else {}),
        "nominalSourceRadii": atlas.manifest["meta"]["nominalSourceRadii"],
        "outputs": {"png": {"path": png.name, "sha256": sha256(png.read_bytes()), "bytes": png.stat().st_size},
                    "manifest": {"path": metadata.name, "sha256": sha256(metadata.read_bytes()), "bytes": metadata.stat().st_size},
                    "size": atlas.manifest["meta"]["size"]},
        "code": [{"path": f"tools/anim/{name}", "sha256": sha256((Path(__file__).parent / name).read_bytes())}
                 for name in ("painted_prepare.py", "painted_render.py", "atlas_export.py")],
        "clips": [proof for _, proof in rendered],
        "aliases": {"frozen-plate": {"sourceClip": "frost-burst", "sourceIndices": list(frost_hold),
                                      "fps": FPS, "loop": True, "holdStart": frost_hold[0], "holdEnd": frost_hold[-1]}}
                   if "frozen-plate" in atlas.manifest["animations"] else {},
    }


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, default=ROOT / "assets/_raw/sprite-vfx")
    parser.add_argument("--output", type=Path, default=ROOT / "public/sprites/fx")
    parser.add_argument("--proof-image", type=Path, default=Path(__file__).with_name("painted_proof.png"))
    parser.add_argument("--clips", nargs="+", choices=tuple(SOURCES), default=list(SOURCES))
    args = parser.parse_args(argv)
    if len(set(args.clips)) != len(args.clips):
        parser.error("clip names must be unique")
    missing = tuple(str(args.source_root / SOURCES[name]) for name in args.clips
                    if not (args.source_root / SOURCES[name]).is_file())
    if missing:
        parser.error("missing source sheets: " + ", ".join(missing))
    try:
        rendered = tuple(render_source(name, args.source_root) for name in args.clips)
        clips = tuple(clip for clip, _ in rendered)
        atlas = assemble_atlas(clips)
        validate_atlas(atlas)
        png, metadata = save_atlas(atlas, args.output, "painted-v2")
        provenance = make_provenance(atlas, rendered, png, metadata)
        (args.output / "painted-v2.provenance.json").write_text(json.dumps(provenance, indent=2) + "\n", encoding="utf-8")
        write_contact_proof(clips, args.proof_image)
    except (ValueError, OSError) as error:
        parser.error(str(error))
    LOG.info("Packed %s painted source clips, %s animations, %s bytes; native raster callbacks verified",
             len(clips), len(atlas.manifest["animations"]), len(atlas.png))


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    main()
