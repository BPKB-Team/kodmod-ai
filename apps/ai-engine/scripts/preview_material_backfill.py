"""Create a private, read-only candidate and diff from a material's original PDF."""

from __future__ import annotations

import argparse
import asyncio
import difflib
import json
import sys
import tempfile
from pathlib import Path
from uuid import UUID

from config.settings import settings

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_OUTPUT = REPO_ROOT / ".runtime/material-grounding/backfill-preview.json"


def _block_map(document: dict | None) -> dict[str, dict]:
    if not isinstance(document, dict):
        return {}
    blocks = document.get("blocks")
    if not isinstance(blocks, list):
        return {}
    return {
        str(block["id"]): block
        for block in blocks
        if isinstance(block, dict) and block.get("id") is not None
    }


def _content_shape(block: dict) -> dict:
    return {
        key: value
        for key, value in block.items()
        if key not in {"provenance", "review_state", "confidence", "warnings"}
    }


def _block_summary(block: dict) -> dict:
    from api.material_document import block_text
    from models.material_document import MaterialBlock

    parsed = MaterialBlock.model_validate(block)
    return {"id": parsed.id, "type": parsed.type, "text": block_text(parsed)}


def compare_documents(current_document: dict | None, candidate_document: dict | None) -> dict:
    """Compare document blocks while keeping content edits separate from provenance changes."""
    current = _block_map(current_document)
    candidate = _block_map(candidate_document)
    current_ids, candidate_ids = set(current), set(candidate)
    shared = current_ids & candidate_ids
    changed = sorted(
        block_id
        for block_id in shared
        if _content_shape(current[block_id]) != _content_shape(candidate[block_id])
    )
    provenance_changed = sorted(
        block_id
        for block_id in shared
        if current[block_id].get("provenance") != candidate[block_id].get("provenance")
    )
    return {
        "added_ids": sorted(candidate_ids - current_ids),
        "removed_ids": sorted(current_ids - candidate_ids),
        "changed_ids": changed,
        "provenance_changed_ids": provenance_changed,
        "added_blocks": [
            _block_summary(candidate[block_id]) for block_id in sorted(candidate_ids - current_ids)
        ],
        "removed_blocks": [
            _block_summary(current[block_id]) for block_id in sorted(current_ids - candidate_ids)
        ],
        "changed_blocks": [
            {
                "id": block_id,
                "before": _block_summary(current[block_id]),
                "after": _block_summary(candidate[block_id]),
            }
            for block_id in changed
        ],
    }


def build_preview_report(
    *,
    class_id: str,
    material_id: str,
    content_version: int,
    current_document: dict | None,
    candidate_preview: dict,
    source: dict | None = None,
    current_content: str | None = None,
) -> dict:
    """Build a review-only draft object; this function has no database access."""
    candidate_document = candidate_preview.get("document")
    candidate_content = candidate_preview.get("content", "")
    current_lines = (current_content or "").splitlines()
    candidate_lines = str(candidate_content).splitlines()
    line_diff = list(
        difflib.unified_diff(
            current_lines,
            candidate_lines,
            fromfile="current-material",
            tofile="candidate-extraction",
            lineterm="",
        )
    )
    diff_limit = 2000
    return {
        "schema_version": 1,
        "status": "draft_preview",
        "class_id": class_id,
        "material_id": material_id,
        "base_content_version": content_version,
        "requires_teacher_review": True,
        "apply": False,
        "source": source or {},
        "diff": {
            **compare_documents(current_document, candidate_document),
            "content_lines": line_diff[:diff_limit],
            "content_diff_truncated": len(line_diff) > diff_limit,
        },
        "candidate": {
            "content": candidate_content,
            "document": candidate_document,
            "warnings": list(candidate_preview.get("warnings") or []),
            "page_range": candidate_preview.get("page_range"),
            "extractor_version": _extractor_version(candidate_document),
        },
    }


def source_unavailable_report(*, class_id: str, material_id: str, reason: str) -> dict:
    """Report the missing original without guessing from the legacy plaintext."""
    allowed = {
        "database_not_local",
        "import_not_found",
        "original_file_missing",
        "page_selection_missing",
        "source_extraction_failed",
    }
    safe_reason = reason if reason in allowed else "source_unavailable"
    return {
        "schema_version": 1,
        "status": "source_unavailable"
        if safe_reason != "page_selection_missing"
        else "page_selection_required",
        "class_id": class_id,
        "material_id": material_id,
        "reason": safe_reason,
        "candidate": None,
        "diff": None,
        "apply": False,
    }


def _extractor_version(document: dict | None) -> str | None:
    if not isinstance(document, dict):
        return None
    versions = sorted(
        {
            str(block.get("provenance", {}).get("extractor_version"))
            for block in document.get("blocks", [])
            if isinstance(block, dict) and block.get("provenance", {}).get("extractor_version")
        }
    )
    return ",".join(versions) or None


async def preview_material_backfill(class_id: str, material_id: str) -> dict:
    """Read source metadata and original bytes using a PostgreSQL read-only session."""
    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    from sqlalchemy.pool import NullPool

    from api.material_artifacts import original_path
    from api.material_imports import extract_document
    from database.models import BackgroundJob, ClassMaterial, MaterialImport
    from models.material_document import MaterialDocument
    from scripts.local_database import is_local_database_url

    class_uuid, material_uuid = UUID(class_id), UUID(material_id)
    if not is_local_database_url(settings.DATABASE_URL):
        return source_unavailable_report(
            class_id=str(class_uuid),
            material_id=str(material_uuid),
            reason="database_not_local",
        )
    engine = create_async_engine(
        settings.DATABASE_URL,
        poolclass=NullPool,
        connect_args={"server_settings": {"default_transaction_read_only": "on"}},
    )
    factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with factory() as session:
            material = await session.scalar(
                select(ClassMaterial).where(
                    ClassMaterial.id == material_uuid,
                    ClassMaterial.class_id == class_uuid,
                )
            )
            if material is None or material.source_import_id is None:
                return source_unavailable_report(
                    class_id=str(class_uuid),
                    material_id=str(material_uuid),
                    reason="import_not_found",
                )
            artifact = await session.get(MaterialImport, material.source_import_id)
            if artifact is None or artifact.class_id != class_uuid:
                return source_unavailable_report(
                    class_id=str(class_uuid),
                    material_id=str(material_uuid),
                    reason="import_not_found",
                )
            job = await session.get(BackgroundJob, artifact.job_id)
            result = (job.result or {}) if job else {}
            page_range = result.get("page_range")
            if not isinstance(page_range, dict) or not {
                "first",
                "last",
            } <= set(page_range):
                return source_unavailable_report(
                    class_id=str(class_uuid),
                    material_id=str(material_uuid),
                    reason="page_selection_missing",
                )
            try:
                path = original_path(artifact)
            except Exception:
                return source_unavailable_report(
                    class_id=str(class_uuid),
                    material_id=str(material_uuid),
                    reason="original_file_missing",
                )
            source = {
                "filename": artifact.filename,
                "sha256": artifact.sha256,
                "source_import_id": str(artifact.id),
                "page_range": page_range,
            }
            current_document = (
                MaterialDocument.model_validate(material.document).model_dump(mode="json")
                if material.document
                else None
            )
            current_content = material.content
            content_version = material.content_version
            raw = path.read_bytes()
        try:
            preview = extract_document(
                raw,
                source["filename"],
                first_page=int(page_range["first"]),
                last_page=int(page_range["last"]),
            )
        except Exception:
            return source_unavailable_report(
                class_id=str(class_uuid),
                material_id=str(material_uuid),
                reason="source_extraction_failed",
            )
        if not preview.get("content") or preview.get("preview_type") == "book":
            return source_unavailable_report(
                class_id=str(class_uuid),
                material_id=str(material_uuid),
                reason="page_selection_missing",
            )
        return build_preview_report(
            class_id=str(class_uuid),
            material_id=str(material_uuid),
            content_version=content_version,
            current_document=current_document,
            candidate_preview=preview,
            source=source,
            current_content=current_content,
        )
    finally:
        await engine.dispose()


def _write_private_report(path: str | Path, report: dict) -> Path:
    target = Path(path).resolve()
    private_root = (REPO_ROOT / ".runtime").resolve()
    temp_root = Path(tempfile.gettempdir()).resolve()
    if not any(_is_relative_to(target, root) for root in (private_root, temp_root)):
        raise ValueError(
            "Backfill reports must remain under .runtime/ or the system temp directory"
        )
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return target


def _is_relative_to(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--class-id", required=True)
    parser.add_argument("--material-id", required=True)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    report = asyncio.run(preview_material_backfill(args.class_id, args.material_id))
    output = _write_private_report(args.output, report)
    print(
        json.dumps(
            {
                "status": report["status"],
                "apply": False,
                "output": str(output),
            },
            ensure_ascii=False,
        )
    )
    return 0 if report["status"] == "draft_preview" else 2


if __name__ == "__main__":
    sys.exit(main())
