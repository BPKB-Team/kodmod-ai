"""Deterministic projections shared by storage, evidence, learning and narration."""

import hashlib
import json
import re
from dataclasses import dataclass

from models.material_document import MaterialBlock, MaterialDocument


def math_speech(latex: str) -> str:
    value = re.sub(r"\\(?:dfrac|tfrac|frac)\{([^{}]*)\}\{([^{}]*)\}", r"\1 dibagi \2", latex)
    value = re.sub(r"\^\{([^{}]*)\}", r" pangkat \1 ", value)
    value = re.sub(r"_\{([^{}]*)\}", r" subskrip \1 ", value)
    value = re.sub(r"\^([a-zA-Z0-9])", r" pangkat \1 ", value)
    value = re.sub(r"_([a-zA-Z0-9])", r" subskrip \1 ", value)
    replacements = {
        "times": " kali ",
        "cdot": " kali ",
        "div": " dibagi ",
        "sqrt": " akar ",
        "pi": " pi ",
        "leq": " kurang dari atau sama dengan ",
        "geq": " lebih dari atau sama dengan ",
    }
    value = re.sub(r"\\([a-zA-Z]+)", lambda m: replacements.get(m[1], m[1]), value)
    value = (
        value.replace("+", " tambah ")
        .replace("=", " sama dengan ")
        .replace("{", "")
        .replace("}", "")
    )
    return " ".join(value.split())


def inline_text(inlines, *, speech=False):
    result = []
    for node in inlines:
        value = (
            math_speech(node.latex)
            if speech and node.type == "math"
            else node.latex
            if node.type == "math"
            else node.text
        )
        for mark, symbol, spoken in [
            ("superscript", "^", "pangkat"),
            ("subscript", "_", "subskrip"),
        ]:
            if mark in node.marks:
                value = f" {spoken} {value} " if speech else f"{symbol}{{{value}}}"
        result.append(value)
    return "".join(result)


def block_text(block: MaterialBlock, *, speech=False):
    if block.type in ("heading", "paragraph"):
        return inline_text(block.inlines, speech=speech)
    if block.type == "math":
        return math_speech(block.latex) if speech else block.latex
    if block.type == "image":
        return " ".join(filter(None, [block.alt, block.caption])) if not block.decorative else ""
    if block.type == "list":
        return "\n".join(inline_text(item, speech=speech) for item in block.items)
    return "\n".join(
        "; ".join(f"{header}: {cell}" for header, cell in zip(block.headers, row, strict=True))
        for row in block.rows
    )


@dataclass(frozen=True)
class MaterialProjection:
    display_blocks: list[dict]
    retrieval_text: str
    speech_text: str
    document_hash: str


def project_material(document: MaterialDocument) -> MaterialProjection:
    raw = document.model_dump(mode="json")
    accepted = [
        b
        for b in document.blocks
        if b.review_state == "accepted" and b.role not in ("frontmatter", "reference", "answer_key")
    ]
    return MaterialProjection(
        raw["blocks"],
        "\n\n".join(block_text(b) for b in accepted),
        "\n\n".join(block_text(b, speech=True) for b in accepted),
        hashlib.sha256(
            json.dumps(raw, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()
        ).hexdigest(),
    )


def legacy_document(content: str) -> MaterialDocument:
    # Do not infer missing chemical subscripts or exponent glyphs from legacy text.
    content = re.sub(r"<!--.*?-->", "", content, flags=re.S)
    # Old imports sometimes contained markup. Strip tags; never execute them.
    content = re.sub(r"<[^>]+>", "", content)
    blocks = []
    role = "instruction"
    for index, part in enumerate(re.split(r"\n\s*\n", content)):
        if not part.strip():
            continue
        heading = re.match(r"^(#{1,6})\s+([^\n]+)$", part.strip())
        label = heading[2] if heading else part.strip().split("\n", 1)[0]
        if re.match(
            r"^(?:daftar isi|prakata|kata pengantar|identitas modul|tujuan pembelajaran)\b",
            label,
            re.I,
        ):
            role = "frontmatter"
        elif re.match(r"^(?:kunci jawaban|jawab(?:an)?|answer key)\b", label, re.I):
            role = "answer_key"
        elif re.match(r"^(?:daftar pustaka|referensi|bibliography)\b", label, re.I):
            role = "reference"
        elif heading:
            role = "instruction"
        blocks.append(
            MaterialBlock(
                id=f"legacy-{index}",
                role=role,
                type="heading" if heading else "paragraph",
                level=len(heading[1]) if heading else None,
                inlines=[{"text": heading[2] if heading else part.strip()}],
                review_origin="legacy_unverified",
                provenance={"method": "legacy"},
            )
        )
    return MaterialDocument(blocks=blocks)


def material_document(material) -> MaterialDocument:
    return (
        MaterialDocument.model_validate(material.document)
        if getattr(material, "document", None) is not None
        else legacy_document(material.content)
    )


async def material_values(session, class_id, body, previous=None):
    """Resolve one canonical source; preserve old revisions before any mutation."""
    from fastapi import HTTPException

    from api.material_assets import validate_document_assets
    from database.models import MaterialRevision

    if previous is not None:
        if body.expected_version is not None and body.expected_version != previous.content_version:
            raise HTTPException(
                409, "Materi sudah berubah. Muat revisi terbaru sebelum menyimpan draft ini."
            )
        if body.document is not None and body.expected_version is None:
            raise HTTPException(409, "Sertakan versi materi sebelum menyimpan dokumen.")
    document = body.document.model_copy(deep=True) if body.document is not None else None
    if document is not None:
        await validate_document_assets(session, class_id, document)
        if previous is not None:
            old = {b.id: b for b in material_document(previous).blocks}
            for block in document.blocks:
                before = old.get(block.id)
                if before:
                    # Original location/method are immutable attribution. Edits refer to new revision.
                    block.provenance = before.provenance.model_copy(deep=True)
                    if block.model_dump(
                        exclude={"provenance", "review_state", "confidence"}
                    ) != before.model_dump(exclude={"provenance", "review_state", "confidence"}):
                        block.provenance.edited = True
        content = project_material(document).retrieval_text
        # Display-only drafts remain saveable even if accepted evidence is empty.
        if not content:
            content = "\n\n".join(block_text(b) for b in document.blocks)
    else:
        content = body.content
    values = body.model_dump(exclude={"expected_version", "content", "document"})
    values.update(content=content, document=document.model_dump(mode="json") if document else None)
    if previous is not None:
        changed = any(
            getattr(previous, key) != values[key]
            for key in ("content", "document", "source_filename", "source_import_id")
        )
        if changed:
            from sqlalchemy import select

            existing = await session.scalar(
                select(MaterialRevision.id).where(
                    MaterialRevision.material_id == previous.id,
                    MaterialRevision.content_version == previous.content_version,
                )
            )
            if existing is None:
                session.add(
                    MaterialRevision(
                        material_id=previous.id,
                        content_version=previous.content_version,
                        content=previous.content,
                        document=getattr(previous, "document", None),
                        source_import_id=previous.source_import_id,
                        source_filename=previous.source_filename,
                    )
                )
            previous.content_version += 1
            previous.n_chunks = 0
            previous.rag_status = "pending"
            previous.rag_error = None
    return values
