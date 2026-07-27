import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends

from backend.dependencies import (
    Error400,
    Error404,
    Error500,
    ValidationError,
    NotFoundError,
    get_db,
)
from backend.schemas.link import Link

router = APIRouter(prefix="/links", tags=["Links"])


def _now_iso() -> str:
    now = datetime.now(timezone.utc)
    return now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"


async def _fetch_link_row(db, link_id: str) -> dict | None:
    cursor = await db.execute("SELECT * FROM links WHERE id = ?", (link_id,))
    row = await cursor.fetchone()
    if row is None:
        return None
    columns = [d[0] for d in cursor.description]
    return dict(zip(columns, row))


async def _set_link_status(
    db, link_id: str, new_status: str, set_confirmed_at: bool
) -> dict:
    if set_confirmed_at:
        await db.execute(
            "UPDATE links SET status = ?, confirmed_at = ? WHERE id = ?",
            (new_status, _now_iso(), link_id),
        )
    else:
        await db.execute(
            "UPDATE links SET status = ? WHERE id = ?", (new_status, link_id)
        )
    await db.commit()
    return await _fetch_link_row(db, link_id)


@router.post(
    "/{link_id}/confirm",
    response_model=Link,
    responses={
        400: {"model": Error400},
        404: {"model": Error404},
        500: {"model": Error500},
    },
)
async def confirm_link(link_id: uuid.UUID, db=Depends(get_db)):
    """Confirm a link and update its status."""

    link_id = str(link_id)
    link_row = await _fetch_link_row(db, link_id)
    if link_row is None:
        raise NotFoundError(f"Link {link_id} not found")
    if link_row["status"] != "pending_approval":
        raise ValidationError(f"Link {link_id} is not pending approval")

    updated = await _set_link_status(db, link_id, "confirmed", set_confirmed_at=True)
    return Link(**updated)


@router.post(
    "/{link_id}/reject",
    response_model=Link,
    responses={
        400: {"model": Error400},
        404: {"model": Error404},
        500: {"model": Error500},
    },
)
async def reject_link(link_id: uuid.UUID, db=Depends(get_db)):
    """Handle link rejection status update."""

    link_id = str(link_id)
    link_row = await _fetch_link_row(db, link_id)
    if link_row is None:
        raise NotFoundError(f"Link {link_id} not found")
    if link_row["status"] != "pending_approval":
        raise ValidationError(f"Link {link_id} is not pending approval")

    updated = await _set_link_status(db, link_id, "rejected", set_confirmed_at=False)
    return Link(**updated)
