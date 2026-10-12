"""Integration checks on the real generated bundle, not surrogate artwork."""

import hashlib
import json
import unittest
from pathlib import Path

from PIL import Image

from atlas_export import Atlas
from painted_prepare import HOLD_WINDOWS, SOURCES, prepare_tiles, validate_atlas

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "public/sprites/fx"
RAW = ROOT / "assets/_raw/sprite-vfx"


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class PaintedBundleTests(unittest.TestCase):
    def setUp(self) -> None:
        self.manifest = json.loads((OUTPUT / "painted-v2.json").read_text(encoding="utf-8"))
        self.proof = json.loads((OUTPUT / "painted-v2.provenance.json").read_text(encoding="utf-8"))

    def test_real_bundle_has_all_seven_animations_and_96_unique_tiles(self) -> None:
        self.assertEqual(set(self.manifest["animations"]), {*SOURCES, "frozen-plate"})
        self.assertEqual(len(self.manifest["frames"]), 96)
        validate_atlas(Atlas((OUTPUT / "painted-v2.png").read_bytes(), self.manifest))
        self.assertEqual(self.manifest["meta"]["size"], {"w": 1536, "h": 2304})
        self.assertEqual(self.manifest["attachPoints"]["room-bloom"]["rim"], {"x": 155.0625, "y": 96})

    def test_png_manifest_and_pipeline_code_hashes_match_provenance(self) -> None:
        for name in ("png", "manifest"):
            record = self.proof["outputs"][name]
            actual = (OUTPUT / record["path"]).read_bytes()
            self.assertEqual(record["sha256"], digest(actual))
            self.assertEqual(record["bytes"], len(actual))
        for record in self.proof["code"]:
            self.assertEqual(record["sha256"], digest((ROOT / record["path"]).read_bytes()))
        self.assertEqual(self.proof["renderer"]["name"], "ManimGX")
        self.assertIn("Frame.pixels()", self.proof["renderer"]["api"])
        self.assertEqual(self.proof["renderer"]["backgroundOpacity"], 0)

    def test_source_sha_prepared_cells_and_actual_tiles_are_all_linked(self) -> None:
        with Image.open(OUTPUT / "painted-v2.png") as atlas:
            for clip in self.proof["clips"]:
                self.assertEqual(clip["nativeFrameCount"], 16)
                self.assertEqual(clip["source"]["path"], SOURCES[clip["name"]])
                source = RAW / clip["source"]["path"]
                self.assertEqual(clip["source"]["sha256"], digest(source.read_bytes()))
                self.assertEqual(clip["source"]["bytes"], source.stat().st_size)
                with Image.open(source) as sheet:
                    prepared = prepare_tiles(sheet, name=clip["name"])
                    self.assertEqual(clip["preparationProfile"]["alphaPower"],
                                     {"room-bloom": 4, "immortality-wings": 2}.get(clip["name"], 1))
                    for index, record in enumerate(clip["source"]["frames"]):
                        self.assertEqual(record["index"], index)
                        self.assertEqual(record["cell"], {"x": index % 4 * 256, "y": index // 4 * 256, "w": 256, "h": 256})
                        cell = sheet.crop((index % 4 * 256, index // 4 * 256, (index % 4 + 1) * 256, (index // 4 + 1) * 256))
                        self.assertEqual(record["sourceCellRgbaSha256"], digest(cell.tobytes()))
                self.assertEqual(len(clip["frames"]), 16)
                for index, frame in enumerate(clip["frames"]):
                    key = f"{clip['name']}_{index:03d}"
                    rect = self.manifest["frames"][key]["frame"]
                    tile = atlas.crop((rect["x"], rect["y"], rect["x"] + 192, rect["y"] + 192))
                    with self.subTest(frame=key):
                        self.assertEqual(frame["index"], index)
                        self.assertEqual(frame["repeat"], 1)
                        self.assertEqual(frame["rgbaSha256"], digest(tile.tobytes()))
                        self.assertEqual(frame["preparedRgbaSha256"], digest(prepared[index].tobytes()))
                        self.assertEqual(len(frame["nativePremultipliedRgbaSha256"]), 64)
                        self.assertLessEqual(frame["maxCompositedChannelError"], 1.5)
                        self.assertGreater(len(set(tile.getchannel("A").tobytes())), 8)

    def test_protection_windows_exclude_breakup_frames(self) -> None:
        for clip in self.proof["clips"]:
            indices = HOLD_WINDOWS.get(clip["name"])
            if indices:
                self.assertEqual((clip["holdStart"], clip["holdEnd"]), (indices[0], indices[-1]))
            else:
                self.assertIsNone(clip["holdStart"])
                self.assertIsNone(clip["holdEnd"])
        alias = self.manifest["animations"]["frozen-plate"]
        self.assertEqual(alias, {"frames": [f"frost-burst_{i:03d}" for i in range(8, 12)], "fps": 20, "loop": True})
        self.assertEqual(self.proof["aliases"]["frozen-plate"]["sourceIndices"], [8, 9, 10, 11])
        self.assertEqual(HOLD_WINDOWS["immortality-wings"], (6, 7, 8, 9))

    def test_provenance_discloses_source_art_touching_cell_edges(self) -> None:
        edge_counts = tuple(frame["sourceEdgePixelsAboveAlphaFloor"]
                            for clip in self.proof["clips"] for frame in clip["source"]["frames"])
        self.assertGreater(max(edge_counts), 0)
        self.assertIn("cannot restore cropped source art", self.proof["preparation"]["sourceBoundaryCaveat"])
        self.assertFalse(self.proof["preparation"]["recenter"])


if __name__ == "__main__":
    unittest.main()
