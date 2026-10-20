"""Glyph/layout extraction with region OCR even when a page has native text."""

import hashlib
import io
import re
import statistics
import uuid
from collections import Counter

import pdfplumber

from api.material_document import block_text, inline_text
from api.pdf_regions import EXTRACTOR_VERSION, region_cache_key
from models.material_document import MaterialBlock, MaterialDocument, MaterialInline


def text_overlap(first, second):
    words = lambda value: set(re.findall(r"\w+", value.lower()))
    a, b = words(first), words(second)
    return bool(a and b and len(a & b) / min(len(a), len(b)) >= 0.85)


def glyph_lines(chars):
    # Full-size glyphs establish a baseline; nearby smaller glyphs attach to it.
    lines = []
    for char in sorted(chars, key=lambda c: (-c["size"], c["top"], c["x0"])):
        center = (char["top"] + char["bottom"]) / 2
        match = next(
            (
                line
                for line in lines
                if abs(center - line["center"]) <= line["size"] * 0.8
                and abs(char["top"] - line["top"]) <= line["size"] * 0.95
            ),
            None,
        )
        if match is None:
            lines.append(
                {"chars": [char], "size": char["size"], "center": center, "top": char["top"]}
            )
        else:
            match["chars"].append(char)
    segments = []
    for line in lines:
        current = []
        previous = None
        for char in sorted(line["chars"], key=lambda c: c["x0"]):
            if previous and char["x0"] - previous["x1"] > max(30, line["size"] * 3):
                segments.append(current)
                current = []
            current.append(char)
            previous = char
        if current:
            segments.append(current)
    # A stable central gutter on several lines implies columns; otherwise use rows.
    mids = [(min(c["x0"] for c in seg) + max(c["x1"] for c in seg)) / 2 for seg in segments]
    if len(segments) >= 6:
        sorted_mids = sorted(mids)
        gaps = [
            (sorted_mids[i + 1] - sorted_mids[i], (sorted_mids[i + 1] + sorted_mids[i]) / 2)
            for i in range(len(mids) - 1)
        ]
        gap, split = max(gaps)
        left = [seg for seg, mid in zip(segments, mids, strict=True) if mid < split]
        right = [seg for seg, mid in zip(segments, mids, strict=True) if mid >= split]
        if (
            gap > 80
            and min(len(left), len(right)) >= 3
            and max(max(c["x1"] for c in seg) for seg in left)
            < min(min(c["x0"] for c in seg) for seg in right)
        ):
            return sorted(left, key=lambda seg: min(c["top"] for c in seg)) + sorted(
                right, key=lambda seg: min(c["top"] for c in seg)
            )
    return sorted(segments, key=lambda seg: (min(c["top"] for c in seg), min(c["x0"] for c in seg)))


def inline_glyphs(chars):
    size = max(c["size"] for c in chars)
    baseline = statistics.median(c["bottom"] for c in chars if c["size"] >= size * 0.9)
    inlines = []
    previous = None
    for char in sorted(chars, key=lambda c: c["x0"]):
        mark = []
        if char["size"] < size * 0.85:
            if char["bottom"] < baseline - size * 0.15:
                mark = ["superscript"]
            elif (char["top"] + char["bottom"]) / 2 > baseline - size * 0.38:
                mark = ["subscript"]
        value = char["text"]
        if (
            previous
            and char["x0"] - previous["x1"] > size * 0.2
            and not value.isspace()
            and not previous["text"].isspace()
        ):
            value = " " + value
        if inlines and inlines[-1]["marks"] == mark:
            inlines[-1]["text"] += value
        else:
            inlines.append({"text": value, "marks": mark})
        previous = char
    return inlines


def extract_pdf_layout(
    data: bytes, *, first_page: int, last_page: int, allow_ocr=False
) -> MaterialDocument:
    from api import pdf_ocr, pdf_regions

    source_hash = hashlib.sha256(data).hexdigest()
    blocks = []
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        if (
            len(pdf.pages) > 500
            or not 1 <= first_page <= last_page <= len(pdf.pages)
            or last_page - first_page + 1 > 150
        ):
            raise ValueError("Pilih rentang hingga 150 halaman dari PDF maksimal 500 halaman.")
        for index in range(first_page - 1, last_page):
            page = pdf.pages[index]
            page_blocks = []

            def provenance(box, method):
                return {
                    "source_sha256": source_hash,
                    "page": index + 1,
                    "bbox": tuple(round(float(x), 3) for x in box),
                    "method": method,
                    "extractor_version": EXTRACTOR_VERSION,
                }

            def ident(box, kind):
                return (
                    f"p{index + 1}-{kind}-"
                    + hashlib.sha256(
                        str(tuple(round(float(x), 2) for x in box)).encode()
                    ).hexdigest()[:12]
                )

            tables = page.find_tables()
            table_boxes = []
            for table in tables:
                rows = table.extract()
                if not rows or len(rows) < 2:
                    continue
                # Header and body can have slightly offset ruling lines. Resolve each
                # physical cell into the closest header column rather than shifting values.
                header_cells = [
                    (str(text).strip(), cell)
                    for text, cell in zip(rows[0], table.rows[0].cells, strict=True)
                    if text and str(text).strip() and cell
                ]
                if not header_cells:
                    continue
                centers = [(cell[0] + cell[2]) / 2 for _, cell in header_cells]
                normalized = []
                for source_row in table.rows[1:]:
                    result = [""] * len(header_cells)
                    for cell in source_row.cells:
                        if cell is None:
                            continue
                        cell_chars = [
                            c
                            for c in page.chars
                            if cell[0] <= ((c["x0"] + c["x1"]) / 2) < cell[2]
                            and cell[1] <= ((c["top"] + c["bottom"]) / 2) < cell[3]
                        ]
                        value = (
                            " ".join(
                                inline_text(
                                    [MaterialInline.model_validate(n) for n in inline_glyphs(line)]
                                )
                                for line in glyph_lines(cell_chars)
                            )
                            if cell_chars
                            else ""
                        )
                        if value.strip():
                            slot = min(
                                range(len(centers)),
                                key=lambda n: abs(centers[n] - (cell[0] + cell[2]) / 2),
                            )
                            result[slot] = " ".join(filter(None, [result[slot], value.strip()]))
                    normalized.append(result)
                box = table.bbox
                table_boxes.append(box)
                page_blocks.append(
                    MaterialBlock(
                        id=ident(box, "table"),
                        type="table",
                        headers=[text for text, _ in header_cells],
                        rows=normalized,
                        review_state="needs_review",
                        review_origin="extracted",
                        provenance=provenance(box, "table"),
                        warnings=["Verifikasi header, sel gabungan dan rumus tabel."],
                    )
                )
            chars = [
                char
                for char in page.dedupe_chars().chars
                if not any(
                    box[0] <= char["x0"] < box[2] and box[1] <= char["top"] < box[3]
                    for box in table_boxes
                )
            ]
            for line in glyph_lines(chars):
                box = (
                    min(c["x0"] for c in line),
                    min(c["top"] for c in line),
                    max(c["x1"] for c in line),
                    max(c["bottom"] for c in line),
                )
                if box[2] <= box[0] or box[3] <= box[1]:
                    continue
                inlines = inline_glyphs(line)
                if not "".join(node["text"] for node in inlines).strip():
                    continue
                try:
                    block = MaterialBlock(
                        id=ident(box, "text"),
                        type="paragraph",
                        inlines=inlines,
                        review_origin="extracted",
                        provenance=provenance(box, "native"),
                    )
                except ValueError:
                    # Raw HTML-like document data must not become executable markup.
                    cleaned = (
                        re.sub(r"<[^>]*>", "", "".join(node["text"] for node in inlines))
                        or "Teks perlu ditinjau."
                    )
                    block = MaterialBlock(
                        id=ident(box, "text"),
                        type="paragraph",
                        inlines=[{"text": cleaned}],
                        review_state="needs_review",
                        review_origin="extracted",
                        provenance=provenance(box, "native"),
                        warnings=["Karakter markup dihapus; bandingkan dengan sumber."],
                    )
                marks = {mark for node in block.inlines for mark in node.marks}
                horizontal = [
                    edge
                    for edge in page.edges
                    if edge.get("orientation") == "h"
                    and 2 < edge["x1"] - edge["x0"] < 100
                    and box[0] <= edge["x0"] < box[2]
                    and box[1] - 2 <= edge["top"] <= box[3] + 2
                ]
                if (
                    {"superscript", "subscript"}.issubset(marks)
                    or "√" in block_text(block)
                    or horizontal
                ):
                    block.review_state = "needs_review"
                    block.warnings.append(
                        "Tata letak rumus bertingkat belum pasti; bandingkan dengan region sumber."
                    )
                    image_box = (
                        max(0, box[0] - 2),
                        max(0, box[1] - 2),
                        min(page.width, box[2] + 2),
                        min(page.height, box[3] + 2),
                    )
                    page_blocks.append(
                        MaterialBlock(
                            id=ident(image_box, "formula"),
                            type="image",
                            asset_id=uuid.uuid5(
                                uuid.NAMESPACE_URL, region_cache_key(data, index, image_box)
                            ),
                            review_state="needs_review",
                            review_origin="extracted",
                            provenance=provenance(image_box, "native"),
                            warnings=["Region rumus asli untuk peninjauan."],
                        )
                    )
                page_blocks.append(block)
            images = []
            for image in page.images:
                box = (
                    max(0, image["x0"]),
                    max(0, image["top"]),
                    min(page.width, image["x1"]),
                    min(page.height, image["bottom"]),
                )
                if (box[2] - box[0]) * (box[3] - box[1]) < 400 or box in images:
                    continue
                images.append(box)
                aid = uuid.uuid5(uuid.NAMESPACE_URL, region_cache_key(data, index, box))
                warning = "Gambar belum dideskripsikan. Tinjau region sumber sebelum disetujui."
                page_blocks.append(
                    MaterialBlock(
                        id=ident(box, "image"),
                        type="image",
                        asset_id=aid,
                        review_state="needs_review",
                        review_origin="extracted",
                        provenance=provenance(box, "native"),
                        warnings=[warning],
                    )
                )
                if allow_ocr:
                    try:
                        result = pdf_regions.recognize_region(data, page_index=index, bbox=box)
                    except Exception:
                        page_blocks[-1].warnings.append(
                            "OCR region gagal; sumber gambar tetap perlu ditinjau."
                        )
                        continue
                    if result.text.strip() and not any(
                        text_overlap(result.text, block_text(b)) for b in page_blocks
                    ):
                        page_blocks.append(
                            MaterialBlock(
                                id=ident(box, "ocr"),
                                type="paragraph",
                                inlines=[{"text": re.sub(r"<[^>]*>", "", result.text)}],
                                review_state="needs_review",
                                review_origin="extracted",
                                confidence=result.confidence / 100
                                if result.confidence is not None
                                else None,
                                provenance=provenance(box, "ocr"),
                                warnings=result.warnings,
                            )
                        )
            if not chars and not tables and not images and allow_ocr:
                result = pdf_ocr.recognize_page(data, index)
                text = result["text"].strip()
                if text:
                    box = (0, 0, page.width, page.height)
                    page_blocks.append(
                        MaterialBlock(
                            id=ident(box, "scan"),
                            type="paragraph",
                            inlines=[{"text": re.sub(r"<[^>]*>", "", text)}],
                            review_state="needs_review",
                            review_origin="extracted",
                            confidence=result["confidence"] / 100
                            if result["confidence"] is not None
                            else None,
                            provenance=provenance(box, "ocr"),
                            warnings=["OCR halaman perlu tinjauan guru."],
                        )
                    )
            blocks.extend(page_blocks)
            if sum(len(block_text(b)) for b in blocks) > 100000:
                raise ValueError(
                    "Teks melebihi 100.000 karakter. Pilih rentang halaman yang lebih kecil."
                )
    if last_page - first_page >= 2:
        repeated = Counter(
            block_text(b).strip()
            for b in blocks
            if b.type == "paragraph"
            and b.provenance.bbox
            and (b.provenance.bbox[1] < 45 or b.provenance.bbox[3] > 750)
        )
        for block in blocks:
            if repeated[block_text(block).strip()] > (last_page - first_page + 1) / 2:
                block.role = "frontmatter"
                block.review_state = "excluded"
    return MaterialDocument(blocks=blocks)
