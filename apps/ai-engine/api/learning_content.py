"""Canonical accepted blocks, lesson units and evidence partitions (blocks-v1)."""

import hashlib
import re

from fastapi import HTTPException

from api.material_document import block_text, material_document, math_speech, project_material
from models.material_document import MaterialDocument

PARTITIONER_VERSION = "blocks-v1"
METADATA = re.compile(
    r"^\s*(?:judul(?:\s+modul)?|mata\s+pelajaran|nama\s+(?:siswa|penulis)|kelas\s*[:0-9x]|identitas\s+modul|daftar\s+isi|kunci\s+jawaban|copyright|isbn|©)",
    re.I,
)


def is_learning_text(text):
    text = re.sub(r"<!--.*?-->", "", text, flags=re.S).strip()
    lines = [
        line
        for line in text.splitlines()
        if line.strip()
        and not line.lstrip().startswith("#")
        and not METADATA.match(line)
        and not re.search(r"\.{3,}\s*\d+\s*$", line)
    ]
    clean = " ".join(lines)
    words = re.findall(r"[^\W\d_]+", clean.lower())
    return len(words) >= 7 and len(set(words)) >= 4


def meaningful(block):
    if block.type == "heading":
        return False
    if block.type == "math":
        return bool(re.search(r"[=<>]|\\(?:frac|sqrt)|\^", block.latex))
    if block.type == "table":
        return bool(
            block.rows
            and any(any(cell.strip() for cell in row) for row in block.rows)
            and any(h.strip() for h in block.headers)
        )
    if block.type == "image":
        return not block.decorative and is_learning_text(block.alt)
    return is_learning_text(block_text(block)) or bool(
        re.search(r"[a-zA-Z][_^]\{[^{}]+\}.*=", block_text(block))
    )


def accepted_learning_blocks(document: MaterialDocument):
    allowed = [
        b
        for b in document.blocks
        if b.review_state == "accepted" and b.role not in ("answer_key", "frontmatter", "reference")
    ]
    bodies = [b for b in allowed if b.role != "exercise" and meaningful(b)]
    if not bodies:
        return []
    return [
        b
        for b in allowed
        if b.type == "heading"
        or (
            block_text(b).strip()
            and not METADATA.match(block_text(b))
            and not re.search(r"\.{3,}\s*\d+\s*$", block_text(b))
        )
    ]


def _pieces(block, limit):
    if block.type == "table":
        rows = []
        length = 0
        for row in block.rows:
            line = "; ".join(f"{h}: {c}" for h, c in zip(block.headers, row, strict=True))
            if rows and length + len(line) > limit:
                yield "\n".join(rows), math_speech("\n".join(rows))
                rows = []
                length = 0
            rows.append(line)
            length += len(line) + 1
        if rows:
            yield "\n".join(rows), math_speech("\n".join(rows))
        return
    text = block_text(block)
    speech = block_text(block, speech=True)
    if (
        len(text) <= limit
        or block.type in ("math", "image")
        or any(n.type == "math" or n.marks for n in block.inlines)
    ):
        yield text, speech
        return
    # Exact source text is retained. Split plain prose only, never a marked formula.
    start = 0
    while start < len(text):
        end = min(start + limit, len(text))
        if end < len(text):
            boundary = max(
                text.rfind(". ", start + limit // 3, end), text.rfind("\n", start + limit // 3, end)
            )
            if boundary < 0:
                boundary = text.rfind(" ", start + limit // 3, end)
            if boundary >= 0:
                end = boundary + 1
        piece = text[start:end]
        yield piece, piece
        start = end


def build_learning_units(document: MaterialDocument, *, limit=2400):
    if limit < 1:
        raise ValueError("Learning unit limit must be positive")
    blocks = accepted_learning_blocks(document)
    units = []
    parts: list[str] = []
    spoken: list[str] = []
    ids: list[str] = []
    spans: list[dict] = []
    title = None
    heading = None

    def flush():
        nonlocal parts, spoken, ids, spans
        if not parts:
            return
        text = "\n\n".join(parts)
        body = {
            "text": text,
            "retrieval_text": text,
            "speech_text": "\n\n".join(spoken),
            "title": title,
            "block_ids": list(dict.fromkeys(([heading.id] if heading else []) + ids)),
            "spans": spans.copy(),
            "document_hash": project_material(document).document_hash,
            "partitioner_version": PARTITIONER_VERSION,
        }
        body["base_id"] = hashlib.sha256(
            ("|".join(body["block_ids"]) + "\n" + text).encode()
        ).hexdigest()[:24]
        units.append(body)
        parts = []
        spoken = []
        ids = []
        spans = []

    for block in blocks:
        if block.type == "heading":
            flush()
            title = block_text(block)
            heading = block
            continue
        for text, speech in _pieces(block, limit):
            if parts and sum(len(p) for p in parts) + len(text) > limit:
                flush()
            parts.append(text)
            spoken.append(speech)
            ids.append(block.id)
            spans.append({"block_id": block.id, **block.provenance.model_dump(mode="json")})
    flush()
    return units


def material_learning_units(material, *, require_content=False):
    units = build_learning_units(material_document(material))
    if require_content and not units:
        raise HTTPException(
            409,
            {
                "code": "insufficient_learning_content",
                "message": "Belum ada isi pembelajaran yang dapat digunakan. Minta guru meninjau penjelasan, rumus atau tabel sumber. Materi asli tetap dapat dibaca.",
            },
        )
    return units


def learning_unit_source(
    unit: dict,
    material,
    class_id,
    *,
    approved_concept_ids: list[str] | None = None,
) -> dict:
    """Preserve canonical block/page/version identity when a unit enters a quiz."""
    base_id = str(unit.get("base_id") or "")
    return {
        "id": base_id,
        "evidence_id": base_id,
        "chunk_id": base_id,
        "text": unit.get("retrieval_text") or unit.get("text") or "",
        "source": material.source_filename or material.title,
        "material_title": material.title,
        "section_title": unit.get("title"),
        "class_id": str(class_id),
        "material_id": str(material.id),
        "content_version": material.content_version,
        "mapping_version": material.mapping_version,
        "document_hash": unit.get("document_hash"),
        "block_ids": list(unit.get("block_ids") or []),
        "spans": list(unit.get("spans") or []),
        "approved_concept_ids": list(approved_concept_ids or []),
    }
