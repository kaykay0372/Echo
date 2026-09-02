import uuid
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, Query, Response, status

from backend.dependencies import (
    Error400,
    Error404,
    Error500,
    ValidationError,
    NotFoundError,
    get_db,
)
from backend.schemas.tag import AssignTagRequest, Tag, TagCreate, TagUpdate

router = APIRouter(tags=["Tags"])


def _now_iso() -> str:
    now = datetime.now(timezone.utc)
    return now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"


async def _fetch_tag_row(db, tag_id: str) -> dict | None:
    cursor = await db.execute("SELECT * FROM tags WHERE id = ?", (tag_id,))
    row = await cursor.fetchone()
    if row is None:
        return None
    columns = [d[0] for d in cursor.description]
    return dict(zip(columns, row))


@router.post(
    "/tags",
    response_model=Tag,
    status_code=status.HTTP_201_CREATED,
    responses={400: {"model": Error400}, 500: {"model": Error500}},
)
async def create_tag(payload: TagCreate, db=Depends(get_db)):
    """Creates a new tag and returns it."""

    tag_id = str(uuid.uuid4())
    now = _now_iso()
    await db.execute(
        "INSERT INTO tags (id, name, parent_id, created_at) VALUES (?, ?, ?, ?)",
        (tag_id, payload.name, payload.parent_id, now),
    )
    await db.commit()
    return Tag(**await _fetch_tag_row(db, tag_id))


@router.get("/tags", response_model=list[Tag], responses={500: {"model": Error500}})
async def list_tags(
    sort: Literal["name", "created_at"] = "name",
    order: Literal["asc", "desc"] = "asc",
    limit: int | None = Query(default=None, ge=1, le=500),
    db=Depends(get_db),
):
    """Flat list of all tags, sorted and optionally limited server-side."""

    column = "name" if sort == "name" else "created_at"
    direction = "ASC" if order == "asc" else "DESC"

    # Column/direction are interpolated directly into the SQL string (not parameterised) because SQLite doesn't allow identifiers as bound parameters.
    query = f"SELECT * FROM tags ORDER BY {column} {direction}"
    params = []
    if limit is not None:
        query += " LIMIT ?"
        params.append(limit)

    cursor = await db.execute(query, params)
    rows = await cursor.fetchall()
    columns = [d[0] for d in cursor.description]
    return [Tag(**dict(zip(columns, row))) for row in rows]


@router.patch(
    "/tags/{tag_id}",
    response_model=Tag,
    responses={
        400: {"model": Error400},
        404: {"model": Error404},
        500: {"model": Error500},
    },
)
async def update_tag(tag_id: uuid.UUID, payload: TagUpdate, db=Depends(get_db)):
    """Rename and/or re-parent tags."""

    tag_id = str(tag_id)
    tag_row = await _fetch_tag_row(db, tag_id)
    if tag_row is None:
        raise NotFoundError(f"Tag {tag_id} not found")

    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        return Tag(**tag_row)

    set_clauses = [f"{field} = ?" for field in updates]
    params = list(updates.values()) + [tag_id]
    await db.execute(f"UPDATE tags SET {', '.join(set_clauses)} WHERE id = ?", params)
    await db.commit()
    return Tag(**await _fetch_tag_row(db, tag_id))


@router.delete(
    "/tags/{tag_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={404: {"model": Error404}, 500: {"model": Error500}},
)
async def delete_tag(tag_id: uuid.UUID, db=Depends(get_db)):
    """Tag deleted and child tags orphaned to top-level."""

    # DB schema nulls out any child tags' parent_id automatically when this row is deleted. Orphaning isn't directly happening here.
    tag_id = str(tag_id)
    tag_row = await _fetch_tag_row(db, tag_id)
    if tag_row is None:
        raise NotFoundError(f"Tag {tag_id} not found")

    await db.execute("DELETE FROM tags WHERE id = ?", (tag_id,))
    await db.commit()


@router.post(
    "/notes/{note_id}/tags",
    status_code=status.HTTP_201_CREATED,
    responses={404: {"model": Error404}, 500: {"model": Error500}},
)
async def assign_tag(
    note_id: uuid.UUID,
    payload: AssignTagRequest,
    response: Response,
    db=Depends(get_db),
):
    """Idempotent tag assignment."""

    note_id = str(note_id)

    cursor = await db.execute(
        "SELECT id FROM notes WHERE id = ? AND is_deleted = 0", (note_id,)
    )
    if await cursor.fetchone() is None:
        raise NotFoundError(f"Note {note_id} not found")

    tag_row = await _fetch_tag_row(db, payload.tag_id)
    if tag_row is None:
        raise NotFoundError(f"Tag {payload.tag_id} not found")

    cursor = await db.execute(
        "SELECT 1 FROM note_tags WHERE note_id = ? AND tag_id = ?",
        (note_id, payload.tag_id),
    )
    already_assigned = await cursor.fetchone() is not None

    if already_assigned:
        # Route is declared 200 to signal distinction of idempotent semantics.
        response.status_code = status.HTTP_200_OK
        return {"note_id": note_id, "tag_id": payload.tag_id}

    await db.execute(
        "INSERT INTO note_tags (note_id, tag_id) VALUES (?, ?)",
        (note_id, payload.tag_id),
    )
    await db.commit()
    return {"note_id": note_id, "tag_id": payload.tag_id}


@router.delete(
    "/notes/{note_id}/tags/{tag_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={404: {"model": Error404}, 500: {"model": Error500}},
)
async def remove_tag(note_id: uuid.UUID, tag_id: uuid.UUID, db=Depends(get_db)):
    """Remove a tag from a note."""

    note_id = str(note_id)
    tag_id = str(tag_id)

    cursor = await db.execute(
        "SELECT 1 FROM note_tags WHERE note_id = ? AND tag_id = ?", (note_id, tag_id)
    )
    if await cursor.fetchone() is None:
        raise NotFoundError("Tag assignment not found")

    await db.execute(
        "DELETE FROM note_tags WHERE note_id = ? AND tag_id = ?", (note_id, tag_id)
    )
    await db.commit()
