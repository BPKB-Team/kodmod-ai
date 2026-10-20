"""The HTTP stub should satisfy the source-grounded quiz contracts."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path


def _stub_module():
    root = Path(__file__).resolve().parents[2]
    source = root / "docker" / "llm_stub" / "app.py"
    spec = importlib.util.spec_from_file_location("kodmod_llm_stub_under_test", source)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_quiz_stub_returns_distinct_source_linked_candidates_with_depth():
    prompt = json.dumps(
        {
            "request": {
                "topic": "Pecahan",
                "count": 3,
                "difficulty": "easy",
                "mcq_only": True,
                "approved_concepts": [{"id": "concept-1"}],
            },
            "sources": [
                {
                    "evidence_id": "source-1",
                    "excerpt": "Satu per dua ditambah satu per dua adalah satu.",
                }
            ],
        }
    )

    result = json.loads(_stub_module()._canned_reply(prompt))

    questions = result["questions"]
    assert len(questions) == 3
    assert len({item["text"] for item in questions}) == 3
    assert all(item["evidence_refs"] == ["source-1"] for item in questions)
    assert all(item["concept_id"] == "concept-1" for item in questions)
    assert all(len(item["options"]) == 4 and item["expected_answer"] == "A" for item in questions)
    assert any(item["cognitive_level"] in {"application", "reasoning"} for item in questions)


def test_quiz_verifier_stub_returns_one_structured_decision_per_candidate():
    prompt = "strict evidence verifier\n" + json.dumps(
        {
            "sources": [{"evidence_id": "source-1", "excerpt": "Supported fact."}],
            "questions": [{"index": 0}, {"index": 1}],
            "instruction": "Return decisions.",
        }
    )

    result = json.loads(_stub_module()._canned_reply(prompt))

    assert result == {
        "decisions": [
            {"accepted": True, "reasons": [], "feedback": ""},
            {"accepted": True, "reasons": [], "feedback": ""},
        ]
    }
