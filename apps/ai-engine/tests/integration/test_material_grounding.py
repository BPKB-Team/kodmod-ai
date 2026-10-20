"""Deterministic golden checks and review-only backfill previews."""

import json
from pathlib import Path

import pytest

from scripts.evaluate_material_grounding import evaluate_fixture
from scripts.local_database import is_local_database_url
from scripts.preview_material_backfill import build_preview_report, source_unavailable_report

pytestmark = pytest.mark.integration
MANIFEST = Path(__file__).parents[1] / "fixtures" / "material_grounding" / "manifest.json"


def test_fixture_evaluation_reports_extraction_recall_quality_flow_and_privacy_separately():
    report = evaluate_fixture(MANIFEST)

    assert report["mode"] == "fixture"
    assert {name: metric["status"] for name, metric in report["metrics"].items()} == {
        "extraction": "pass",
        "evidence_recall": "pass",
        "question_quality": "pass",
        "flow": "pass",
        "privacy": "pass",
    }
    assert report["metrics"]["extraction"]["basis"] == "synthetic-structured-document"
    assert report["metrics"]["extraction"]["markers"] == [
        "a^{p+q}",
        "CO(NH_{2})_{2}",
        "Urea",
    ]
    assert report["metrics"]["evidence_recall"]["expected_block_ids"] == [
        "exponent-heading",
        "exponent-rule",
        "urea-table",
        "urea-explanation",
    ]
    assert report["metrics"]["question_quality"]["generic_title_rejected"]
    assert report["metrics"]["question_quality"]["unknown_evidence_rejected"]
    assert report["metrics"]["flow"]["assessment_wrong_answers_can_advance"]
    assert report["metrics"]["privacy"]["private_fields_rejected"]
    assert "SYNTHETIC_PRIVATE_ANSWER_KEY_DO_NOT_RETRIEVE" not in json.dumps(report)


def test_backfill_preview_is_a_diff_draft_and_never_an_apply_payload():
    current = {
        "schema_version": 1,
        "blocks": [
            {"id": "keep", "type": "paragraph", "inlines": [{"text": "Versi lama"}]},
            {"id": "remove", "type": "paragraph", "inlines": [{"text": "Teks lama"}]},
        ],
    }
    candidate = {
        "content": "Versi baru\n\nTeks tambahan",
        "document": {
            "schema_version": 1,
            "blocks": [
                {"id": "keep", "type": "paragraph", "inlines": [{"text": "Versi baru"}]},
                {"id": "add", "type": "paragraph", "inlines": [{"text": "Teks tambahan"}]},
            ],
        },
        "warnings": ["Periksa rumus dan urutan teks."],
        "page_range": {"first": 2, "last": 3},
    }

    report = build_preview_report(
        class_id="11111111-1111-4111-8111-111111111111",
        material_id="22222222-2222-4222-8222-222222222222",
        content_version=4,
        current_document=current,
        candidate_preview=candidate,
    )

    assert report["status"] == "draft_preview"
    assert report["apply"] is False
    assert report["requires_teacher_review"] is True
    assert report["diff"]["changed_ids"] == ["keep"]
    assert report["diff"]["removed_ids"] == ["remove"]
    assert report["diff"]["added_ids"] == ["add"]
    assert report["candidate"]["content"] == candidate["content"]
    assert report["diff"]["content_lines"]


def test_backfill_without_an_original_source_reports_unavailable_without_guessing():
    report = source_unavailable_report(
        class_id="11111111-1111-4111-8111-111111111111",
        material_id="22222222-2222-4222-8222-222222222222",
        reason="original_file_missing",
    )

    assert report["status"] == "source_unavailable"
    assert report["candidate"] is None
    assert report["apply"] is False


def test_live_tools_refuse_remote_database_urls():
    assert is_local_database_url("postgresql+asyncpg://localhost:5432/kodmod")
    assert is_local_database_url("postgresql+asyncpg://kodmod-postgres:5432/kodmod")
    assert not is_local_database_url("postgresql+asyncpg://database.example.com:5432/kodmod")
