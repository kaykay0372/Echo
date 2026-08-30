import mimetypes
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse

from backend.dependencies import Error404, Error500, NotFoundError, get_db

router = APIRouter(prefix="/attachments", tags=["Attachments"])


@router.get(
    "/{attachment_id}/file",
    responses={404: {"model": Error404}, 500: {"model": Error500}},
)
async def get_attachment_file(attachment_id: uuid.UUID, db=Depends(get_db)):
    """Serves the raw attachment file. (Unauthenticated) """

    attachment_id = str(attachment_id)
    cursor = await db.execute(
        "SELECT file_path FROM attachments WHERE id = ?", (attachment_id,)
    )
    row = await cursor.fetchone()
    if row is None:
        raise NotFoundError(f"Attachment {attachment_id} not found")

    file_path = Path(row[0])
    if not file_path.exists():
        # DB row exists but the file's gone from disk
        raise NotFoundError(f"Attachment {attachment_id}'s file is missing on disk")

    media_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
    return FileResponse(file_path, media_type=media_type)
