"""Render original small FX with ManimGX; only PNG/JSON ship to the browser.

Run from any directory with the project's .venv-animation Python:
  .venv-animation/Scripts/python.exe tools/anim/render_fx.py

The ManimGX native tool carries third-party GPL/LGPL components. The isolated
venv is not distributed with the game; these geometric output images contain
no bundled tool code, fonts, or upstream scene artwork.
"""

import hashlib
import json
import logging
import time
from importlib.metadata import version
from pathlib import Path
from typing import Any

import manimgx as m
from manimgx.rendering.film import Frame, Play

from atlas_export import CapturedFrame, Clip, build_atlas, save_atlas
from fx_scenes import SCENES, SpellScene

ROOT = Path(__file__).resolve().parents[2]
SIZE = 160
FPS = 24
LOG = logging.getLogger(__name__)


def render_clip(name: str) -> tuple[Clip, dict[str, Any]]:
    captured: tuple[CapturedFrame, ...] = ()
    plays: tuple[dict[str, Any], ...] = ()
    start = time.perf_counter()

    def capture(frame: Frame) -> None:
        nonlocal captured
        # pixels() must be called now, before ManimGX sends its next frame.
        pixels = frame.pixels()
        if len(pixels) != SIZE * SIZE * 4:
            raise ValueError(f"{name}: renderer returned an unexpected RGBA buffer size")
        captured = (*captured, CapturedFrame(frame.index, frame.repeat, pixels))

    def on_play(play: Play, _animations: tuple[m.Animation, ...]) -> None:
        nonlocal plays
        plays = (*plays, {"index": play.index, "start": float(play.start), "end": float(play.end)})

    film = SpellScene(name).render(frames=capture, plays=on_play)
    elapsed = time.perf_counter() - start
    if not captured or sum(frame.repeat for frame in captured) != film.frame_count:
        raise ValueError(f"{name}: captured callback timeline does not match Film.frame_count")
    if max(captured[-1].pixels[3::4]) != 0:
        raise ValueError(f"{name}: final frame must be transparent for one-shot clamping")
    if not any(max(frame.pixels[3::4]) > 0 for frame in captured):
        raise ValueError(f"{name}: render contains no visible pixels")
    if len(plays) != len(film.plays):
        raise ValueError(f"{name}: callback plays do not match Film.plays")
    evidence = {
        "scene": name, "timelineFrames": film.frame_count, "uniqueFrames": len(captured),
        "seconds": round(elapsed, 4), "plays": plays,
        "frames": [{"index": f.index, "repeat": f.repeat,
                    "rgbaSha256": hashlib.sha256(f.pixels).hexdigest(),
                    "alphaMin": min(f.pixels[3::4]), "alphaMax": max(f.pixels[3::4])}
                   for f in captured],
    }
    LOG.info("Rendered %s: %s callback frames, %s timeline frames in %.2fs",
             name, len(captured), film.frame_count, elapsed)
    return Clip(name, captured, FPS), evidence


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    m.config.pixel_width = SIZE
    m.config.pixel_height = SIZE
    m.config.frame_height = 8
    m.config.frame_rate = FPS
    m.config.background_opacity = 0
    rendered = tuple(render_clip(name) for name in SCENES)
    atlas = build_atlas(tuple(clip for clip, _ in rendered), SIZE)
    png, metadata = save_atlas(atlas, ROOT / "public" / "sprites" / "fx")
    proof = {
        "generator": "ManimGX", "version": version("manimgx"),
        "source": "https://github.com/Oruga420/manimgx", "upstream": "academa-labs/manimgx",
        "api": "Scene.render(frames=callback, plays=callback); Frame.pixels()",
        "tileSize": SIZE, "fps": FPS, "backgroundOpacity": 0,
        "pngSha256": hashlib.sha256(atlas.png).hexdigest(), "pngBytes": len(atlas.png),
        "sheetSize": atlas.manifest["meta"]["size"],
        "clips": [evidence for _, evidence in rendered],
    }
    (Path(__file__).parent / "render-proof.json").write_text(
        json.dumps(proof, indent=2) + "\n", encoding="utf-8")
    LOG.info("Saved %s and %s (%s bytes)", png, metadata, len(atlas.png))


if __name__ == "__main__":
    main()
