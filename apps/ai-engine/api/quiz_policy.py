"""Pure, versioned interaction rules; callers own persistence and authorization."""

from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True)
class QuizPolicy:
    version: Literal[1, 2]
    mode: Literal["tutor", "assessment"]


@dataclass(frozen=True)
class QuizDecision:
    close_question: bool
    question_state: Literal["answering", "review", "complete"]
    available_actions: list[str]


def decide_transition(
    policy: QuizPolicy, *, correct: bool, action: str, question_closed: bool
) -> QuizDecision:
    if action not in {"answer", "hint", "advance"}:
        raise ValueError("Unknown quiz action")
    if question_closed:
        return QuizDecision(False, "review", ["advance"])
    if policy.version == 1:
        return QuizDecision(correct, "answering", ["answer"])
    if policy.mode == "assessment":
        if action != "answer":
            raise ValueError("Answer the current assessment question first")
        return QuizDecision(True, "review", ["advance"])
    if action == "advance" or (action == "answer" and correct):
        return QuizDecision(True, "review", ["advance"])
    return QuizDecision(False, "answering", ["answer", "hint", "advance"])
