"""Accepted content forms one canonical source for lesson, retrieval and speech."""

import uuid
from types import SimpleNamespace

import pytest

from api.learning_content import (
    accepted_learning_blocks,
    build_learning_units,
    material_learning_units,
)
from api.learning_progress import build_unit_manifest, canonical_manifest
from api.material_document import legacy_document
from models.material_document import MaterialDocument
from rag.chunking import chunk_material


@pytest.mark.parametrize(
    "text",
    [
        "<!-- demo metadata for Tata Surya -->",
        "# Dasar-Dasar Tata Surya",
        "Judul Modul: Tata Surya\nMata pelajaran: IPA",
        "# Daftar Isi\n\nBab 1 ... 1\nBab 2 ... 9",
        "# Kunci Jawaban\n\n1. B\n2. A",
    ],
)
def test_metadata_only_does_not_become_learning_or_question_unit(text):
    document = legacy_document(text)
    assert accepted_learning_blocks(document) == []
    assert build_learning_units(document) == []
    assert chunk_material(document, source="modul", content_version=1, mapping_version=0) == []


def test_short_formula_example_and_table_header_are_not_lost():
    document = MaterialDocument.model_validate(
        {
            "schema_version": 1,
            "blocks": [
                {"id": "heading", "type": "heading", "inlines": [{"text": "Sifat pangkat"}]},
                {"id": "formula", "type": "math", "latex": "a^p a^q = a^{p+q}", "role": "example"},
                {
                    "id": "table",
                    "type": "table",
                    "headers": ["Planet", "Periode"],
                    "rows": [["Bumi", "365 hari"]] * 80,
                },
                {
                    "id": "bad",
                    "type": "paragraph",
                    "review_state": "needs_review",
                    "inlines": [{"text": "Teks ambigu tidak boleh menjadi bukti soal."}],
                },
            ],
        }
    )
    units = build_learning_units(document)
    assert units and units[0]["title"] == "Sifat pangkat"
    assert all("bad" not in u["block_ids"] for u in units)
    chunks = chunk_material(document, source="modul", content_version=4, mapping_version=2)
    assert len(chunks) > 1
    assert all(
        "Planet: Bumi; Periode: 365 hari" in c.text
        for c in chunks
        if "table" in c.metadata["block_ids"]
    )
    assert all(
        c.metadata["content_version"] == 4 and c.metadata["mapping_version"] == 2 for c in chunks
    )
    assert all(c.metadata["document_hash"] and c.metadata["block_ids"] for c in chunks)
    assert "pangkat" in units[0]["speech_text"]


def test_legacy_substantive_remains_unverified_and_manifest_changes():
    content = (
        "Pecahan senilai mempunyai nilai yang sama meskipun pembilang dan penyebutnya berbeda. "
        * 80
    )
    material = SimpleNamespace(content=content, document=None, content_version=1)
    units = material_learning_units(material)
    assert units and units[0]["block_ids"]
    assert all(
        b.review_origin == "legacy_unverified"
        for b in accepted_learning_blocks(legacy_document(content))
    )
    old = build_unit_manifest(
        material, [{"text": content, "title": None}], partitioner_version="plain-v1"
    )
    current = canonical_manifest(material)
    assert old.unit_manifest_hash != current.unit_manifest_hash


def test_exercise_or_unreviewed_image_cannot_be_only_evidence():
    image = {
        "id": "i",
        "type": "image",
        "asset_id": str(uuid.uuid4()),
        "alt": "Planet Bumi mengelilingi Matahari setiap tiga ratus enam puluh lima hari.",
    }
    accepted = MaterialDocument.model_validate({"blocks": [image]})
    assert build_learning_units(accepted)
    pending = MaterialDocument.model_validate(
        {"blocks": [{**image, "review_state": "needs_review"}]}
    )
    assert not build_learning_units(pending)
    exercise = MaterialDocument.model_validate(
        {
            "blocks": [
                {
                    "id": "e",
                    "type": "paragraph",
                    "role": "exercise",
                    "inlines": [
                        {
                            "text": "Hitunglah nilai pangkat berikut dan jelaskan langkah pengerjaanmu dengan rinci."
                        }
                    ],
                }
            ]
        }
    )
    assert not build_learning_units(exercise)


def test_short_detail_blocks_remain_with_substantive_body():
    document = MaterialDocument.model_validate(
        {
            "blocks": [
                {
                    "id": "body",
                    "type": "paragraph",
                    "inlines": [
                        {
                            "text": "Pecahan senilai mempunyai nilai yang sama meskipun pembilang dan penyebut berbeda."
                        }
                    ],
                },
                {
                    "id": "detail",
                    "type": "paragraph",
                    "inlines": [{"text": "Contoh: satu per dua."}],
                },
            ]
        }
    )
    assert "Contoh: satu per dua." in build_learning_units(document)[0]["text"]
