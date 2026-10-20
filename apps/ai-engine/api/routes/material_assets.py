"""Authenticated private classroom images."""

import uuid

from fastapi import APIRouter, Depends, UploadFile
from fastapi.responses import FileResponse

from api.dependencies import current_user, db_session
from api.material_assets import asset_path, authorized_asset, store_material_asset

router = APIRouter(tags=["material-assets"])


@router.post(
    "/{class_id}/material-assets",
    status_code=201,
    summary="Upload an image asset for class material",
)
async def upload_asset(
    class_id: uuid.UUID, file: UploadFile, user=Depends(current_user), session=Depends(db_session)
):
    """Store a validated image privately and return its material asset ID."""
    return await store_material_asset(session, user, class_id, file)


@router.get(
    "/{class_id}/material-assets/{asset_id}",
    summary="Read an authorized class material image",
)
async def read_asset(
    class_id: uuid.UUID,
    asset_id: uuid.UUID,
    user=Depends(current_user),
    session=Depends(db_session),
):
    """Return an image only to a current member of the owning class."""
    asset = await authorized_asset(session, user, class_id, asset_id)
    return FileResponse(
        asset_path(asset),
        media_type=asset.mime_type,
        headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"},
    )
