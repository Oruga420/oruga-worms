"""Pure preparation tests; no Blender, network or external model required."""
import importlib.util
import json
from pathlib import Path
from types import ModuleType

import pytest
from PIL import Image


def load_module() -> ModuleType:
    path = Path(__file__).with_name('prepare_asset.py')
    spec = importlib.util.spec_from_file_location('prepare_asset', path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_visible_alpha_and_spans_are_identical() -> None:
    module = load_module()
    source = Image.new('RGBA', (8, 6), (90, 100, 120, 0))
    source.putpixel((2, 2), (90, 100, 120, 255))
    source.putpixel((3, 2), (90, 100, 120, 129))
    source.putpixel((4, 2), (90, 100, 120, 128))
    source.putpixel((5, 3), (90, 100, 120, 255))
    image, occupancy = module.prepare(source, exposure=1.0)
    assert image.size == (4, 2)
    assert occupancy == {'width': 4, 'height': 2, 'spans': [
        {'y': 0, 'x0': 0, 'x1': 1}, {'y': 1, 'x0': 3, 'x1': 3}]}
    occupied = {(x, span['y']) for span in occupancy['spans']
                for x in range(span['x0'], span['x1'] + 1)}
    visible = {(x, y) for y in range(image.height) for x in range(image.width)
               if image.getpixel((x, y))[3] == 255}
    assert visible == occupied
    assert source.size == (8, 6)


def test_transparent_source_is_rejected() -> None:
    module = load_module()
    with pytest.raises(ValueError, match='empty'):
        module.prepare(Image.new('RGBA', (4, 4)), exposure=1.0)


@pytest.mark.parametrize('asset', ['spaceship', 'castle', 'kame-house'])
def test_shipped_color_alpha_matches_every_occupancy_pixel(asset: str) -> None:
    folder = Path(__file__).resolve().parents[2] / 'public/scenery/rendered' / asset
    data = json.loads((folder / 'occupancy.json').read_text(encoding='utf8'))
    expected = bytearray(data['width'] * data['height'])
    for span in data['spans']:
        start = span['y'] * data['width'] + span['x0']
        length = span['x1'] - span['x0'] + 1
        expected[start:start + length] = bytes([255]) * length
    with Image.open(folder / 'color.png') as image:
        assert image.size == (data['width'], data['height'])
        assert image.getchannel('A').tobytes() == bytes(expected)
