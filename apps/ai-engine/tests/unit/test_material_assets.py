"""Assets are decoded, bounded and stripped of private metadata."""

from io import BytesIO

import pytest
from fastapi import HTTPException
from PIL import Image

from api.material_assets import normalize_asset


def test_asset_decode_reencode_discards_metadata():
    source = BytesIO()
    im = Image.new("RGB", (20, 10), "blue")
    exif = Image.Exif()
    exif[270] = "private location"
    im.save(source, format="JPEG", exif=exif)
    data, mime, width, height = normalize_asset(source.getvalue())
    assert mime == "image/jpeg" and (width, height) == (20, 10)
    assert not Image.open(BytesIO(data)).getexif()


@pytest.mark.parametrize("data", [b"<svg></svg>", b"not a png", b"x" * (10 * 1024 * 1024 + 1)])
def test_asset_rejects_fake_svg_and_size(data):
    with pytest.raises(HTTPException) as failure:
        normalize_asset(data)
    assert failure.value.status_code == 422


def test_asset_rejects_pixel_bomb():
    source = BytesIO()
    Image.new("1", (5000, 4001)).save(source, format="PNG")
    with pytest.raises(HTTPException):
        normalize_asset(source.getvalue())
