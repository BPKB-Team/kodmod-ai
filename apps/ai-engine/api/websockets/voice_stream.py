"""
KODMOD AI - Voice WebSocket
============================

Bidirectional streaming endpoint. Client opens a single WS, sends audio
frames (16 kHz mono PCM or Opus), and receives:

* `transcript` events as soon as STT produces partial transcriptions
* `agent_event` events forwarded from LangGraph's `astream_events`
* `audio_chunk` events containing TTS-synthesized audio bytes (sent as
  binary frames so the client can play them incrementally)
* `final` event when the turn completes

Authentication
--------------
The WS upgrade requires a JWT in the `Authorization` header (or `?token=`
fallback for browsers that can't set headers on WebSocket).

Rate limiting
-------------
Per-student rate limit enforced via Redis token bucket - see
`api/middleware/rate_limit.py`.
"""

from __future__ import annotations

import json
import logging
import time
import uuid

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect, status
from pydantic import ValidationError

from api.chat_service import log_turn, prepare_chat_turn, reply_text, sources, update_session_mode
from api.dependencies import authenticate_ws, revalidate_ws_session
from api.routes.chat import ChatMessageRequest
from api.websockets.chat_stream import _GRAPH_NODES
from database.session import async_session
from graphs.main_graph import run_turn
from voice.streaming import StreamingSTT, stream_tts

log = logging.getLogger(__name__)
router = APIRouter()


@router.websocket("/voice")
async def voice_ws(websocket: WebSocket):
    student = await authenticate_ws(websocket)
    if not student:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await websocket.accept()
    log.info("WS opened for student=%s", student.id)

    # Optional query context follows the same validated contract as text chat.
    try:
        context_request = ChatMessageRequest.model_validate(
            {
                "text": "voice",
                **{
                    key: websocket.query_params[key]
                    for key in ("session_id", "subject_id", "class_id", "material_id")
                    if key in websocket.query_params
                },
            }
        )
    except ValidationError:
        await websocket.send_json(
            {"type": "error", "status": 422, "message": "Pilihan sesi atau materi tidak valid."}
        )
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    session_id = context_request.session_id
    stt = StreamingSTT(language=student.preferred_language or "id")

    try:
        while True:
            # ---- Phase 1: collect audio chunks until end-of-utterance -----
            transcript = await _collect_utterance(websocket, stt, student.id)
            if not transcript:
                continue  # client sent metadata or empty frame
            student = await revalidate_ws_session(websocket, student.id)
            log.info("Final transcript: %s", transcript[:80])

            # ---- Phase 2: drive LangGraph for one turn -------------------
            try:
                async with async_session() as session:
                    session_id, state, context = await prepare_chat_turn(
                        session,
                        student=student,
                        text=transcript,
                        session_id=session_id,
                        subject_id=context_request.subject_id,
                        class_id=context_request.class_id,
                        material_id=context_request.material_id,
                    )
            except HTTPException as exc:
                await websocket.send_json(
                    {"type": "error", "status": exc.status_code, "message": exc.detail}
                )
                continue
            state["transcribed_text"] = transcript

            graph = websocket.app.state.graph
            config = {"configurable": {"thread_id": str(session_id)}}

            final = {}
            last_session_check = 0.0
            async for event in run_turn(graph, state, config):
                now = time.monotonic()
                if now - last_session_check >= 1.0:
                    student = await revalidate_ws_session(websocket, student.id)
                    last_session_check = now
                kind = event["event"]
                if kind == "on_chain_end" and event.get("name") in _GRAPH_NODES | {"LangGraph"}:
                    output = event.get("data", {}).get("output")
                    if isinstance(output, dict):
                        final.update(output)

                if kind == "on_chat_model_stream":
                    delta = (
                        event["data"]["chunk"].content
                        if hasattr(event["data"]["chunk"], "content")
                        else ""
                    )
                    await websocket.send_json(
                        {
                            "type": "token",
                            "text": delta,
                        }
                    )

                elif kind == "on_chain_end" and event["name"] == "accessibility":
                    # Start streaming TTS as soon as accessibility node completes
                    final_text = event["data"]["output"].get("accessible_response", "")
                    async for frame in stream_tts(final_text):
                        await websocket.send_bytes(frame)

            student = await revalidate_ws_session(websocket, student.id)
            answer = reply_text(final)
            await log_turn(session_id, role="student", text=transcript, intent=final.get("intent"))
            await log_turn(
                session_id,
                role="assistant",
                text=answer,
                intent=final.get("intent"),
                source_refs=sources(final),
            )
            await update_session_mode(session_id, final.get("intent"))
            await websocket.send_json(
                {
                    "type": "final",
                    "session_id": str(session_id),
                    "text": answer,
                    "context": context,
                    "sources": sources(final),
                }
            )

    except WebSocketDisconnect:
        log.info("WS closed for student=%s", student.id)
    except Exception:
        log.exception("WS handler crashed")
        await websocket.close(code=status.WS_1011_INTERNAL_ERROR)


# ---------------------------------------------------------------------------
# Audio collection
# ---------------------------------------------------------------------------


async def _collect_utterance(
    ws: WebSocket, stt: StreamingSTT, expected_user_id: uuid.UUID
) -> str | None:
    """
    Receive audio frames until VAD says the user stopped talking, then return
    the final transcript. Sends partial transcripts back to the client.
    """
    transcript = ""
    last_session_check = 0.0
    while True:
        msg = await ws.receive()
        now = time.monotonic()
        if now - last_session_check >= 1.0:
            await revalidate_ws_session(ws, expected_user_id)
            last_session_check = now
        if msg.get("type") == "websocket.disconnect":
            raise WebSocketDisconnect(code=msg.get("code", 1000))
        if msg.get("bytes"):
            audio_frame = msg["bytes"]
            if len(audio_frame) > stt.max_frame_bytes:
                await ws.send_json(
                    {
                        "type": "error",
                        "status": 413,
                        "message": "Ukuran potongan audio terlalu besar.",
                    }
                )
                await ws.close(code=1009)
                raise WebSocketDisconnect(code=1009)
            result = await stt.feed(audio_frame)
            partial = result.get("partial")
            if partial:
                transcript = partial
                await ws.send_json({"type": "partial_transcript", "text": partial})
            if result.get("final"):
                return result["final"]
        elif msg.get("text"):
            data = json.loads(msg["text"])
            if data.get("event") == "end_of_speech":
                final = await stt.flush_segment()
                return final or transcript or ""
