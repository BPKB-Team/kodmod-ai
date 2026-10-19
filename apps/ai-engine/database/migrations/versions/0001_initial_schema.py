"""Initial schema.

Revision ID: 0001_initial
Revises:
Create Date: 2026-09-05

This is revision one of a rebuilt schema. Alembic owns the schema; the legacy
``schema.sql`` is not an installation script. The original table set is frozen,
and tables changed by later revisions use their original column definitions
here. Fresh installs must not inherit columns or foreign keys from the future.

The pgvector extension is created first: ``curriculum_chunks.embedding`` is a
``vector`` column and its HNSW index needs the operator classes to exist.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from pgvector.sqlalchemy import Vector
from sqlalchemy.dialects.postgresql import UUID

from config.settings import settings
from database.models import Base

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None

# Freeze the original table set: importing live metadata must not create tables
# owned by subsequent revisions on a fresh installation.
BASELINE_TABLES = {
    "users",
    "invitation_codes",
    "subjects",
    "concepts",
    "lessons",
    "exercises",
    "documents",
    "curriculum_chunks",
    "learning_sessions",
    "interaction_logs",
    "quiz_sessions",
    "quiz_questions",
    "quiz_attempts",
    "mastery_scores",
    "misconceptions",
    "analytics_reports",
    "recommendations",
}


def _baseline_metadata() -> sa.MetaData:
    metadata = sa.MetaData()
    changed_tables = {
        "curriculum_chunks",
        "learning_sessions",
        "quiz_sessions",
        "concepts",
        "recommendations",
    }
    for table in Base.metadata.tables.values():
        if table.name in BASELINE_TABLES and table.name not in changed_tables:
            table.to_metadata(metadata)
    sa.Table(
        "recommendations",
        metadata,
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "student_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("kind", sa.String(40), nullable=False),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column(
            "target_concept_id",
            UUID(as_uuid=True),
            sa.ForeignKey("concepts.id", ondelete="SET NULL"),
        ),
        sa.Column("priority", sa.Integer(), nullable=False),
        sa.Column("consumed", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    sa.Table(
        "concepts",
        metadata,
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "subject_id",
            UUID(as_uuid=True),
            sa.ForeignKey("subjects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("slug", sa.String(200), nullable=False, unique=True),
        sa.Column("description", sa.Text()),
        sa.Column("prerequisite_ids", sa.JSON(), nullable=False),
        sa.Column("difficulty_level", sa.String(20), nullable=False),
    )
    sa.Table(
        "quiz_sessions",
        metadata,
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "student_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "concept_id", UUID(as_uuid=True), sa.ForeignKey("concepts.id", ondelete="SET NULL")
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True)),
        sa.Column("total_questions", sa.Integer(), nullable=False),
        sa.Column("correct_count", sa.Integer(), nullable=False),
        sa.Column("final_score", sa.Float()),
        sa.Column("status", sa.String(20), nullable=False),
    )
    sa.Table(
        "learning_sessions",
        metadata,
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "student_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "subject_id", UUID(as_uuid=True), sa.ForeignKey("subjects.id", ondelete="SET NULL")
        ),
        sa.Column("title", sa.String(200)),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False, index=True),
        sa.Column("ended_at", sa.DateTime(timezone=True)),
        sa.Column("mode", sa.String(40), nullable=False),
        sa.Column("summary", sa.Text()),
    )
    sa.Table(
        "curriculum_chunks",
        metadata,
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("embedding", Vector(settings.EMBEDDING_DIM), nullable=False),
        sa.Column("source", sa.String(500), nullable=False),
        sa.Column("language", sa.String(8), nullable=False),
        sa.Column(
            "concept_id",
            UUID(as_uuid=True),
            sa.ForeignKey("concepts.id", ondelete="SET NULL"),
            index=True,
        ),
        sa.Column(
            "subject_id",
            UUID(as_uuid=True),
            sa.ForeignKey("subjects.id", ondelete="CASCADE"),
            index=True,
        ),
        sa.Column(
            "document_id",
            UUID(as_uuid=True),
            sa.ForeignKey("documents.id", ondelete="CASCADE"),
            index=True,
        ),
        sa.Column("chunk_index", sa.Integer(), nullable=False),
        sa.Column("section_title", sa.String(300)),
        sa.Column("accessibility_metadata", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Index(
            "ix_curriculum_chunks_embedding",
            "embedding",
            postgresql_using="hnsw",
            postgresql_with={"m": 16, "ef_construction": 64},
            postgresql_ops={"embedding": "vector_cosine_ops"},
        ),
    )
    return metadata


def upgrade() -> None:
    op.execute(sa.text("CREATE EXTENSION IF NOT EXISTS vector"))
    _baseline_metadata().create_all(bind=op.get_bind())


def downgrade() -> None:
    _baseline_metadata().drop_all(bind=op.get_bind())
