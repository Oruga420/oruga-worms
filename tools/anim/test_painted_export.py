"""Offline painted raster contract; unittest is already available in the venv."""

import hashlib
import io
import unittest
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np
from PIL import Image
from manimgx.rendering.film import Frame

from atlas_export import CapturedFrame, Clip
from painted_prepare import (
    FPS, HOLD_WINDOWS, SOURCES, TILE_SIZE, assemble_atlas, clean_alpha,
    prepare_tiles, split_sheet, straight_rgba, validate_atlas,
)
from painted_render import render_tiles


def marker_sheet() -> Image.Image:
    """Distinct fixed-position markers expose row order, flipping and recentering."""
    sheet = Image.new("RGBA", (1024, 1024))
    for index in range(16):
        cell = Image.new("RGBA", (256, 256))
        cell.paste((index * 15, 255 - index * 15, 60, 255), (40, 60, 100, 120))
        cell.paste((30, 80, 200, 128), (140, 180, 220, 230))
        sheet.paste(cell, (index % 4 * 256, index // 4 * 256))
    return sheet


class PreparationTests(unittest.TestCase):
    def test_split_is_row_major_and_keeps_fixed_cell_coordinates(self) -> None:
        cells = split_sheet(marker_sheet())
        self.assertEqual(len(cells), 16)
        for index, cell in enumerate(cells):
            self.assertEqual(cell.size, (256, 256))
            self.assertEqual(cell.getpixel((50, 70)), (index * 15, 255 - index * 15, 60, 255))
            self.assertEqual(cell.getpixel((0, 0)), (0, 0, 0, 0))

    def test_rejects_wrong_size_or_missing_alpha(self) -> None:
        for mode, size in (("RGB", (1024, 1024)), ("RGBA", (1024, 768)), ("RGBA", (512, 512))):
            with self.subTest(mode=mode, size=size), self.assertRaises(ValueError):
                split_sheet(Image.new(mode, size))

    def test_alpha_curve_removes_wash_without_binary_thresholding(self) -> None:
        source = Image.frombytes("RGBA", (256, 1), bytes(c for a in range(256) for c in (80, 160, 240, a)))
        original = source.tobytes()
        result = clean_alpha(source)
        alpha = tuple(result.getchannel("A").getdata())
        self.assertEqual(alpha[:13], (0,) * 13)
        self.assertEqual((alpha[13], alpha[128], alpha[253], alpha[255]), (1, 122, 253, 255))
        self.assertEqual(alpha, tuple(sorted(alpha)))
        self.assertGreater(len(set(alpha)), 200)
        self.assertEqual(result.getpixel((12, 0)), (0, 0, 0, 0))
        self.assertEqual(result.getpixel((128, 0))[:3], (80, 160, 240))
        self.assertEqual(source.tobytes(), original)

    def test_scaled_cells_are_untrimmed_and_have_twelve_pixel_margins(self) -> None:
        tiles = prepare_tiles(marker_sheet())
        self.assertEqual(len(tiles), 16)
        for tile in tiles:
            self.assertEqual(tile.size, (192, 192))
            self.assertEqual(tile.getpixel((46, 59))[3], 255)
            self.assertEqual(tile.getpixel((130, 142))[3], 122)
            for border in ((0, 0, 192, 12), (0, 180, 192, 192), (0, 0, 12, 192), (180, 0, 192, 192)):
                self.assertEqual(tile.getchannel("A").crop(border).getextrema()[1], 0)

    def test_source_edge_content_is_preserved_with_padding_not_falsely_rejected(self) -> None:
        tiles = prepare_tiles(Image.new("RGBA", (1024, 1024), (70, 140, 210, 200)))
        self.assertEqual(tiles[0].getchannel("A").getbbox(), (12, 12, 180, 180))
        self.assertGreater(tiles[0].getpixel((12, 12))[3], 0)

    def test_room_matte_retains_nominal_rim_but_removes_rectangular_fog(self) -> None:
        sheet = Image.new("RGBA", (1024, 1024), (160, 210, 240, 128))
        before = prepare_tiles(sheet)[0]
        after = prepare_tiles(sheet, name="room-bloom")[0]
        self.assertEqual(after.getpixel((96, 96))[3], 13)
        self.assertEqual(after.getpixel((155, 96))[3], 13)
        self.assertEqual(after.getpixel((24, 24))[3], 0)
        self.assertEqual(after.getpixel((176, 96))[3], 0)
        self.assertGreater(after.getpixel((165, 96))[3], 0)
        self.assertLess(after.getpixel((165, 96))[3], before.getpixel((165, 96))[3])

    def test_wings_quadratic_alpha_retains_soft_light_and_fades_cell_edges(self) -> None:
        sheet = Image.new("RGBA", (1024, 1024), (220, 160, 80, 128))
        tile = prepare_tiles(sheet, name="immortality-wings")[0]
        self.assertEqual(tile.getpixel((96, 96))[3], 58)
        self.assertLess(tile.getpixel((12, 96))[3], 3)
        self.assertGreater(tile.getpixel((15, 96))[3], 0)
        self.assertLess(tile.getpixel((15, 96))[3], 58)
        ramp = Image.frombytes("RGBA", (256, 1), bytes(c for a in range(256) for c in (80, 160, 240, a)))
        alpha = clean_alpha(ramp, power=2).getchannel("A").tobytes()
        self.assertEqual(alpha[:13], bytes(13))
        self.assertEqual(alpha[-1], 255)
        self.assertGreater(len(set(alpha)), 150)
        self.assertEqual(tuple(alpha), tuple(sorted(alpha)))

    def test_other_clips_keep_linear_alpha_and_original_painted_extent(self) -> None:
        sheet = marker_sheet()
        for name in ("slash-spark", "hex-shield", "frost-burst", "blast-burst"):
            self.assertEqual(prepare_tiles(sheet, name=name)[8].tobytes(), prepare_tiles(sheet)[8].tobytes())
        with self.assertRaises(ValueError):
            prepare_tiles(sheet, name="unknown")

    def test_native_premultiplied_bytes_convert_to_straight_png_alpha(self) -> None:
        raw = bytes((100, 50, 25, 128, 1, 2, 3, 0, 20, 30, 40, 255))
        self.assertEqual(straight_rgba(raw), bytes((199, 100, 50, 128, 0, 0, 0, 0, 20, 30, 40, 255)))
        with self.assertRaises(ValueError):
            straight_rgba(b"bad")


class NativeCompositorTests(unittest.TestCase):
    def test_real_frame_pixels_preserve_alpha_position_order_and_lighting(self) -> None:
        tiles = prepare_tiles(marker_sheet())
        clip, proof = render_tiles("slash-spark", tiles)
        self.assertEqual((clip.name, clip.fps, clip.loop), ("slash-spark", 20, False))
        self.assertEqual(tuple(f.index for f in clip.frames), tuple(range(16)))
        self.assertEqual(proof["nativeFrameCount"], 16)
        self.assertEqual(len(proof["frames"]), 16)
        for index, frame in enumerate(clip.frames):
            self.assertEqual(frame.repeat, 1)
            expected = np.asarray(tiles[index], dtype=np.int16)
            actual = np.frombuffer(frame.pixels, dtype=np.uint8).reshape(192, 192, 4).astype(np.int16)
            np.testing.assert_array_equal(actual[:, :, 3], expected[:, :, 3])
            # Native premultiply truncation + straight-alpha rounding cost at most1.5bytes.
            expected_light = expected[:, :, :3] * (expected[:, :, 3:] / 255)
            actual_light = actual[:, :, :3] * (actual[:, :, 3:] / 255)
            self.assertLessEqual(float(np.abs(actual_light - expected_light).max()), 1.5)
            self.assertEqual(proof["frames"][index]["rgbaSha256"], hashlib.sha256(frame.pixels).hexdigest())
            self.assertEqual(actual[0, 0].tolist(), [0, 0, 0, 0])

    def test_rejects_wrong_tile_count_and_dimensions(self) -> None:
        for tiles in ((), (Image.new("RGBA", (192, 192)),), (Image.new("RGB", (192, 192)),) * 16):
            with self.assertRaises(ValueError):
                render_tiles("slash-spark", tiles)

    def test_identical_native_hold_repeats_expand_back_to_all_source_frames(self) -> None:
        tile = Image.new("RGBA", (192, 192))
        tile.paste((120, 150, 190, 255), (50, 50, 70, 70))
        raw = tile.tobytes()

        def fake_render(_scene, *, frames):
            frames(Frame(0, 16, lambda: raw))
            return SimpleNamespace(frame_count=16)

        with patch("painted_render.PaintedScene.render", fake_render):
            clip, proof = render_tiles("slash-spark", (tile,) * 16)
        self.assertEqual(tuple(f.index for f in clip.frames), tuple(range(16)))
        self.assertEqual(tuple(f.repeat for f in clip.frames), (1,) * 16)
        self.assertEqual(proof["nativeCallbackCount"], 1)
        self.assertEqual(proof["frames"][15]["nativeRepeat"], 16)

    def test_native_configuration_restores_when_render_fails(self) -> None:
        import manimgx as m
        from painted_render import raster_config
        previous = (m.config.pixel_width, m.config.pixel_height, m.config._frame_height,
                    m.config.frame_rate, m.config.background_opacity)
        with self.assertRaisesRegex(ValueError, "sentinel"):
            with raster_config():
                self.assertEqual(m.config.background_opacity, 0)
                raise ValueError("sentinel")
        self.assertEqual(previous, (m.config.pixel_width, m.config.pixel_height, m.config._frame_height,
                                    m.config.frame_rate, m.config.background_opacity))

    def test_cli_reports_invalid_source_without_a_raw_traceback(self) -> None:
        from contextlib import redirect_stderr
        from painted_render import main
        with patch("painted_render.render_source", side_effect=ValueError("sheet must be RGBA")):
            with redirect_stderr(io.StringIO()) as errors, self.assertRaises(SystemExit) as caught:
                main(["--clips", "slash-spark"])
        self.assertEqual(caught.exception.code, 2)
        self.assertIn("sheet must be RGBA", errors.getvalue())

    def test_callback_guards_invalid_timeline_and_buffer(self) -> None:
        tiles = prepare_tiles(marker_sheet())
        for buffer, index, repeat, count in ((b"bad", 0, 1, 16), (bytes(192 * 192 * 4), 1, 1, 16),
                                            (bytes(192 * 192 * 4), 0, 2, 16), (bytes(192 * 192 * 4), 0, 1, 2)):
            def fake_render(_scene, *, frames):
                frames(Frame(index, repeat, lambda: buffer))
                return SimpleNamespace(frame_count=count)
            with self.subTest(index=index, repeat=repeat, count=count), patch("painted_render.PaintedScene.render", fake_render):
                with self.assertRaises(ValueError):
                    render_tiles("slash-spark", tiles)


class PaintedAtlasTests(unittest.TestCase):
    def clips(self) -> tuple[Clip, ...]:
        return tuple(Clip(name, tuple(CapturedFrame(i, 1, tile.tobytes())
                                     for i, tile in enumerate(prepare_tiles(marker_sheet()))), FPS)
                     for name in SOURCES)

    def test_texturepacker_metadata_and_alias_reuse_no_extra_tiles(self) -> None:
        atlas = assemble_atlas(self.clips())
        manifest = atlas.manifest
        self.assertEqual(len(manifest["frames"]), len(SOURCES) * 16)
        self.assertEqual(set(manifest["animations"]), {*SOURCES, "frozen-plate"})
        for name in SOURCES:
            animation = manifest["animations"][name]
            self.assertEqual(animation, {"frames": [f"{name}_{i:03d}" for i in range(16)], "fps": 20, "loop": False})
            self.assertEqual(manifest["attachPoints"][name]["origin"], {"x": 96, "y": 96})
        self.assertEqual(manifest["animations"]["frozen-plate"], {
            "frames": [f"frost-burst_{i:03d}" for i in range(8, 12)], "fps": 20, "loop": True,
        })
        self.assertEqual(manifest["attachPoints"]["room-bloom"]["rim"], {"x": 155.0625, "y": 96})
        self.assertEqual(manifest["attachPoints"]["blast-burst"]["rim"], {"x": 155.0625, "y": 96})
        self.assertEqual(manifest["meta"]["image"], "painted-v2.png")
        for name, indices in HOLD_WINDOWS.items():
            self.assertEqual(manifest["meta"]["holdFrameIndices"][name], list(indices))
        for frame in manifest["frames"].values():
            self.assertFalse(frame["trimmed"])
            self.assertFalse(frame["rotated"])
            self.assertEqual(frame["sourceSize"], {"w": 192, "h": 192})
        validate_atlas(atlas)

    def test_partial_sample_build_does_not_make_missing_frost_alias(self) -> None:
        atlas = assemble_atlas(self.clips()[:2])
        self.assertEqual(set(atlas.manifest["animations"]), {"slash-spark", "hex-shield"})
        validate_atlas(atlas)

    def test_validation_rejects_out_of_bounds_frames_opaque_margin_or_large_png(self) -> None:
        atlas = assemble_atlas(self.clips()[:1])
        bad_frame = {**atlas.manifest["frames"]["slash-spark_000"], "frame": {"x": 99999, "y": 0, "w": 192, "h": 192}}
        bad_manifest = {**atlas.manifest, "frames": {**atlas.manifest["frames"], "slash-spark_000": bad_frame}}
        with self.assertRaisesRegex(ValueError, "bounds"):
            validate_atlas(replace(atlas, manifest=bad_manifest))
        image = Image.open(io.BytesIO(atlas.png)).copy()
        image.putpixel((0, 0), (255, 255, 255, 255))
        encoded = io.BytesIO()
        image.save(encoded, format="PNG")
        with self.assertRaisesRegex(ValueError, "margin"):
            validate_atlas(replace(atlas, png=encoded.getvalue()))
        with self.assertRaisesRegex(ValueError, "bytes"):
            validate_atlas(atlas, max_bytes=1)

    def test_prepare_rejects_empty_source_and_unknown_clip(self) -> None:
        with self.assertRaisesRegex(ValueError, "visible"):
            prepare_tiles(Image.new("RGBA", (1024, 1024)))
        with self.assertRaises(ValueError):
            assemble_atlas((replace(self.clips()[0], name="unknown"),))


if __name__ == "__main__":
    unittest.main()
