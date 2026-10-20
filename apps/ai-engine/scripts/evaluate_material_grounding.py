"""Bounded, private evaluation for the material-to-question grounding path."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import sys
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path
from unittest.mock import patch
from uuid import UUID

from agents.question_quality import deterministic_quality_check
from api.learning_content import build_learning_units
from api.material_document import project_material
from api.quiz_policy import QuizPolicy, decide_transition
from config.settings import settings
from models.grounded_question import GroundedQuestion, QuestionQualityReason
from models.material_document import MaterialDocument
from rag.source_bundle import MaterialScope, bundle_from_docs, bundle_from_unit
from tools.learning_trace import LearningTraceEvent

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_MANIFEST = (
    Path(__file__).resolve().parents[1] / "tests/fixtures/material_grounding/manifest.json"
)
DEFAULT_OUTPUT = REPO_ROOT / ".runtime/material-grounding/evaluation.json"
LIVE_LIMIT = 3


def evaluate_fixture(manifest_path: str | Path) -> dict:
    """Run deterministic checks over synthetic structure without providers or a DB."""
    manifest = _load_manifest(manifest_path)
    fixture = manifest["synthetic_fixture"]
    document = MaterialDocument.model_validate(fixture["document"])
    projection = project_material(document)
    units = build_learning_units(document)
    unit = units[0] if units else None
    scope = MaterialScope(
        student_id=UUID("11111111-1111-4111-8111-111111111111"),
        class_id=UUID("22222222-2222-4222-8222-222222222222"),
        material_id=UUID("33333333-3333-4333-8333-333333333333"),
        content_version=1,
        mapping_version=0,
        language="id",
    )
    bundle = bundle_from_unit(unit, scope) if unit else None
    source = bundle.sources[0] if bundle and bundle.sources else None

    projection_markers = fixture["expected_projection_markers"]
    excluded_markers = fixture["excluded_markers"]
    extraction_ok = all(
        marker in projection.retrieval_text for marker in projection_markers
    ) and not any(marker in projection.retrieval_text for marker in excluded_markers)

    expected_ids = fixture["expected_block_ids"]
    expected_evidence = fixture["expected_evidence_markers"]
    evidence_text = source.text if source else ""
    evidence_ok = (
        set(expected_ids) <= set(source.block_ids if source else ())
        and all(marker in evidence_text for marker in expected_evidence)
        and bool(source and source.document_hash and source.spans)
    )

    positive = GroundedQuestion(
        text="Jika a berpangkat p dikalikan a berpangkat q dengan basis sama, bagaimana bentuk pangkat hasilnya?",
        type="reasoning",
        expected_answer="Eksponen dijumlahkan menjadi a^{p+q}.",
        explanation="Gunakan aturan perkalian untuk basis sama.",
        evidence_refs=[source.id] if source else ["missing"],
        objective="Menerapkan aturan perkalian eksponen",
        cognitive_level="application",
    )
    generic = positive.model_copy(
        update={"text": "Jelaskan topik yang ditunjukkan oleh judul modul tersebut."}
    )
    unknown = positive.model_copy(update={"evidence_refs": ["unrecognized-source"]})
    title_only = bundle_from_docs(
        "judul modul",
        scope,
        [{"chunk_id": "metadata-only", "text": "Judul modul: Perkalian dengan basis sama"}],
    )
    metadata_question = positive.model_copy(update={"evidence_refs": ["metadata-only"]})
    decisions = {
        "positive_accepted": deterministic_quality_check(positive, bundle).accepted
        if bundle
        else False,
        "generic_title_rejected": QuestionQualityReason.GENERIC_TITLE
        in deterministic_quality_check(generic, bundle).reasons
        if bundle
        else False,
        "unknown_evidence_rejected": QuestionQualityReason.UNSUPPORTED_ANSWER
        in deterministic_quality_check(unknown, bundle).reasons
        if bundle
        else False,
        "metadata_only_rejected": QuestionQualityReason.NO_LEARNING_CONTENT
        in deterministic_quality_check(metadata_question, title_only).reasons,
    }
    quality_ok = all(decisions.values())

    assessment = decide_transition(
        QuizPolicy(2, "assessment"),
        correct=False,
        action="answer",
        question_closed=False,
    )
    tutor_wrong = decide_transition(
        QuizPolicy(2, "tutor"), correct=False, action="answer", question_closed=False
    )
    tutor_advance = decide_transition(
        QuizPolicy(2, "tutor"), correct=False, action="advance", question_closed=False
    )
    flow_ok = (
        assessment.close_question
        and assessment.available_actions == ["advance"]
        and "advance" in tutor_wrong.available_actions
        and tutor_advance.close_question
    )

    safe_trace = LearningTraceEvent(stage="generation", node="material_grounding.fixture")
    private_fields_rejected = False
    try:
        LearningTraceEvent.model_validate(
            {
                "stage": "generation",
                "node": "material_grounding.fixture",
                "answer_key": "private",
                "prompt": "private",
            }
        )
    except ValueError:
        private_fields_rejected = True
    safe_trace_json = safe_trace.model_dump_json()
    safe_trace_keys = set(json.loads(safe_trace_json))
    private_trace_keys = {"prompt", "answer", "answer_key", "student_answer", "text"}
    trace_has_no_private_content = not safe_trace_keys.intersection(private_trace_keys)
    privacy_ok = private_fields_rejected and trace_has_no_private_content

    metrics = {
        "extraction": {
            "status": "pass" if extraction_ok else "fail",
            "basis": "synthetic-structured-document",
            "markers": projection_markers,
            "excluded_markers_absent": not any(
                marker in projection.retrieval_text for marker in excluded_markers
            ),
        },
        "evidence_recall": {
            "status": "pass" if evidence_ok else "fail",
            "expected_block_ids": expected_ids,
            "recalled_block_ids": [
                block_id for block_id in expected_ids if source and block_id in source.block_ids
            ],
            "expected_markers_recalled": [
                marker for marker in expected_evidence if marker in evidence_text
            ],
            "provenance_present": bool(source and source.document_hash and source.spans),
        },
        "question_quality": {
            "status": "pass" if quality_ok else "fail",
            **decisions,
        },
        "flow": {
            "status": "pass" if flow_ok else "fail",
            "assessment_wrong_answers_can_advance": assessment.available_actions == ["advance"],
            "tutor_wrong_answers_keep_advance": "advance" in tutor_wrong.available_actions,
            "tutor_can_skip_without_retry": tutor_advance.close_question,
        },
        "privacy": {
            "status": "pass" if privacy_ok else "fail",
            "private_fields_rejected": private_fields_rejected,
            "serialized_trace_contains_no_prompt_or_answer": trace_has_no_private_content,
        },
    }
    return {
        "schema_version": 1,
        "mode": "fixture",
        "provider": "none",
        "source_fixture_count": len(manifest["corpus"]["sources"]),
        "metrics": metrics,
        "passed": all(metric["status"] == "pass" for metric in metrics.values()),
    }


async def evaluate_live_local(
    *,
    class_id: str | None,
    material_id: str | None,
    student_id: str | None,
    batches: int,
    questions_per_batch: int,
) -> dict:
    """Evaluate authorized local retrieval and generation using read-only SQL."""
    if not class_id or not material_id or not student_id:
        return {
            "schema_version": 1,
            "mode": "live-local",
            "status": "not_configured",
            "reason": "provide class, material, and enrolled student IDs",
            "metrics": {},
            "database_writes": False,
        }
    if not 1 <= batches <= LIVE_LIMIT or not 1 <= questions_per_batch <= LIVE_LIMIT:
        raise ValueError("live-local is limited to 1–3 batches and 1–3 questions per batch")

    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    from sqlalchemy.pool import NullPool

    from agents.problem_generator import generate_grounded_questions
    from api.learning_content import material_learning_units
    from api.material_service import resolve_tutoring_context
    from database.models import ClassMaterial, Classroom, Enrollment, User
    from rag.retrieval_service import RetrievalRequest, retrieve_sources
    from rag.stores import pgvector_store
    from scripts.local_database import is_local_database_url
    from tools import provider_usage

    class_uuid, material_uuid, student_uuid = UUID(class_id), UUID(material_id), UUID(student_id)
    if not is_local_database_url(settings.DATABASE_URL):
        return {
            "schema_version": 1,
            "mode": "live-local",
            "status": "refused_non_local_database",
            "reason": "live-local evaluation is restricted to loopback and named local Docker database hosts",
            "metrics": {},
            "database_writes": False,
        }
    engine = create_async_engine(
        settings.DATABASE_URL,
        poolclass=NullPool,
        connect_args={"server_settings": {"default_transaction_read_only": "on"}},
    )
    factory = async_sessionmaker(engine, expire_on_commit=False)

    @asynccontextmanager
    async def readonly_session():
        session = factory()
        try:
            yield session
            await session.rollback()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()

    try:
        async with readonly_session() as session:
            student = await session.get(User, student_uuid)
            material = await session.scalar(
                select(ClassMaterial)
                .join(Classroom, Classroom.id == ClassMaterial.class_id)
                .where(
                    ClassMaterial.id == material_uuid,
                    ClassMaterial.class_id == class_uuid,
                    ClassMaterial.published.is_(True),
                    Classroom.is_archived.is_(False),
                )
            )
            if student is None or student.role != "student" or not student.is_active:
                raise ValueError("student_not_available")
            if material is None:
                raise ValueError("published_material_not_available")
            if await session.get(Enrollment, (class_uuid, student_uuid)) is None:
                raise ValueError("student_not_enrolled")
            context = await resolve_tutoring_context(
                session, class_uuid, material_uuid, student, require_ready=True
            )
            units = material_learning_units(material, require_content=True)
            if not units:
                raise ValueError("material_has_no_accepted_learning_units")
            scope = MaterialScope(
                student_id=student_uuid,
                class_id=class_uuid,
                material_id=material_uuid,
                content_version=material.content_version,
                mapping_version=material.mapping_version,
                subject_id=UUID(context["subject_id"]) if context.get("subject_id") else None,
                language="id",
            )
            material_summary = {
                "material_id": str(material.id),
                "content_version": material.content_version,
                "mapping_version": material.mapping_version,
                "unit_count": len(units),
            }

        sampled_units = units[:batches]
        batch_rows = []
        total_sources = 0
        total_questions = 0
        total_valid_refs = 0
        local_source_ids: list[str] = []

        # Retrieval SQL and model usage metering are suppressed here so this
        # evaluator cannot create traces, submissions, mastery or usage rows.
        async def ignore_usage(**_kwargs):
            return None

        with (
            patch.object(pgvector_store, "async_session", readonly_session),
            patch.object(provider_usage, "record_usage", ignore_usage),
        ):
            for index, unit in enumerate(sampled_units):
                query = str(
                    unit.get("title") or unit.get("retrieval_text") or unit.get("text") or ""
                )[:180]
                retrieval = await retrieve_sources(
                    RetrievalRequest(
                        query=query,
                        scope=scope,
                        candidate_k=settings.RAG_TOP_K,
                        final_k=min(settings.RAG_RERANK_TOP_K, settings.RAG_TOP_K),
                    )
                )
                source_ids = {source.id for source in retrieval.bundle.sources}
                total_sources += len(source_ids)
                local_source_ids.extend(source_ids)
                row = {
                    "batch": index + 1,
                    "candidate_count": retrieval.trace.candidate_count,
                    "hydrated_count": retrieval.trace.hydrated_count,
                    "returned_count": retrieval.trace.returned_count,
                    "fallback_reason": retrieval.trace.fallback_reason,
                    "source_ids": sorted(source_ids),
                    "provenance_sources": sum(
                        1
                        for source in retrieval.bundle.sources
                        if source.block_ids
                        and source.spans
                        and source.document_hash
                        and source.content_version == material_summary["content_version"]
                        and source.mapping_version == material_summary["mapping_version"]
                    ),
                }
                if not retrieval.bundle.sources:
                    row["generation_status"] = "no_authorized_evidence"
                    batch_rows.append(row)
                    continue
                batch = await generate_grounded_questions(
                    retrieval.bundle,
                    count=questions_per_batch,
                    difficulty="medium",
                    language="id",
                    topic=query,
                    approved_concepts=context.get("approved_material_concepts", []),
                )
                question_count = len(batch.questions)
                valid_refs = sum(
                    1 for question in batch.questions if set(question.evidence_refs) <= source_ids
                )
                total_questions += question_count
                total_valid_refs += valid_refs
                row.update(
                    generation_status="accepted",
                    question_count=question_count,
                    valid_evidence_refs=valid_refs,
                    prompt_version=batch.prompt_version,
                    prompt_hash=batch.prompt_hash,
                    generation_calls=batch.generation_calls,
                    verification_calls=batch.verification_calls,
                )
                batch_rows.append(row)

        source_ids = sorted(set(local_source_ids))
        provenance_count = sum(row.get("provenance_sources", 0) for row in batch_rows)
        extraction_ok = bool(batch_rows) and provenance_count > 0
        recall_ok = total_questions > 0 and total_valid_refs == total_questions
        quality_ok = total_questions > 0 and all(
            row.get("generation_status") == "accepted" for row in batch_rows
        )
        flow_ok = _flow_check()
        privacy_ok = _privacy_check()
        metrics = {
            "extraction": {
                "status": "pass" if extraction_ok else "fail",
                "basis": "retrieved-canonical-block-provenance",
                "provenance_sources": provenance_count,
            },
            "evidence_recall": {
                "status": "pass" if recall_ok else "fail",
                "generated_questions": total_questions,
                "questions_with_valid_evidence_refs": total_valid_refs,
                "unique_source_ids": source_ids,
            },
            "question_quality": {
                "status": "pass" if quality_ok else "fail",
                "accepted_batches": sum(
                    row.get("generation_status") == "accepted" for row in batch_rows
                ),
                "requested_batches": len(sampled_units),
                "questions_per_batch": questions_per_batch,
                "batch_details": batch_rows,
            },
            "flow": {"status": "pass" if flow_ok else "fail", "policy_version": 2},
            "privacy": {
                "status": "pass" if privacy_ok else "fail",
                "question_and_answer_content_saved": False,
                "database_writes": False,
            },
        }
        return {
            "schema_version": 1,
            "mode": "live-local",
            "status": "complete"
            if all(m["status"] == "pass" for m in metrics.values())
            else "failed",
            "provider": "configured_local_provider",
            "material": material_summary,
            "metrics": metrics,
            "database_writes": False,
        }
    finally:
        await engine.dispose()


def _flow_check() -> bool:
    assessment = decide_transition(
        QuizPolicy(2, "assessment"), correct=False, action="answer", question_closed=False
    )
    tutor = decide_transition(
        QuizPolicy(2, "tutor"), correct=False, action="answer", question_closed=False
    )
    skip = decide_transition(
        QuizPolicy(2, "tutor"), correct=False, action="advance", question_closed=False
    )
    return (
        assessment.close_question
        and assessment.available_actions == ["advance"]
        and "advance" in tutor.available_actions
        and skip.close_question
    )


def _privacy_check() -> bool:
    try:
        LearningTraceEvent.model_validate(
            {"stage": "generation", "node": "material_grounding.live", "answer_key": "private"}
        )
    except ValueError:
        return True
    return False


def _load_manifest(path: str | Path) -> dict:
    value = json.loads(Path(path).read_text(encoding="utf-8"))
    if value.get("schema_version") != 1:
        raise ValueError("Unsupported material-grounding manifest version")
    for source in value.get("corpus", {}).get("sources", []):
        if not re.fullmatch(r"[0-9a-f]{64}", source.get("sha256", "")):
            raise ValueError(f"Source {source.get('id')} has no SHA-256")
        page_range = source.get("imported_pages") or {}
        if (
            not 1
            <= page_range.get("first", 0)
            <= page_range.get("last", 0)
            <= source.get("physical_page_count", 0)
        ):
            raise ValueError(f"Source {source.get('id')} has an invalid physical page range")
    return value


def _write_private_report(path: str | Path, report: dict) -> Path:
    target = Path(path).resolve()
    private_root = (REPO_ROOT / ".runtime").resolve()
    allowed_roots = (private_root, Path(tempfile.gettempdir()).resolve())
    if not any(_is_relative_to(target, root) for root in allowed_roots):
        raise ValueError(
            "Evaluation reports must remain under .runtime/ or the system temp directory"
        ) from None
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
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--mode", choices=("fixture", "live-local"), default="fixture")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--class-id", default=None)
    parser.add_argument("--material-id", default=None)
    parser.add_argument("--student-id", default=None)
    parser.add_argument("--batches", type=int, default=1)
    parser.add_argument("--questions-per-batch", type=int, default=3)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    _load_manifest(args.manifest)
    if args.mode == "fixture":
        report = evaluate_fixture(args.manifest)
    else:
        args.class_id = args.class_id or os.getenv("KODMOD_MATERIAL_EVAL_CLASS_ID")
        args.material_id = args.material_id or os.getenv("KODMOD_MATERIAL_EVAL_MATERIAL_ID")
        args.student_id = args.student_id or os.getenv("KODMOD_MATERIAL_EVAL_STUDENT_ID")
        report = asyncio.run(
            evaluate_live_local(
                class_id=args.class_id,
                material_id=args.material_id,
                student_id=args.student_id,
                batches=args.batches,
                questions_per_batch=args.questions_per_batch,
            )
        )
    report["manifest"] = str(args.manifest.resolve())
    output = _write_private_report(args.output, report)
    print(
        json.dumps(
            {
                "mode": report["mode"],
                "status": report.get("status", "complete" if report.get("passed") else "failed"),
                "passed": report.get("passed"),
                "output": str(output),
            },
            ensure_ascii=False,
        )
    )
    if report.get("status") == "not_configured":
        return 2
    return 0 if report.get("passed") or report.get("status") == "complete" else 1


if __name__ == "__main__":
    sys.exit(main())
