"""Bind access tokens to one active account session."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "0016_single_active_auth_session"
down_revision = "0015_material_documents"
branch_labels = depends_on = None


def upgrade():
    # The initial migration builds from current metadata. On a fresh install,
    # that can already include these columns; existing databases at 0015 do not.
    existing_columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("users")}
    if "active_auth_session_id" not in existing_columns:
        op.add_column("users", sa.Column("active_auth_session_id", UUID(as_uuid=True)))
    if "active_auth_session_expires_at" not in existing_columns:
        op.add_column(
            "users", sa.Column("active_auth_session_expires_at", sa.DateTime(timezone=True))
        )


def downgrade():
    existing_columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("users")}
    if "active_auth_session_expires_at" in existing_columns:
        op.drop_column("users", "active_auth_session_expires_at")
    if "active_auth_session_id" in existing_columns:
        op.drop_column("users", "active_auth_session_id")
