"""Scientific document round trips and rejects executable/unbounded data."""

import uuid

import pytest
from pydantic import ValidationError

from api.material_document import legacy_document, project_material
from models.material_document import MaterialDocument


def doc(blocks):
    return MaterialDocument.model_validate({"schema_version": 1, "blocks": blocks})


def test_scientific_marks_table_and_image_round_trip():
    value = doc(
        [
            {
                "id": "power",
                "type": "paragraph",
                "inlines": [{"text": "a"}, {"text": "p+q", "marks": ["superscript"]}],
            },
            {
                "id": "chemical",
                "type": "paragraph",
                "inlines": [
                    {"text": "CO(NH"},
                    {"text": "2", "marks": ["subscript"]},
                    {"text": ")"},
                    {"text": "2", "marks": ["subscript"]},
                ],
            },
            {
                "id": "table",
                "type": "table",
                "headers": ["Planet", "Periode"],
                "rows": [["Bumi", "365 hari"]],
            },
            {
                "id": "image",
                "type": "image",
                "asset_id": str(uuid.uuid4()),
                "alt": "Urutan orbit planet",
                "caption": "Tata surya",
            },
            {"id": "formula", "type": "math", "latex": r"\frac{a^{p+q}}{b}"},
        ]
    )
    projection = project_material(value)
    assert "a^{p+q}" in projection.retrieval_text
    assert "CO(NH_{2})_{2}" in projection.retrieval_text
    assert "Planet: Bumi" in projection.retrieval_text
    assert "pangkat" in projection.speech_text and "subskrip" in projection.speech_text
    assert "Urutan orbit planet" in projection.speech_text
    assert doc(value.model_dump()["blocks"]) == value
    assert (
        project_material(doc(value.model_dump()["blocks"])).document_hash
        == projection.document_hash
    )


def test_legacy_is_read_only_unverified_and_excludes_comments():
    value = legacy_document(
        "<!-- demo note -->\n\n# Orbit\n\nBumi mengelilingi Matahari dalam satu tahun."
    )
    assert all(b.review_origin == "legacy_unverified" for b in value.blocks)
    assert "demo note" not in project_material(value).retrieval_text
    assert "Bumi" in project_material(value).retrieval_text


@pytest.mark.parametrize(
    "block",
    [
        {"id": "x", "type": "script", "text": "alert(1)"},
        {"id": "x", "type": "paragraph", "inlines": [{"text": "<script>x</script>"}]},
        {
            "id": "x",
            "type": "paragraph",
            "inlines": [{"text": "klik", "href": "javascript:alert(1)"}],
        },
        {"id": "x", "type": "math", "latex": r"\href{https://bad.test}{x}"},
        {"id": "x", "type": "math", "latex": r"\htmlStyle{color:red}{x}"},
        {
            "id": "x",
            "type": "image",
            "asset_id": str(uuid.uuid4()),
            "alt": "",
            "src": "file:///private",
        },
        {"id": "x", "type": "table", "headers": ["a", "b"], "rows": [["c"]]},
    ],
)
def test_rejects_invalid_or_executable_nodes(block):
    with pytest.raises(ValidationError):
        doc([block])


def test_document_limits_ids_and_uncertain_publication():
    with pytest.raises(ValidationError):
        doc([{"id": "a", "type": "paragraph", "inlines": [{"text": "x"}]}] * 2)
    with pytest.raises(ValidationError):
        doc([{"id": "big", "type": "paragraph", "inlines": [{"text": "x" * 100001}]}])
    value = doc(
        [
            {
                "id": "unknown",
                "type": "paragraph",
                "review_state": "needs_review",
                "inlines": [{"text": "Rumus belum terbaca"}],
            }
        ]
    )
    assert not project_material(value).retrieval_text


def test_material_write_exactly_one_source_and_version_guard():
    from api.routes.classrooms import MaterialWrite

    assert MaterialWrite(title="A", content="Penjelasan lama").content == "Penjelasan lama"
    with pytest.raises(ValidationError):
        MaterialWrite(title="A")
    with pytest.raises(ValidationError):
        MaterialWrite(title="A", content="x", document={"schema_version": 1, "blocks": []})
    value = MaterialWrite(
        title="A",
        document={"schema_version": 1, "blocks": [{"id": "x", "type": "math", "latex": "a^{p+q}"}]},
        expected_version=1,
    )
    assert value.document is not None
