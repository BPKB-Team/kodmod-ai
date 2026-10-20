"""
KODMOD AI - Streaming Chat WebSocket (`/ws/chat`)
=================================================

Text in, text out. Speech recognition and synthesis both live in the browser,
so this socket carries JSON only and never a byte of audio.

Client sends::

    {"type": "message", "text": "...", "subject_id": "...|null",
     "session_id": "...|null"}
    {"type": "ping"}

Server sends, in order, per turn::

    {"type": "session", "session_id": "..."}   once, so the client can resume
    {"type": "state",   "node": "..."}         which node is running
    {"type": "token",   "text": "..."}         repeatedly, as the tutor writes
    {"type": "final",   "text": ..., "intent": ..., "sources": [...], "quiz_progress": ...}
    {"type": "error",   "message": "..."}      instead of `final`, on failure

Tokens are a live preview. The `final` text is the authoritative answer: it has
been through the accessibility node, which rewrites visual references and
splits long sentences, so it is not merely the concatenated tokens. Clients
should render the streamed tokens and then replace them with `final`.
"""

from __future__ import annotations

import logging
import time
import uuid

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from api.chat_service import (
    log_turn,
    prepare_chat_turn,
    reply_text,
    sources,
    update_session_mode,
)
from api.dependencies import authenticate_ws
from api.routes.chat import ChatMessageRequest, _clear_transient_quiz_checkpoint
from database.session import async_session
from graphs.main_graph import run_turn

log = logging.getLogger(__name__)
router = APIRouter()

MAX_TEXT_CHARS = 4000

# Nodes worth telling the client about. The rest are too fast to be worth a
# frame, and naming every one would turn a progress hint into noise.
_PROGRESS_NODES = frozenset(
    {"intent_router", "rag_retrieval", "tutoring", "problem_generator", "quiz_ask", "scoring"}
)

# Every node in the graph, so their partial returns can be merged into the
# turn's result. Kept in sync with `graphs/main_graph.build_kodmod_graph`.
_GRAPH_NODES = frozenset(
    {
        "intent_router",
        "rag_retrieval",
        "tutoring",
        "mini_quiz",
        "problem_generator",
        "quiz_ask",
        "scoring",
        "quiz_analyzer",
        "update_student_model",
        "analytics",
        "recommendation",
        "accessibility",
        "reflection",
    }
)


@router.websocket("/chat")  # mounted under /ws
async def chat_ws(websocket: WebSocket) -> None:
    student = await authenticate_ws(websocket)  # closes with 1008 on failure
    await websocket.accept()
    log.info("Chat socket open for %s", student.username)

    try:
        while True:
            frame = await websocket.receive_json()

            if frame.get("type") == "ping":
                await websocket.send_json({"type": "pong"})
                continue
            if frame.get("type") != "message":
                await websocket.send_json({"type": "error", "message": "Unknown frame type."})
                continue

            text = str(frame.get("text") or "").strip()
            if not text:
                await websocket.send_json({"type": "error", "message": "Message was empty."})
                continue
            if len(text) > MAX_TEXT_CHARS:
                await websocket.send_json(
                    {
                        "type": "error",
                        "message": f"Message is longer than {MAX_TEXT_CHARS} characters.",
                    }
                )
                continue

            try:
                body = ChatMessageRequest.model_validate({**frame, "text": text})
            except ValidationError:
                await websocket.send_json(
                    {
                        "type": "error",
                        "status": 422,
                        "message": "Pilihan sesi atau materi tidak valid.",
                    }
                )
                continue
            await _run_one_turn(
                websocket,
                student,
                text=text,
                session_id=body.session_id,
                subject_id=body.subject_id,
                class_id=body.class_id,
                material_id=body.material_id,
            )

    except WebSocketDisconnect:
        log.info("Chat socket closed for %s", student.username)
    except Exception:
        log.exception("Chat socket failed for %s", student.username)
        try:
            await websocket.close(code=1011)
        except RuntimeError:
            pass  # already closed


async def _run_one_turn(
    websocket: WebSocket,
    student,
    *,
    text: str,
    session_id: uuid.UUID | None,
    subject_id: uuid.UUID | None,
    class_id: uuid.UUID | None = None,
    material_id: uuid.UUID | None = None,
) -> None:
    started = time.perf_counter()

    try:
        async with async_session() as session:
            resolved_id, state, context = await prepare_chat_turn(
                session,
                student=student,
                text=text,
                session_id=session_id,
                subject_id=subject_id,
                class_id=class_id,
                material_id=material_id,
            )
    except HTTPException as exc:
        await websocket.send_json(
            {"type": "error", "status": exc.status_code, "message": exc.detail}
        )
        return
    await websocket.send_json(
        {"type": "session", "session_id": str(resolved_id), "context": context}
    )
    graph = websocket.app.state.graph
    config = {"configurable": {"thread_id": str(resolved_id)}}

    # Accumulate each node's partial return rather than trusting one root
    # event: node names are ours, the root chain's name is LangGraph's to change.
    final: dict = {}
    try:
        async for event in run_turn(graph, state, config):
            kind = event.get("event")
            name = event.get("name")
            if kind == "on_chat_model_stream":
                chunk = event["data"]["chunk"]
                if token := getattr(chunk, "content", ""):
                    await websocket.send_json({"type": "token", "text": token})
            elif kind == "on_chain_start" and name in _PROGRESS_NODES:
                await websocket.send_json({"type": "state", "node": name})
            elif kind == "on_chain_end":
                output = event.get("data", {}).get("output")
                if isinstance(output, dict) and (name in _GRAPH_NODES or name == "LangGraph"):
                    final.update(output)
    except Exception:
        log.exception("Turn failed for session %s", resolved_id)
        await websocket.send_json(
            {
                "type": "error",
                "message": "Maaf, terjadi kesalahan saat menyiapkan jawaban. Coba lagi.",
            }
        )
        return

    quiz_session_id = None
    if final.get("quiz_questions") and not final.get("assessment_managed"):
        try:
            from api.quiz_session_factory import persist_conversational_quiz

            async with async_session() as session:
                quiz = await persist_conversational_quiz(
                    session, student, final, learning_session_id=resolved_id
                )
            quiz_session_id = quiz.quiz_session_id if quiz else None
        except HTTPException as exc:
            await websocket.send_json(
                {"type": "error", "status": exc.status_code, "message": exc.detail}
            )
            return
        except Exception:
            log.exception("Could not persist conversational quiz for session %s", resolved_id)
            await websocket.send_json(
                {"type": "error", "message": "Kuis belum dapat disimpan. Silakan coba kembali."}
            )
            return
        finally:
            await _clear_transient_quiz_checkpoint(graph, resolved_id)

    answer = reply_text(final)
    if quiz_session_id:
        answer = (
            "Your quick check is ready below."
            if (final.get("learning_profile") or {}).get("language") == "en"
            else "Soal cek pemahaman siap dijawab di bawah."
        )
    latency_ms = int((time.perf_counter() - started) * 1000)

    await log_turn(resolved_id, role="student", text=text, intent=final.get("intent"))
    await log_turn(
        resolved_id,
        role="assistant",
        text=answer,
        intent=final.get("intent"),
        latency_ms=latency_ms,
        source_refs=sources(final),
        quiz_session_id=quiz_session_id,
    )
    await update_session_mode(resolved_id, final.get("intent"))

    quiz_progress = (
        {
            "index": final.get("current_question_index", 0),
            "total": len(final.get("quiz_questions") or []),
        }
        if quiz_session_id and final.get("quiz_questions")
        else None
    )

    await websocket.send_json(
        {
            "type": "final",
            "session_id": str(resolved_id),
            "text": answer,
            "intent": str(final.get("intent") or "unknown"),
            "next_action": str(final.get("next_action") or "end"),
            "sources": sources(final),
            "latency_ms": latency_ms,
            "quiz_progress": quiz_progress,
            "quiz_session_id": str(quiz_session_id) if quiz_session_id else None,
            "context": context,
        }
    )
