"""Deterministic OpenAI-compatible stub for load / system tests.

NOT a mock of model quality - it returns canned, deterministic responses so that
Stage 7-9 can exercise the real HTTP/graph/DB/checkpointer path without cost,
network, or GPU. In-process pytest stages patch the LLM in Python instead
(see tests/_fakes/), and never hit this service.

Endpoints:
  GET  /health
  GET  /v1/models
  POST /v1/chat/completions      (streaming + non-streaming)
  POST /v1/embeddings           (1024-dim by default)
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import time

from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse

EMBED_DIM = int(os.getenv("KODMOD_STUB_EMBED_DIM", "1024"))

app = FastAPI(title="kodmod-llm-stub")


def _seeded_vector(text: str, dim: int) -> list[float]:
    """Deterministic unit-ish vector from a text hash."""
    h = hashlib.sha256(text.encode("utf-8")).digest()
    out: list[float] = []
    i = 0
    while len(out) < dim:
        b = h[i % len(h)]
        out.append(((b / 255.0) * 2.0) - 1.0)
        i += 1
        if i % len(h) == 0:
            h = hashlib.sha256(h).digest()
    norm = sum(v * v for v in out) ** 0.5 or 1.0
    return [v / norm for v in out]


def _looks_like_json_request(prompt: str) -> bool:
    p = prompt.lower()
    return "json" in p or "schema" in p or "rubric" in p or '"intent"' in p


def _json_payloads(prompt: str) -> list[dict]:
    decoder = json.JSONDecoder()
    payloads = []
    for match in re.finditer(r"\{", prompt):
        try:
            value, _ = decoder.raw_decode(prompt, match.start())
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            payloads.append(value)
    return payloads


def _grounded_quiz_reply(payload: dict) -> str:
    request = payload["request"]
    sources = [source for source in payload.get("sources", []) if source.get("evidence_id")]
    source = sources[0] if sources else {}
    evidence_id = str(source.get("evidence_id", "missing-source"))
    excerpt = str(source.get("excerpt", "Materi belajar yang tersedia."))
    topic = str(request.get("topic") or "materi")
    count = max(1, min(20, int(request.get("count", 1))))
    concepts = request.get("approved_concepts") or []
    concept_id = request.get("concept_id") or ""
    if concepts:
        first = concepts[0]
        concept_id = first.get("id", "") if isinstance(first, dict) else str(first)

    question_templates = (
        ("Informasi apa yang dijelaskan sumber tentang {topic}?", "recall"),
        ("Apa kesimpulan yang didukung oleh rincian sumber tentang {topic}?", "understanding"),
        (
            "Bagaimana informasi dari sumber dapat digunakan untuk menjelaskan {topic}?",
            "application",
        ),
        ("Alasan apa yang dapat kamu berikan tentang {topic} berdasarkan sumber?", "reasoning"),
    )
    questions = []
    for index in range(count):
        template, cognitive_level = question_templates[index % len(question_templates)]
        question = template.format(topic=topic)
        if index >= len(question_templates):
            question = f"{question} (butir {index + 1})"
        questions.append(
            {
                "text": question,
                "type": "mcq",
                "options": [
                    f"A. {excerpt[:180]}",
                    "B. Informasi yang tidak terdapat dalam sumber",
                    "C. Kebalikan dari informasi pada sumber",
                    "D. Tidak ada informasi yang dapat disimpulkan",
                ],
                "expected_answer": "A",
                "rubric": {"key_points": [excerpt[:180]]},
                "explanation": f"Pilihan A merangkum kutipan sumber: {excerpt[:500]}",
                "evidence_refs": [evidence_id],
                "objective": f"Memahami isi sumber tentang {topic}",
                "cognitive_level": cognitive_level,
                "concept_id": concept_id,
                "difficulty": request.get("difficulty", "easy"),
            }
        )
    return json.dumps({"questions": questions}, ensure_ascii=False)


def _canned_reply(prompt: str) -> str:
    """A safe, accessibility-friendly canned answer.

    If the caller clearly wants JSON (intent router / scoring rubric / analyzer),
    hand back a minimal valid object that downstream parsers accept.
    """
    payloads = _json_payloads(prompt)
    if "strict evidence verifier" in prompt.lower():
        review = next(
            (
                payload
                for payload in reversed(payloads)
                if "questions" in payload and "sources" in payload and "instruction" in payload
            ),
            None,
        )
        if review is not None:
            return json.dumps(
                {
                    "decisions": [
                        {"accepted": True, "reasons": [], "feedback": ""}
                        for _ in review["questions"]
                    ]
                }
            )

    quiz_request = next(
        (
            payload
            for payload in reversed(payloads)
            if isinstance(payload.get("request"), dict) and "sources" in payload
        ),
        None,
    )
    if quiz_request is not None:
        return _grounded_quiz_reply(quiz_request)

    requested = re.search(r"<n_questions>(\d+)</n_questions>", prompt)
    if requested:
        count = max(1, min(20, int(requested.group(1))))
        approved = re.search(
            r"<approved_material_concepts>(.*?)</approved_material_concepts>", prompt
        )
        concepts = json.loads(approved.group(1)) if approved else []
        return json.dumps(
            {
                "questions": [
                    {
                        "text": f"Pada latihan {index + 1}, berapa hasil satu per dua ditambah satu per dua?",
                        "type": "mcq",
                        "options": ["A. satu", "B. dua", "C. nol", "D. tiga"],
                        "expected_answer": "A",
                        "source_indices": [1],
                        "difficulty": "easy",
                        "explanation": "Dua bagian setengah membentuk satu bagian utuh.",
                        "concept_id": concepts[0]["id"] if concepts else "",
                    }
                    for index in range(count)
                ]
            }
        )
    if _looks_like_json_request(prompt):
        return json.dumps(
            {
                "intent": "tutoring",
                "confidence": 0.9,
                "score": 0.8,
                "is_correct": True,
                "feedback": "Jawaban kamu sudah tepat. Teruskan.",
                "misconceptions": [],
                "weak_concepts": [],
                "strong_concepts": [],
                "recommendations": ["Latihan lima soal lagi besok."],
                "reflection_score": 0.8,
            }
        )
    return (
        "Pecahan adalah bilangan yang menyatakan bagian dari keseluruhan. "
        "Pembilang berada di atas dan penyebut berada di bawah. "
        "Penyebut tidak boleh nol."
    )


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "embed_dim": EMBED_DIM}


@app.get("/v1/models")
def models() -> dict:
    now = int(time.time())
    return {
        "object": "list",
        "data": [
            {"id": "stub-chat", "object": "model", "created": now, "owned_by": "kodmod"},
            {
                "id": "text-embedding-3-small",
                "object": "model",
                "created": now,
                "owned_by": "kodmod",
            },
        ],
    }


@app.post("/v1/chat/completions")
async def chat_completions(request: Request):
    body = await request.json()
    messages = body.get("messages", [])
    prompt = "\n".join(str(m.get("content", "")) for m in messages)
    reply = _canned_reply(prompt)
    model = body.get("model", "stub-chat")
    created = int(time.time())
    cid = "chatcmpl-stub-" + hashlib.sha1(prompt.encode()).hexdigest()[:12]

    if body.get("stream"):

        def _gen():
            for tok in reply.split(" "):
                chunk = {
                    "id": cid,
                    "object": "chat.completion.chunk",
                    "created": created,
                    "model": model,
                    "choices": [
                        {"index": 0, "delta": {"content": tok + " "}, "finish_reason": None}
                    ],
                }
                yield f"data: {json.dumps(chunk)}\n\n"
            done = {
                "id": cid,
                "object": "chat.completion.chunk",
                "created": created,
                "model": model,
                "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
            }
            yield f"data: {json.dumps(done)}\n\n"
            yield "data: [DONE]\n\n"

        return StreamingResponse(_gen(), media_type="text/event-stream")

    prompt_tokens = max(1, len(prompt) // 4)
    completion_tokens = max(1, len(reply) // 4)
    return {
        "id": cid,
        "object": "chat.completion",
        "created": created,
        "model": model,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": reply},
                "finish_reason": "stop",
            }
        ],
        "usage": {
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": prompt_tokens + completion_tokens,
        },
    }


@app.post("/v1/embeddings")
async def embeddings(request: Request):
    body = await request.json()
    raw = body.get("input", "")
    inputs = raw if isinstance(raw, list) else [raw]
    dim = int(body.get("dimensions") or EMBED_DIM)
    data = [
        {"object": "embedding", "index": i, "embedding": _seeded_vector(str(t), dim)}
        for i, t in enumerate(inputs)
    ]
    total = sum(max(1, len(str(t)) // 4) for t in inputs)
    return {
        "object": "list",
        "data": data,
        "model": body.get("model", "text-embedding-3-small"),
        "usage": {"prompt_tokens": total, "total_tokens": total},
    }
