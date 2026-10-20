"""Private decoded classroom image assets. Never serve an upload's original bytes."""

import hashlib
import uuid
from io import BytesIO
from pathlib import Path

from fastapi import HTTPException
from PIL import Image, UnidentifiedImageError
from sqlalchemy import select

from config.settings import settings
from database.models import ClassMaterial, Classroom, Enrollment, MaterialAsset

MAX_ASSET_BYTES = 10 * 1024 * 1024
MAX_ASSET_PIXELS = 20_000_000


def normalize_asset(data: bytes) -> tuple[bytes, str, int, int]:
    if not data or len(data) > MAX_ASSET_BYTES:
        raise HTTPException(422, "Ukuran gambar maksimal 10 MiB.")
    try:
        with Image.open(BytesIO(data)) as image:
            kind = image.format
            if (
                kind not in ("PNG", "JPEG", "WEBP")
                or image.width * image.height > MAX_ASSET_PIXELS
                or getattr(image, "n_frames", 1) != 1
            ):
                raise ValueError("Unsupported image")
            image.load()
            # Rebuild pixels, dropping EXIF, comments, ICC and unrelated metadata.
            mode = "RGBA" if "A" in image.getbands() and kind != "JPEG" else "RGB"
            clean = Image.frombytes(mode, image.size, image.convert(mode).tobytes())
            output = BytesIO()
            clean.save(output, format=kind)
            encoded = output.getvalue()
            if len(encoded) > MAX_ASSET_BYTES:
                raise ValueError("Encoded image too large")
            return (
                encoded,
                {"PNG": "image/png", "JPEG": "image/jpeg", "WEBP": "image/webp"}[kind],
                image.width,
                image.height,
            )
    except (ValueError, OSError, UnidentifiedImageError, Image.DecompressionBombError) as error:
        raise HTTPException(
            422, "Gunakan gambar PNG, JPEG, atau WebP hingga 20 megapiksel."
        ) from error


def asset_root() -> Path:
    return settings.UPLOAD_DIR.resolve() / "material-assets"


def asset_path(asset) -> Path:
    root = asset_root()
    path = (root / asset.storage_key).resolve()
    if not path.is_relative_to(root) or not path.is_file():
        raise HTTPException(404, "Gambar tidak ditemukan.")
    return path


def asset_ids(document):
    return {b.asset_id for b in document.blocks if b.type == "image"}


async def validate_document_assets(session, class_id, document):
    for asset_id in asset_ids(document):
        row = await session.get(MaterialAsset, asset_id)
        if row is None or row.class_id != class_id:
            raise HTTPException(422, "Gambar tidak berasal dari kelas ini.")


async def store_material_asset(session, actor, class_id, file):
    classroom = await session.get(Classroom, class_id)
    if (
        classroom is None
        or actor.role not in ("teacher", "admin")
        or (actor.role == "teacher" and classroom.teacher_id != actor.id)
    ):
        raise HTTPException(404, "Kelas tidak ditemukan.")
    if classroom.is_archived:
        raise HTTPException(409, "Buka arsip kelas sebelum mengunggah gambar.")
    data = await file.read(MAX_ASSET_BYTES + 1)
    encoded, mime, width, height = normalize_asset(data)
    ident = uuid.uuid4()
    extension = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}[mime]
    key = f"{ident}.{extension}"
    path = asset_root() / key
    path.parent.mkdir(parents=True, exist_ok=True)
    row = MaterialAsset(
        id=ident,
        class_id=class_id,
        owner_id=actor.id,
        mime_type=mime,
        sha256=hashlib.sha256(encoded).hexdigest(),
        size_bytes=len(encoded),
        width=width,
        height=height,
        storage_key=key,
    )
    try:
        path.write_bytes(encoded)
        session.add(row)
        await session.flush()
        await session.commit()
    except BaseException:
        path.unlink(missing_ok=True)
        raise
    return {
        "id": str(ident),
        "mime_type": mime,
        "width": width,
        "height": height,
        "size_bytes": len(encoded),
    }


async def authorized_asset(session, actor, class_id, asset_id):
    classroom = await session.get(Classroom, class_id)
    asset = await session.get(MaterialAsset, asset_id)
    if classroom is None or asset is None or asset.class_id != class_id:
        raise HTTPException(404, "Gambar tidak ditemukan.")
    if actor.role == "admin" or (actor.role == "teacher" and classroom.teacher_id == actor.id):
        return asset
    if (
        actor.role != "student"
        or classroom.is_archived
        or await session.get(Enrollment, (class_id, actor.id)) is None
    ):
        raise HTTPException(404, "Gambar tidak ditemukan.")
    from api.material_document import material_document

    materials = (
        await session.scalars(
            select(ClassMaterial).where(
                ClassMaterial.class_id == class_id,
                ClassMaterial.published.is_(True),
                ClassMaterial.document.is_not(None),
            )
        )
    ).all()
    if not any(asset_id in asset_ids(material_document(material)) for material in materials):
        raise HTTPException(404, "Gambar tidak ditemukan.")
    return asset
