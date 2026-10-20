"""Authenticated private classroom images."""

import uuid

from fastapi import APIRouter, Depends, UploadFile
from fastapi.responses import FileResponse

from api.dependencies import current_user, db_session
from api.material_assets import asset_path, authorized_asset, store_material_asset

router = APIRouter(tags=["material-assets"])


@router.post("/{class_id}/material-assets", status_code=201)
async def upload_asset(
    class_id: uuid.UUID, file: UploadFile, user=Depends(current_user), session=Depends(db_session)
):
    return await store_material_asset(session, user, class_id, file)


@router.get("/{class_id}/material-assets/{asset_id}")
async def read_asset(
    class_id: uuid.UUID,
    asset_id: uuid.UUID,
    user=Depends(current_user),
    session=Depends(db_session),
):
    asset = await authorized_asset(session, user, class_id, asset_id)
    return FileResponse(
        asset_path(asset),
        media_type=asset.mime_type,
        headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"},
    )
