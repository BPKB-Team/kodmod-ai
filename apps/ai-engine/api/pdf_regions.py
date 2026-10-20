"""Bounded source-region rendering, OCR and deterministic cache identities."""

import hashlib
import json
import math
from contextlib import closing
from dataclasses import asdict, dataclass, field
from io import BytesIO

import pypdfium2 as pdfium
from PIL import Image

from config.settings import settings

EXTRACTOR_VERSION = "layout-v1"


@dataclass(frozen=True)
class RegionExtraction:
    text: str = ""
    confidence: float | None = None
    method: str = "ocr"
    warnings: list[str] = field(default_factory=list)
    needs_review: bool = True


def region_cache_key(data, page_index, bbox, *, model="ocr", prompt="region-v1"):
    return hashlib.sha256(
        json.dumps(
            [hashlib.sha256(data).hexdigest(), page_index, bbox, EXTRACTOR_VERSION, model, prompt],
            sort_keys=True,
        ).encode()
    ).hexdigest()


def render_region(
    data: bytes, *, page_index: int, bbox: tuple[float, float, float, float]
) -> bytes:
    with pdfium.PdfDocument(data) as document, closing(document[page_index]) as page:
        width, height = page.get_size()
        if not all(math.isfinite(x) for x in bbox) or not (
            0 <= bbox[0] < bbox[2] <= width and 0 <= bbox[1] < bbox[3] <= height
        ):
            raise ValueError("Region outside page")
        scale = min(3, math.sqrt(settings.OCR_MAX_PIXELS / (width * height)))
        with closing(page.render(scale=scale)) as bitmap, bitmap.to_pil() as image:
            with image.crop(tuple(round(x * scale) for x in bbox)) as region:
                output = BytesIO()
                region.save(output, format="PNG")
                return output.getvalue()


def recognize_region(
    data: bytes, *, page_index: int, bbox: tuple[float, float, float, float]
) -> RegionExtraction:
    from pathlib import Path

    from api.pdf_ocr import recognize_image

    identity = region_cache_key(data, page_index, bbox)
    path = settings.UPLOAD_DIR.resolve() / "region-cache" / f"ocr-{identity}.json"
    try:
        if path.is_file():
            return RegionExtraction(**json.loads(path.read_text(encoding="utf-8")))
    except (OSError, ValueError):
        pass
    image = render_region(data, page_index=page_index, bbox=bbox)
    with Image.open(BytesIO(image)) as region:
        result = recognize_image(region)
    extracted = RegionExtraction(
        text=result["text"],
        confidence=result["confidence"],
        warnings=["Tinjau teks gambar, hubungan tabel dan rumus sebelum digunakan."],
    )
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(asdict(extracted)), encoding="utf-8")
    except OSError:
        pass  # OCR has no paid retry; read-only evaluation remains usable.
    return extracted
