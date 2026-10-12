"""Crop an inspected GLB render and export exactly matching opaque alpha and row spans."""
import argparse
import json
from pathlib import Path
from typing import Any

from PIL import Image, ImageEnhance


def prepare(source: Image.Image, exposure: float = 1.35) -> tuple[Image.Image, dict[str, Any]]:
    rgba = source.convert('RGBA')
    alpha = rgba.getchannel('A').point(lambda value: 255 if value > 128 else 0)
    bounds = alpha.getbbox()
    if bounds is None:
        raise ValueError('Rendered asset is empty after alpha thresholding')
    cropped_alpha = alpha.crop(bounds)
    rgb = ImageEnhance.Brightness(rgba.convert('RGB').crop(bounds)).enhance(exposure)
    result = rgb.convert('RGBA')
    result.putalpha(cropped_alpha)
    spans = []
    for y in range(result.height):
        start = None
        for x in range(result.width + 1):
            solid = x < result.width and cropped_alpha.getpixel((x, y)) == 255
            if solid and start is None:
                start = x
            elif not solid and start is not None:
                spans.append({'y': y, 'x0': start, 'x1': x - 1})
                start = None
    return result, {'width': result.width, 'height': result.height, 'spans': spans}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--exposure', type=float, default=1.35)
    args = parser.parse_args()
    if not 0.5 <= args.exposure <= 2.0:
        raise ValueError('Exposure must be between 0.5 and 2.0')
    destination = Path(args.output)
    destination.mkdir(parents=True, exist_ok=False)
    with Image.open(args.source) as source:
        image, occupancy = prepare(source, args.exposure)
    image.save(destination / 'color.png', optimize=True)
    (destination / 'occupancy.json').write_text(json.dumps(occupancy, separators=(',', ':')), encoding='utf8')
    (destination / 'source.json').write_text(json.dumps({
        'render': f'{Path(args.source).parent.name}/{Path(args.source).name}', 'alpha_threshold': 128,
        'exposure': args.exposure, 'additional_apertures': [],
        'note': 'Transparent mesh openings retained; no invisible gameplay holes added.'
    }, indent=2), encoding='utf8')


if __name__ == '__main__':
    main()
