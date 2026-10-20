"""Private originals and review previews; authorization stays at each API boundary."""

import hashlib
import uuid
from pathlib import Path

from fastapi import HTTPException

from api.durable_jobs import enqueue
from api.material_imports import ALLOWED_IMPORTS, safe_filename
from api.utils.uploads import save_upload
from config.settings import settings
from database.models import BackgroundJob, MaterialImport


def original_path(artifact):
    root = settings.UPLOAD_DIR.resolve()
    path = Path(artifact.stored_path).resolve()
    if not path.is_relative_to(root) or not path.is_file():
        raise HTTPException(404, "Berkas asli tidak tersedia.")
    return path


async def create_import(session, classroom, actor, file, first_page=None, last_page=None):
    if (first_page is None) != (last_page is None) or (
        first_page and (last_page < first_page or last_page - first_page + 1 > 150)
    ):
        raise HTTPException(422, "Pilih rentang halaman yang valid, maksimal 150 halaman.")
    filename = safe_filename(file.filename)
    if first_page and not filename.lower().endswith(".pdf"):
        raise HTTPException(422, "Pilihan halaman hanya tersedia untuk PDF.")
    path = await save_upload(file, allowed_suffixes=ALLOWED_IMPORTS)
    try:
        with path.open("rb") as original:
            digest = hashlib.file_digest(original, "sha256").hexdigest()
        artifact = MaterialImport(
            id=uuid.uuid4(),
            class_id=classroom.id,
            uploaded_by=actor.id,
            filename=filename,
            stored_path=str(path),
            size_bytes=path.stat().st_size,
            sha256=digest,
            job_id=uuid.uuid4(),
        )
        job = await enqueue(
            session,
            "material_import",
            artifact.id,
            {"first_page": first_page, "last_page": last_page},
            f"import:{artifact.id}",
        )
        artifact.job_id = job.id
        session.add(artifact)
        await session.flush()
        await session.commit()
    except BaseException:
        path.unlink(missing_ok=True)
        raise
    return await import_out(session, artifact)


async def import_out(session, artifact, *, include_preview=True):
    job = await session.get(BackgroundJob, artifact.job_id)
    return {
        "import_id": str(artifact.id),
        "job_id": str(job.id),
        "filename": artifact.filename,
        "state": job.state,
        "attempts": job.attempts,
        "error": job.error_message,
        "sha256": artifact.sha256,
        "size_bytes": artifact.size_bytes,
        "created_at": artifact.created_at,
        "preview": job.result if include_preview and job.state == "complete" else None,
    }


async def source_for(session, class_id, import_id):
    if import_id is None:
        return None
    artifact = await session.get(MaterialImport, import_id)
    job = await session.get(BackgroundJob, artifact.job_id) if artifact else None
    if artifact is None or artifact.class_id != class_id:
        raise HTTPException(422, "Berkas sumber tidak berasal dari kelas ini.")
    if (
        job is None
        or job.state != "complete"
        or not (
            (job.result or {}).get("content")
            or (job.result or {}).get("document", {}).get("blocks")
        )
    ):
        raise HTTPException(409, "Tinjau hasil pembacaan dokumen sebelum menyimpan materi.")
    return artifact
