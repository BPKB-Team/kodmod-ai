# syntax=docker/dockerfile:1.7
# ============================================================================
# KODMOD AI - Production Dockerfile
# ============================================================================
# Multi-stage build:
#   1. `builder`  - installs deps into a venv (cacheable layer)
#   2. `runtime`  - slim final image with the venv copied in
#
# Default runtime uses OpenAI embeddings/LLM and ElevenLabs STT/TTS.
# Install the optional CPU cross-encoder with INSTALL_RERANKER=true.
# ============================================================================

ARG BASE_IMAGE=python:3.11-slim-bookworm
ARG APP_USER=kodmod
ARG APP_UID=1001

# ------------------------------------------------------------------- builder --
FROM ${BASE_IMAGE} AS builder
ARG INSTALL_RERANKER=false

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    git \
    curl \
    libsndfile1 \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Create the virtual environment once; pip caches into here.
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Copy only the dep manifests first to maximise layer cache hits.
COPY requirements.txt ./
RUN --mount=type=cache,target=/root/.cache/pip pip install --upgrade pip wheel setuptools \
 && pip install -r requirements.txt

# Now copy the source tree.
COPY . /build
RUN if [ "$INSTALL_RERANKER" = "true" ]; then \
      pip install 'torch>=2.4' --index-url https://download.pytorch.org/whl/cpu \
      && pip install 'sentence-transformers>=3.0'; \
    fi \
 && pip check \
 && python -c "import fastapi, langchain, langgraph, defusedxml, api.main"

# ------------------------------------------------------------------ runtime --
FROM ${BASE_IMAGE} AS runtime

ARG APP_USER
ARG APP_UID

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH" \
    HOME=/home/${APP_USER}

# Runtime deps only.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libsndfile1 \
    ffmpeg \
    curl \
    tini \
    tesseract-ocr \
    tesseract-ocr-ind \
    tesseract-ocr-eng \
    && rm -rf /var/lib/apt/lists/* \
    && useradd -u ${APP_UID} -m -s /bin/bash ${APP_USER}

# Bring in the venv from the builder.
COPY --from=builder /opt/venv /opt/venv

# Bring in the application code.
WORKDIR /app
COPY --from=builder /build /app

# Writable mount points for audio + uploads.
RUN mkdir -p /var/lib/kodmod/audio /var/lib/kodmod/uploads \
 && chown -R ${APP_USER}:${APP_USER} /var/lib/kodmod /app

USER ${APP_USER}

EXPOSE 8000

# Readiness requires the database and Redis; /live alone is insufficient.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD python -c "import json,urllib.request; r=json.load(urllib.request.urlopen('http://127.0.0.1:8000/ready', timeout=4)); assert r['status']=='ready' and r['checks']['redis']=='ok'"

# tini is PID 1 so SIGTERM propagates cleanly to uvicorn.
ENTRYPOINT ["/usr/bin/tini", "--"]

# Default command - use --workers 1 inside k8s and scale via replicas.
CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000", \
     "--workers", "1", "--ws-max-size", "192000", \
     "--log-config", "/app/config/log_conf.json"]
