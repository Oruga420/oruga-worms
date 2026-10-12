"""Fast callback contract guards and checks on real generated output."""

import hashlib
import json
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from PIL import Image
from manimgx.rendering.film import Frame

from render_fx import ROOT, SIZE, render_clip


class RenderCallbackTests(unittest.TestCase):
    def run_fake(self, buffers: tuple[bytes, ...], count: int | None = None,
                 play_count: int = 0) -> tuple:
        def render(*, frames, plays):
            for index, buffer in enumerate(buffers):
                frames(Frame(index, 1, lambda pixels=buffer: pixels))
            return SimpleNamespace(frame_count=len(buffers) if count is None else count,
                                   plays=(None,) * play_count)
        with patch("render_fx.SpellScene") as scene:
            scene.return_value.render.side_effect = render
            return render_clip("room-bloom")

    def buffers(self) -> tuple[bytes, bytes]:
        return (bytes([255, 255, 255, 255]) * SIZE * SIZE, bytes(SIZE * SIZE * 4))

    def test_captures_pixels_synchronously_and_records_evidence(self) -> None:
        clip, evidence = self.run_fake(self.buffers())
        self.assertEqual(len(clip.frames), 2)
        self.assertEqual(evidence["frames"][0]["alphaMax"], 255)
        self.assertEqual(evidence["frames"][1]["alphaMax"], 0)
        self.assertEqual(evidence["frames"][0]["rgbaSha256"],
                         hashlib.sha256(self.buffers()[0]).hexdigest())

    def test_rejects_empty_or_incomplete_callback_timeline(self) -> None:
        for buffers, count in (((), 0), (self.buffers(), 4)):
            with self.subTest(count=count), self.assertRaisesRegex(ValueError, "timeline"):
                self.run_fake(buffers, count=count)

    def test_rejects_bad_rgba_buffer(self) -> None:
        with self.assertRaisesRegex(ValueError, "buffer size"):
            self.run_fake((b"bad",))

    def test_rejects_visible_terminal_frame(self) -> None:
        with self.assertRaisesRegex(ValueError, "final frame"):
            self.run_fake((self.buffers()[0],))

    def test_rejects_fully_invisible_render(self) -> None:
        with self.assertRaisesRegex(ValueError, "no visible pixels"):
            self.run_fake((self.buffers()[1],))

    def test_rejects_missing_play_callbacks(self) -> None:
        with self.assertRaisesRegex(ValueError, "callback plays"):
            self.run_fake(self.buffers(), play_count=1)


class GeneratedOutputTests(unittest.TestCase):
    def test_every_tile_matches_real_callback_hash_and_is_not_clipped(self) -> None:
        output = ROOT / "public" / "sprites" / "fx"
        manifest = json.loads((output / "manimgx-fx.json").read_text())
        proof = json.loads((Path(__file__).parent / "render-proof.json").read_text())
        png = (output / "manimgx-fx.png").read_bytes()
        self.assertEqual(hashlib.sha256(png).hexdigest(), proof["pngSha256"])
        with Image.open(output / "manimgx-fx.png") as sheet:
            for clip in proof["clips"]:
                for frame in clip["frames"]:
                    frame_id = f"{clip['scene']}_{frame['index']:03d}"
                    rect = manifest["frames"][frame_id]["frame"]
                    x, y, w, h = (rect[key] for key in ("x", "y", "w", "h"))
                    tile = sheet.crop((x, y, x + w, y + h))
                    with self.subTest(frame=frame_id):
                        self.assertEqual(hashlib.sha256(tile.tobytes()).hexdigest(), frame["rgbaSha256"])
                        alpha = tile.getchannel("A")
                        for border in ((0, 0, w, 1), (0, h - 1, w, h),
                                       (0, 0, 1, h), (w - 1, 0, w, h)):
                            self.assertEqual(alpha.crop(border).getextrema()[1], 0)


if __name__ == "__main__":
    unittest.main()
