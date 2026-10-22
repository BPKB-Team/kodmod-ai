"""Legacy version counters must not conceal missing or stale source provenance."""

from copy import deepcopy
from types import SimpleNamespace

import pytest

from api.learning_content import PARTITIONER_VERSION, material_learning_units
from scripts.repair_material_indexes import index_issue

pytestmark = pytest.mark.unit


def indexed_material():
    material = SimpleNamespace(
        content="Pecahan menyatakan bagian dari keseluruhan. Satu per dua setara dua per empat.",
        document=None,
        content_version=1,
        mapping_version=0,
        n_chunks=1,
    )
    unit = material_learning_units(material)[0]
    chunk = {
        "content_version": 1,
        "mapping_version": 0,
        "accessibility_metadata": {
            **{key: deepcopy(unit[key]) for key in ("document_hash", "block_ids", "spans")},
            "partitioner_version": PARTITIONER_VERSION,
        },
    }
    return material, chunk


def test_matching_version_counters_do_not_make_legacy_chunks_healthy():
    material, chunk = indexed_material()
    chunk["accessibility_metadata"] = {"approved_concept_ids": []}
    assert index_issue(material, [chunk]) == "incomplete_provenance"


def test_rebuilt_current_evidence_is_healthy_including_mapping_zero():
    material, chunk = indexed_material()
    assert index_issue(material, [chunk]) is None


@pytest.mark.parametrize(
    "field,value,reason",
    [
        ("document_hash", "stale", "stale_document"),
        ("partitioner_version", "legacy", "stale_partitioner"),
        ("spans", [{"block_id": "unrelated"}], "invalid_block_spans"),
    ],
)
def test_audit_detects_source_metadata_that_cannot_be_reused(field, value, reason):
    material, chunk = indexed_material()
    chunk["accessibility_metadata"][field] = value
    assert index_issue(material, [chunk]) == reason


def test_missing_chunks_and_source_versions_require_rebuilding():
    material, chunk = indexed_material()
    assert index_issue(material, []) == "missing_chunks"
    chunk["content_version"] = 0
    assert index_issue(material, [chunk]) == "stale_versions"
