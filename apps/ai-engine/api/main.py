"""
KODMOD AI - FastAPI Application Entry
======================================

Mounts:
  /auth/*        - register, log in, own account
  /chat/*        - conversation turns and history (REST)
  /ws/chat       - the streaming conversation socket
  /quiz/*        - quiz session management
  /student/*     - the student's own learning profile
  /teacher/*     - roster, per-student progress, transcripts
  /admin/*       - accounts and invitation codes
  /subjects/*    - subjects, concepts, curriculum document uploads
  /documents/*   - deleting an uploaded document
  /analytics/*   - student and cohort analytics
  /exercise/*    - exercise generation
  /content/*     - curriculum lookup and retrieval
  /live, /ready, /version
  /metrics       - Prometheus

Lifespan
--------
On startup: opens DB pools and builds the LangGraph.
On shutdown: closes the checkpointer pool and the DB pools cleanly.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from prometheus_client import make_asgi_app
from psycopg import AsyncConnection
from psycopg.rows import DictRow, dict_row
from psycopg_pool import AsyncConnectionPool
from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from api.routes import (
    admin,
    admin_insights,
    admin_materials,
    analytics,
    auth,
    chat,
    classrooms,
    content,
    editorial_quizzes,
    exercise,
    health,
    learning,
    material_assets,
    progress_guidance,
    quiz,
    student,
    subjects,
    teacher,
    voice,
)
from api.websockets import chat_stream, voice_stream
from config.logging import configure_logging
from config.settings import settings
from database.session import close_db, init_db
from graphs.main_graph import build_kodmod_graph
from tools.provider_usage import ProviderContextMiddleware

log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """App startup / shutdown."""
    configure_logging()
    log.info("Starting KODMOD AI API")

    await init_db()

    app.state.checkpointer_pool = None
    checkpointer: BaseCheckpointSaver
    if settings.CHECKPOINTER == "memory":
        from langgraph.checkpoint.memory import MemorySaver

        checkpointer = MemorySaver()
        log.info("Checkpointer: in-memory")
    else:
        cp_pool: AsyncConnectionPool[AsyncConnection[DictRow]] = AsyncConnectionPool(
            settings.LANGGRAPH_DB_URI,
            open=False,
            max_size=settings.DB_POOL_SIZE + settings.DB_MAX_OVERFLOW,
            kwargs={"autocommit": True, "prepare_threshold": 0, "row_factory": dict_row},
        )
        await cp_pool.open()
        app.state.checkpointer_pool = cp_pool
        checkpointer = AsyncPostgresSaver(cp_pool)
        await checkpointer.setup()
    app.state.graph = await build_kodmod_graph(checkpointer=checkpointer)

    log.info("KODMOD AI ready (env=%s)", settings.ENV)
    yield

    log.info("Shutting down KODMOD AI")
    if app.state.checkpointer_pool is not None:
        await app.state.checkpointer_pool.close()
    if settings.VECTOR_BACKEND == "qdrant":
        from rag.stores.qdrant_store import close_client

        try:
            await close_client()
        except Exception:
            log.exception("Could not close the Qdrant client cleanly")
    await close_db()


app = FastAPI(
    title="KODMOD AI",
    version=settings.APP_VERSION,
    description="Agentic learning assistant for visually impaired students.",
    lifespan=lifespan,
)


# ---- Middleware -----------------------------------------------------------
app.add_middleware(ProviderContextMiddleware)
# Credentials are allowed, so the origin list must be explicit. A "*" here
# would be rejected by every browser anyway.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ALLOW_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class SecurityHeadersMiddleware:
    """Set baseline HTTP headers on normal and rejected API responses."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        async def with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                headers["X-Content-Type-Options"] = "nosniff"
                headers["X-Frame-Options"] = "DENY"
                headers["Referrer-Policy"] = "no-referrer"
            await send(message)

        await self.app(scope, receive, with_headers)


app.add_middleware(SecurityHeadersMiddleware)


# ---- Routers --------------------------------------------------------------

app.include_router(health.router)
app.include_router(auth.router, prefix="/auth")
app.include_router(chat.router, prefix="/chat")
app.include_router(classrooms.router, prefix="/classes")
app.include_router(material_assets.router, prefix="/classes")
app.include_router(quiz.router, prefix="/quiz", tags=["quiz"])
app.include_router(learning.router, prefix="/learning")
app.include_router(student.router, prefix="/student")
app.include_router(teacher.router, prefix="/teacher")
app.include_router(editorial_quizzes.router)
app.include_router(admin.router, prefix="/admin")
app.include_router(admin_insights.router, prefix="/admin")
app.include_router(admin_materials.router, prefix="/admin")
app.include_router(subjects.router, prefix="/subjects")
app.include_router(subjects.documents_router, prefix="/documents")
app.include_router(analytics.router, prefix="/analytics")
app.include_router(progress_guidance.router, prefix="/analytics")
app.include_router(exercise.router, prefix="/exercise", tags=["exercise"])
app.include_router(content.router, prefix="/content", tags=["content"])
app.include_router(voice.router, prefix="/voice", tags=["voice"])
app.include_router(chat_stream.router, prefix="/ws", tags=["websocket"])
app.include_router(voice_stream.router, prefix="/ws", tags=["websocket", "voice"])


# ---- Prometheus -----------------------------------------------------------

app.mount("/metrics", make_asgi_app())
