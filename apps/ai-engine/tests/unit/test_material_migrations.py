"""Check fresh-install SQL ordering without connecting to a user's database."""

import io
import re
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config

pytestmark = pytest.mark.unit


def test_fresh_migrations_add_material_context_only_after_class_tables_exist():
    config = Config(str(Path(__file__).resolve().parents[2] / "alembic.ini"))
    output = io.StringIO()
    config.output_buffer = output
    command.upgrade(config, "head", sql=True)
    sql = output.getvalue()
    initial = sql.split("-- Running upgrade 0001_initial -> 0002_classrooms")[0]
    sessions = re.search(r"CREATE TABLE learning_sessions \((.*?)\n\);", initial, re.S).group(1)
    chunks = re.search(r"CREATE TABLE curriculum_chunks \((.*?)\n\);", initial, re.S).group(1)
    assert "class_id" not in sessions and "material_id" not in sessions
    assert "material_id" not in chunks and "material_version" not in chunks
    assert "REFERENCES classrooms" not in initial and "REFERENCES class_materials" not in initial
    assert sql.count("ALTER TABLE curriculum_chunks ADD COLUMN material_id") == 1
    assert sql.index("CREATE TABLE class_materials") < sql.index(
        "ALTER TABLE curriculum_chunks ADD COLUMN material_id"
    )
    assert "0004_class_material_rag" in sql
    recommendations = re.search(r"CREATE TABLE recommendations \((.*?)\n\);", initial, re.S).group(
        1
    )
    assert "plan_id" not in recommendations and "expires_at" not in recommendations
    assert sql.count("ALTER TABLE recommendations ADD COLUMN plan_id") == 1


def test_structured_documents_are_additive_and_assets_private_metadata_only():
    config = Config(str(Path(__file__).resolve().parents[2] / "alembic.ini"))
    output = io.StringIO()
    config.output_buffer = output
    command.upgrade(config, "head", sql=True)
    sql = output.getvalue()
    assert sql.count("ALTER TABLE class_materials ADD COLUMN document") == 1
    assert "CREATE TABLE material_assets" in sql and "CREATE TABLE material_revisions" in sql
    assert sql.index("CREATE TABLE class_materials") < sql.index("CREATE TABLE material_revisions")
