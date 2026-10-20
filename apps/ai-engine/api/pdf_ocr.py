"""Bounded server-side OCR; no uploaded paths or arguments are sent to a shell."""

import csv
import io
import math
import shutil
import subprocess
import tempfile
from contextlib import closing
from pathlib import Path

from config.settings import settings


def recognize_page(data: bytes, index: int):
    import pypdfium2 as pdfium  # type: ignore[import-untyped]

    executable = shutil.which("tesseract")
    if executable is None:
        raise RuntimeError("OCR runtime unavailable")

    with pdfium.PdfDocument(data) as document:
        with closing(document[index]) as page:
            width, height = page.get_size()
            if width <= 0 or height <= 0:
                raise ValueError("Ukuran halaman PDF tidak valid.")
            scale = min(3, math.sqrt(settings.OCR_MAX_PIXELS / (width * height)))
            with closing(page.render(scale=scale)) as bitmap, bitmap.to_pil() as image:
                return recognize_image(image)


def recognize_image(image):
    executable = shutil.which("tesseract")
    if executable is None:
        raise RuntimeError("OCR runtime unavailable")
    with tempfile.TemporaryDirectory(prefix="kodmod-ocr-") as folder:
        path = Path(folder) / "region.png"
        image.save(path)
        process = subprocess.run(  # noqa: S603 - PATH lookup, argument list, and no shell
            [
                executable,
                str(path),
                "stdout",
                "-l",
                settings.OCR_LANGUAGES,
                "--oem",
                "1",
                "--psm",
                "3",
                "tsv",
            ],
            capture_output=True,
            timeout=settings.OCR_PAGE_TIMEOUT,
            check=True,
        )
    words = list(csv.DictReader(io.StringIO(process.stdout.decode("utf-8")), delimiter="\t"))
    lines: dict[tuple[str | None, ...], list[str]] = {}
    confidence: list[float] = []
    for word in words:
        value = word.get("text", "").strip()
        if word.get("level") != "5" or not value:
            continue
        key = tuple(word.get(field) for field in ["block_num", "par_num", "line_num"])
        lines.setdefault(key, []).append(value)
        score = float(word.get("conf", "-1"))
        if score >= 0:
            confidence.append(score)
    return {
        "text": "\n".join(" ".join(line) for line in lines.values()),
        "confidence": round(sum(confidence) / len(confidence), 1) if confidence else None,
    }
