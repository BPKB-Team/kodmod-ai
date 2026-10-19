"""Tutor completion is distinct from a student's reading bookmark."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0013_student_learning_progress"
down_revision = "0012_quiz_policy_outcomes"
branch_labels = depends_on = None


def upgrade():
    uid = postgresql.UUID(as_uuid=True)
    op.create_table(
        "material_learning_progress",
        sa.Column("id", uid, primary_key=True),
        sa.Column("student_id", uid, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column(
            "material_id",
            uid,
            sa.ForeignKey("class_materials.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("content_version", sa.Integer(), nullable=False),
        sa.Column("unit_manifest_hash", sa.String(64), nullable=False),
        sa.Column("completed_unit_ids", sa.JSON(), nullable=False),
        sa.Column("total_units", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        sa.Column("last_activity_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint(
            "student_id",
            "material_id",
            "content_version",
            "unit_manifest_hash",
            name="uq_material_learning_version",
        ),
    )
    op.create_index(
        "ix_material_learning_progress_student_id", "material_learning_progress", ["student_id"]
    )
    op.create_index(
        "ix_material_learning_progress_material_id", "material_learning_progress", ["material_id"]
    )


def downgrade():
    op.drop_table("material_learning_progress")
