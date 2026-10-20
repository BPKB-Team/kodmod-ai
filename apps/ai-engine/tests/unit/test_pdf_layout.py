"""Synthetic geometry with known glyphs and mixed native/image content."""

from io import BytesIO

import pytest
from PIL import Image, ImageDraw
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

from api import pdf_regions
from api.material_document import block_text, project_material
from api.pdf_layout import extract_pdf_layout


def make_pdf(draw):
    output = BytesIO()
    c = canvas.Canvas(output, pagesize=(600, 800))
    draw(c)
    c.save()
    return output.getvalue()


def test_formula_baseline_is_preserved():
    def draw(c):
        c.setFont("Helvetica", 14)
        c.drawString(50, 700, "a")
        c.setFont("Helvetica", 9)
        c.drawString(58, 708, "p+q")
        c.setFont("Helvetica", 14)
        c.drawString(50, 650, "CO(NH")
        c.setFont("Helvetica", 9)
        c.drawString(96, 646, "2")
        c.setFont("Helvetica", 14)
        c.drawString(102, 650, ")")
        c.setFont("Helvetica", 9)
        c.drawString(108, 646, "2")

    result = extract_pdf_layout(make_pdf(draw), first_page=1, last_page=1)
    text = project_material(result).retrieval_text
    assert "a^{p+q}" in text and "CO(NH_{2})_{2}" in text
    assert all(b.provenance.page == 1 for b in result.blocks)


def test_mixed_page_recovers_image_table(monkeypatch):
    image = Image.new("RGB", (350, 150), "white")
    ImageDraw.Draw(image).text((5, 5), "Planet | Periode\nBumi | 365 hari", fill="black")

    def draw(c):
        c.drawString(50, 700, "Paragraf native yang sudah terbaca harus tetap dipertahankan.")
        c.drawImage(ImageReader(image), 50, 400, width=350, height=150)

    seen = []

    def ocr(data, *, page_index, bbox):
        seen.append(bbox)
        return pdf_regions.RegionExtraction(text="Planet | Periode\nBumi | 365 hari", confidence=90)

    monkeypatch.setattr(pdf_regions, "recognize_region", ocr)
    result = extract_pdf_layout(make_pdf(draw), first_page=1, last_page=1, allow_ocr=True)
    assert len(seen) == 1
    assert any(
        "365 hari" in block_text(b) and b.review_state == "needs_review" for b in result.blocks
    )
    assert any(b.type == "image" and b.review_state == "needs_review" for b in result.blocks)
    assert "365 hari" not in project_material(result).retrieval_text
    assert "Paragraf native" in project_material(result).retrieval_text


def test_skips_ocr_for_image_region_with_dense_native_text_layer(monkeypatch):
    image = Image.new("RGB", (350, 150), "white")

    def draw(c):
        c.drawImage(ImageReader(image), 50, 400, width=350, height=150)
        c.setFont("Helvetica", 12)
        c.drawString(60, 500, "Lapisan teks PDF ini sudah dapat diekstrak secara langsung.")
        c.drawString(60, 482, "OCR ulang pada gambar yang sama hanya membuang waktu.")

    def unexpected_ocr(*args, **kwargs):
        raise AssertionError("A dense native text layer should suppress duplicate OCR")

    monkeypatch.setattr(pdf_regions, "recognize_region", unexpected_ocr)
    result = extract_pdf_layout(make_pdf(draw), first_page=1, last_page=1, allow_ocr=True)

    image_block = next(block for block in result.blocks if block.type == "image")
    assert any("OCR dilewati" in warning for warning in image_block.warnings)
    assert "Lapisan teks PDF" in project_material(result).retrieval_text


def test_reading_order_two_columns():
    def draw(c):
        for n in range(5):
            c.drawString(40, 700 - n * 20, f"Kiri {n} penjelasan")
            c.drawString(340, 700 - n * 20, f"Kanan {n} penjelasan")

    texts = [
        block_text(b) for b in extract_pdf_layout(make_pdf(draw), first_page=1, last_page=1).blocks
    ]
    assert texts.index("Kiri 4 penjelasan") < texts.index("Kanan 0 penjelasan")


def test_region_merge_avoids_duplicate_text(monkeypatch):
    from api.pdf_layout import text_overlap

    assert text_overlap("Planet Bumi 365 hari", "Planet Bumi 365 hari")
    assert not text_overlap("Penjelasan orbit", "Data table periode planet")


def test_bounds_and_scan_review(monkeypatch):
    from api import pdf_ocr

    monkeypatch.setattr(
        pdf_ocr,
        "recognize_page",
        lambda *a: {"text": "Isi hasil scan perlu ditinjau guru.", "confidence": 80},
    )
    value = extract_pdf_layout(
        make_pdf(lambda c: c.showPage()), first_page=1, last_page=1, allow_ocr=True
    )
    assert value.blocks and all(b.review_state == "needs_review" for b in value.blocks)
    with pytest.raises(ValueError):
        extract_pdf_layout(make_pdf(lambda c: c.showPage()), first_page=1, last_page=151)


def test_fraction_layout_is_review_required_with_original_region():
    def draw(c):
        c.setFont("Helvetica", 14)
        c.drawString(50, 700, "a =")
        c.setFont("Helvetica", 9)
        c.drawString(80, 708, "1")
        c.drawString(80, 694, "p")
        c.line(78, 703, 90, 703)

    value = extract_pdf_layout(make_pdf(draw), first_page=1, last_page=1)
    assert any(b.type == "image" and b.review_state == "needs_review" for b in value.blocks)
    assert any(b.type == "paragraph" and b.review_state == "needs_review" for b in value.blocks)


def test_table_glyphs_preserve_subscripts():
    def draw(c):
        for y in (700, 675, 650):
            c.line(50, y, 350, y)
        for x in (50, 200, 350):
            c.line(x, 650, x, 700)
        c.setFont("Helvetica", 12)
        c.drawString(60, 682, "Rumus")
        c.drawString(210, 682, "Nama")
        c.drawString(60, 658, "CO(NH")
        c.setFont("Helvetica", 8)
        c.drawString(100, 654, "2")
        c.setFont("Helvetica", 12)
        c.drawString(106, 658, ")")
        c.setFont("Helvetica", 8)
        c.drawString(111, 654, "2")
        c.setFont("Helvetica", 12)
        c.drawString(210, 658, "Urea")

    value = extract_pdf_layout(make_pdf(draw), first_page=1, last_page=1)
    table = next(b for b in value.blocks if b.type == "table")
    assert "CO(NH_{2})_{2}" in table.rows[0][0]
    assert table.rows[0][1] == "Urea"
