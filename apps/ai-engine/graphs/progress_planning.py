"""Facts -> one bounded Planner -> validation -> deterministic Recommendation."""

from typing import TypedDict

from agents.planner_agent import fallback_plan, planner_node, validate_plan_proposal
from agents.recommendation_agent import recommendations_from_plan
from langgraph.graph import END, START, StateGraph
from models.progress_guidance import (
    GuidanceSnapshot,
    PlanProposal,
    RecommendationView,
    ValidatedPlan,
)


class ProgressPlanningState(TypedDict, total=False):
    snapshot: GuidanceSnapshot
    language: str
    proposal: PlanProposal | None
    plan: ValidatedPlan
    recommendations: list[RecommendationView]


def validate_node(state):
    try:
        if state.get("proposal") is None:
            raise ValueError("No proposal")
        plan = validate_plan_proposal(state["proposal"], state["snapshot"])
    except ValueError:
        plan = fallback_plan(state["snapshot"])
    return {"plan": plan}


def presentation_node(state):
    return {
        "recommendations": recommendations_from_plan(
            state["plan"], state["snapshot"], state.get("language", "id")
        )
    }


def build_progress_planning_graph():
    graph = StateGraph(ProgressPlanningState)
    graph.add_node("planner", planner_node)
    graph.add_node("validate", validate_node)
    graph.add_node("recommendation", presentation_node)
    graph.add_edge(START, "planner")
    graph.add_edge("planner", "validate")
    graph.add_edge("validate", "recommendation")
    graph.add_edge("recommendation", END)
    return graph.compile()
