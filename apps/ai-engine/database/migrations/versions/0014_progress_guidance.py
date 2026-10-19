"""Persist study-plan cycles, immutable action receipts and scoped recommendations."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "0014_progress_guidance"
down_revision = "0013_student_learning_progress"
branch_labels = depends_on = None


def upgrade():
    uid = UUID(as_uuid=True)
    op.create_table(
        "learning_plans",
        sa.Column("id", uid, primary_key=True),
        sa.Column("student_id", uid, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("cycle_id", uid, nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("source_snapshot_hash", sa.String(64), nullable=False),
        sa.Column("policy_version", sa.String(30), nullable=False),
        sa.Column("prompt_version", sa.String(30), nullable=False),
        sa.Column("language", sa.String(5), nullable=False),
        sa.Column("timezone", sa.String(80), nullable=False),
        sa.Column("goal", sa.JSON()),
        sa.Column("reason_fact_ids", sa.JSON(), nullable=False),
        sa.Column("history", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("used_fallback", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("next_check_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_learning_plans_student_id", "learning_plans", ["student_id"])
    op.create_index(
        "uq_active_learning_plan",
        "learning_plans",
        ["student_id"],
        unique=True,
        postgresql_where=sa.text("status = 'active'"),
    )
    op.create_table(
        "learning_plan_steps",
        sa.Column("id", uid, primary_key=True),
        sa.Column(
            "plan_id", uid, sa.ForeignKey("learning_plans.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("order_index", sa.Integer(), nullable=False),
        sa.Column("candidate_id", sa.String(64), nullable=False),
        sa.Column("target", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("session_id", uid),
        sa.Column("evidence_receipt_id", uid),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_learning_plan_steps_plan_id", "learning_plan_steps", ["plan_id"])
    op.create_table(
        "plan_action_receipts",
        sa.Column("id", uid, primary_key=True),
        sa.Column("student_id", uid, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column(
            "plan_id", uid, sa.ForeignKey("learning_plans.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("request_fingerprint", sa.String(64), nullable=False),
        sa.Column("response_payload", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_plan_action_receipts_student_id", "plan_action_receipts", ["student_id"])
    for name, target in [("plan_id", "learning_plans"), ("plan_step_id", "learning_plan_steps")]:
        op.add_column("recommendations", sa.Column(name, uid))
        op.create_foreign_key(
            f"fk_recommendations_{name}",
            "recommendations",
            target,
            [name],
            ["id"],
            ondelete="SET NULL",
        )
        op.create_index(f"ix_recommendations_{name}", "recommendations", [name])
    op.add_column("recommendations", sa.Column("expires_at", sa.DateTime(timezone=True)))


def downgrade():
    op.drop_column("recommendations", "expires_at")
    for name in ("plan_step_id", "plan_id"):
        op.drop_index(f"ix_recommendations_{name}", table_name="recommendations")
        op.drop_constraint(f"fk_recommendations_{name}", "recommendations", type_="foreignkey")
        op.drop_column("recommendations", name)
    op.drop_table("plan_action_receipts")
    op.drop_table("learning_plan_steps")
    op.drop_table("learning_plans")
