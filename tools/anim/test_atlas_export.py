"""Contract tests for the offline RGBA callback-to-atlas bridge."""

import io
import json
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path

from PIL import Image

from atlas_export import CapturedFrame, Clip, build_atlas, save_atlas


class AtlasExportTests(unittest.TestCase):
    def clip(self, name="pulse"):
        pixels = bytes([255, 0, 0, 255, 0, 0, 0, 0] * 2)
        return Clip(name, (CapturedFrame(0, 2, pixels), CapturedFrame(2, 1, pixels)), 24)

    def test_repeats_hold_same_frame_id_without_duplicating_tiles(self):
        atlas = build_atlas((self.clip(),), 2, columns=2)
        self.assertEqual(atlas.manifest["animations"]["pulse"], {
            "frames": ["pulse_000", "pulse_000", "pulse_002"], "fps": 24, "loop": False,
        })
        self.assertEqual(len(atlas.manifest["frames"]), 2)

    def test_png_is_rgba_and_preserves_transparency_and_orientation(self):
        atlas = build_atlas((self.clip(),), 2, columns=2)
        image = Image.open(io.BytesIO(atlas.png))
        self.assertEqual(image.mode, "RGBA")
        self.assertEqual(image.size, (4, 2))
        self.assertEqual(image.getpixel((0, 0)), (255, 0, 0, 255))
        self.assertEqual(image.getpixel((1, 0)), (0, 0, 0, 0))
        self.assertEqual(image.getpixel((2, 1)), (255, 0, 0, 255))

    def test_metadata_matches_engine_source_size_and_center_pivot(self):
        atlas = build_atlas((self.clip(), self.clip("other")), 2, columns=3)
        self.assertEqual(atlas.manifest["meta"]["size"], {"w": 6, "h": 4})
        self.assertEqual(atlas.manifest["frames"]["other_002"], {
            "frame": {"x": 0, "y": 2, "w": 2, "h": 2},
            "rotated": False, "trimmed": False,
            "spriteSourceSize": {"x": 0, "y": 0, "w": 2, "h": 2},
            "sourceSize": {"w": 2, "h": 2}, "pivot": {"x": 0.5, "y": 0.5},
        })
        self.assertEqual(atlas.manifest["attachPoints"]["other"]["origin"], {"x": 1, "y": 1})

    def test_saves_named_png_and_json(self):
        atlas = build_atlas((self.clip(),), 2)
        with tempfile.TemporaryDirectory() as directory:
            png, manifest = save_atlas(atlas, Path(directory), "sample")
            self.assertEqual(png.name, "sample.png")
            self.assertEqual(json.loads(manifest.read_text())["meta"]["image"], "sample.png")
            Image.open(png).verify()
        self.assertEqual(atlas.manifest["meta"]["image"], "manimgx-fx.png")

    def test_rejects_invalid_clips(self):
        clip = self.clip()
        invalid = (
            (), (clip, clip), (replace(clip, name="../escape"),),
            (replace(clip, fps=0),), (replace(clip, fps=float("nan")),),
            (replace(clip, frames=()),),
            (replace(clip, frames=(CapturedFrame(1, 1, clip.frames[0].pixels),)),),
            (replace(clip, frames=(CapturedFrame(0, 0, clip.frames[0].pixels),)),),
            (replace(clip, frames=(CapturedFrame(0, 1, b"bad"),)),),
            (replace(clip, frames=(CapturedFrame(0, 1.5, clip.frames[0].pixels),)),),
        )
        for clips in invalid:
            with self.subTest(clips=clips), self.assertRaises(ValueError):
                build_atlas(clips, 2)

    def test_rejects_invalid_dimensions_and_unsafe_output_name(self):
        for size, columns in ((0, 2), (2, 0), (2.5, 2), (2048, 2)):
            with self.subTest(size=size, columns=columns), self.assertRaises(ValueError):
                build_atlas((self.clip(),), size, columns=columns)
        with tempfile.TemporaryDirectory() as directory, self.assertRaises(ValueError):
            save_atlas(build_atlas((self.clip(),), 2), Path(directory), "../escape")


if __name__ == "__main__":
    unittest.main()
