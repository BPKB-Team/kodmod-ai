"""Durable versioned quiz outcomes and interaction receipts."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0012_quiz_policy_outcomes"
down_revision = "0011_provider_usage"
branch_labels = depends_on = None


def upgrade():
    uid = postgresql.UUID(as_uuid=True)
    op.create_table(
        "quiz_question_outcomes",
        sa.Column("id", uid, primary_key=True),
        sa.Column(
            "quiz_session_id",
            uid,
            sa.ForeignKey("quiz_sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "question_id",
            uid,
            sa.ForeignKey("quiz_questions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "first_submission_id",
            uid,
            sa.ForeignKey("assessment_submissions.id", ondelete="RESTRICT"),
        ),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("first_score", sa.Float(), nullable=False),
        sa.Column("assisted", sa.Boolean(), nullable=False),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("quiz_session_id", "question_id", name="uq_quiz_question_outcome"),
    )
    op.create_index(
        "ix_quiz_question_outcomes_quiz_session_id",
        "quiz_question_outcomes",
        ["quiz_session_id"],
    )
    op.create_table(
        "quiz_action_receipts",
        sa.Column("id", uid, primary_key=True),
        sa.Column(
            "quiz_session_id",
            uid,
            sa.ForeignKey("quiz_sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "student_id",
            uid,
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("request_fingerprint", sa.String(64), nullable=False),
        sa.Column("response_payload", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_quiz_action_receipts_quiz_session_id",
        "quiz_action_receipts",
        ["quiz_session_id"],
    )


def downgrade():
    op.drop_table("quiz_action_receipts")
    op.drop_table("quiz_question_outcomes")
