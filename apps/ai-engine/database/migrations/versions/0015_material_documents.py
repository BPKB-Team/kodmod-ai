"""Structured material, private image assets and immutable source revisions."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "0015_material_documents"
down_revision = "0014_progress_guidance"
branch_labels = depends_on = None


def upgrade():
    uid = UUID(as_uuid=True)
    op.add_column("class_materials", sa.Column("document", sa.JSON()))
    op.create_table(
        "material_assets",
        sa.Column("id", uid, primary_key=True),
        sa.Column(
            "class_id", uid, sa.ForeignKey("classrooms.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("owner_id", uid, sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("mime_type", sa.String(30), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("storage_key", sa.String(100), unique=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_material_assets_class_id", "material_assets", ["class_id"])
    op.create_table(
        "material_revisions",
        sa.Column("id", uid, primary_key=True),
        sa.Column(
            "material_id",
            uid,
            sa.ForeignKey("class_materials.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("content_version", sa.Integer(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("document", sa.JSON()),
        sa.Column(
            "source_import_id", uid, sa.ForeignKey("material_imports.id", ondelete="RESTRICT")
        ),
        sa.Column("source_filename", sa.String(300)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("material_id", "content_version", name="uq_material_revision_version"),
    )
    op.create_index("ix_material_revisions_material_id", "material_revisions", ["material_id"])


def downgrade():
    op.drop_table("material_revisions")
    op.drop_table("material_assets")
    op.drop_column("class_materials", "document")
