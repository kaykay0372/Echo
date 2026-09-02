import hashlib
import uuid
from datetime import datetime, timezone
from pathlib import Path


import aiosqlite
from typing import Annotated
from pydantic import BaseModel
from fastapi import APIRouter, Depends, File, Query, UploadFile, status

from backend.dependencies import (
    ConnectionsLimit,
    IncludeDeleted,
    NotesLimit,
    NoteTypeFilter,
    LinkStatus,
    SearchQuery,
    TagIdFilter,
    FavouriteFilter,
    DeletedOnly,
    Error400,
    Error404,
    Error409,
    Error500,
    ValidationError,
    NotFoundError,
    ConflictError,
    get_db,
    get_chroma,
)
from backend.schemas.attachment import Attachment
from backend.schemas.link import Link
from backend.schemas.note import (
    BatchImportRequest,
    BatchImportResponse,
    BatchImportFailure,
    Note,
    NoteConnection,
    NoteCreate,
    NoteUpdate,
    NoteListResponse,
)

router = APIRouter(prefix="/notes", tags=["Notes"])

ATTACHMENTS_DIR = Path("./data/attachments")


def _now_iso() -> str:
    now = datetime.now(timezone.utc)
    return now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"


def _new_id() -> str:
    return str(uuid.uuid4())


async def _fetch_note_row(
    db, note_id: str, include_deleted: bool = False
) -> dict | None:
    cursor = await db.execute("SELECT * FROM notes WHERE id = ?", (note_id,))
    row = await cursor.fetchone()
    if row is None:
        return None
    columns = [d[0] for d in cursor.description]
    note = dict(zip(columns, row))
    if note["is_deleted"] and not include_deleted:
        return None
    return note


async def _fetch_attachments(db, note_id: str) -> list[dict]:
    cursor = await db.execute("SELECT * FROM attachments WHERE note_id = ?", (note_id,))
    rows = await cursor.fetchall()
    columns = [d[0] for d in cursor.description]
    return [dict(zip(columns, row)) for row in rows]


async def _fetch_tags(db, note_id: str) -> list[dict]:
    cursor = await db.execute(
        "SELECT t.* FROM tags t JOIN note_tags nt ON nt.tag_id = t.id WHERE nt.note_id = ?",
        (note_id,),
    )
    rows = await cursor.fetchall()
    columns = [d[0] for d in cursor.description]
    return [dict(zip(columns, row)) for row in rows]


async def _to_note_response(db, note_row: dict) -> Note:
    attachments = await _fetch_attachments(db, note_row["id"])
    tags = await _fetch_tags(db, note_row["id"])
    # SQLite has no native boolean type.
    return Note(
        **{
            **note_row,
            "show_generated_content": bool(note_row["show_generated_content"]),
            "is_favourite": bool(note_row["is_favourite"]),
            "is_deleted": bool(note_row["is_deleted"]),
        },
        attachments=[Attachment(**a) for a in attachments],
        tags=tags,
    )


async def _queue_job(
    db, job_type: str, note_id: str | None = None, attachment_id: str | None = None
) -> None:
    try:
        await db.execute(
            "INSERT INTO jobs (id, note_id, attachment_id, job_type, status, created_at) "
            "VALUES (?, ?, ?, ?, 'queued', ?)",
            (_new_id(), note_id, attachment_id, job_type, _now_iso()),
        )
    except aiosqlite.IntegrityError:
        pass  # an active job for this target already exists


async def _create_note_row(db, payload: NoteCreate) -> dict:
    note_id = _new_id()
    now = _now_iso()
    word_count = len((payload.body or "").split())

    # Canvas notes are never embedded.
    embedding_status = "skipped" if payload.note_type == "canvas" else "pending"

    await db.execute(
        "INSERT INTO notes (id, note_type, title, body, embedding_status, "
        "show_generated_content, word_count, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            note_id,
            payload.note_type.value,
            payload.title,
            payload.body,
            embedding_status,
            int(payload.show_generated_content),
            word_count,
            now,
            now,
        ),
    )

    if embedding_status == "pending":
        await _queue_job(db, "embed", note_id=note_id)

    await db.commit()
    return await _fetch_note_row(db, note_id)


class NotesListParams(BaseModel):
    limit: NotesLimit = 50
    include_deleted: IncludeDeleted = False
    note_type: NoteTypeFilter = None
    tag_id: TagIdFilter = None
    search: SearchQuery = None
    favourite: FavouriteFilter = None
    deleted_only: DeletedOnly = False
    cursor: str | None = None


@router.get("", response_model=NoteListResponse, responses={500: {"model": Error500}})
async def list_notes(params: Annotated[NotesListParams, Query()], db=Depends(get_db)):
    """List notes, optionally filtered by type, tag or search query. Default limit 50, max 200."""

    query = "SELECT DISTINCT n.* FROM notes n"
    joins = []
    conditions = []
    sql_params: list = []

    if params.tag_id:
        joins.append("JOIN note_tags nt ON nt.note_id = n.id")
        conditions.append("nt.tag_id = ?")
        sql_params.append(params.tag_id)

    if params.deleted_only:
        conditions.append("n.is_deleted = 1")
    elif not params.include_deleted:
        conditions.append("n.is_deleted = 0")
    if params.note_type:
        conditions.append("n.note_type = ?")
        sql_params.append(params.note_type.value)
    if params.search:
        conditions.append("(n.title LIKE ? OR n.body LIKE ?)")
        search_param = f"%{params.search}%"
        sql_params.extend([search_param, search_param])
    if params.favourite is not None:
        conditions.append("n.is_favourite = ?")
        sql_params.append(1 if params.favourite else 0)

    if joins:
        query += " " + " ".join(joins)
    if conditions:
        query += " WHERE " + " AND ".join(conditions)
    if params.cursor:
        # The cursor encodes the last row's (updated_at, id) from the previous page, and this tuple comparison fetches only rows that sort after it.
        try:
            cursor_updated_at, cursor_id = params.cursor.split("_", 1)
        except ValueError:
            raise ValidationError("Malformed cursor")
        sql_params.extend([cursor_updated_at, cursor_id])
        query += " WHERE " if "WHERE" not in query else " AND "
        query += "(n.updated_at, n.id) < (?, ?)"
    query += " ORDER BY n.updated_at DESC, n.id DESC LIMIT ?"
    sql_params.append(params.limit)

    db_cursor = await db.execute(query, sql_params)
    rows = await db_cursor.fetchall()
    columns = [d[0] for d in db_cursor.description]
    note_rows = [dict(zip(columns, row)) for row in rows]

    notes = [await _to_note_response(db, row) for row in note_rows]
    next_cursor = None
    if len(note_rows) == params.limit:
        last = note_rows[-1]
        next_cursor = f"{last['updated_at']}_{last['id']}"
    return NoteListResponse(notes=notes, next_cursor=next_cursor)


@router.post(
    "",
    response_model=Note,
    status_code=status.HTTP_201_CREATED,
    responses={400: {"model": Error400}, 500: {"model": Error500}},
)
async def create_note(payload: NoteCreate, db=Depends(get_db)):
    """Asynchronous note creation."""

    note_row = await _create_note_row(db, payload)

    return await _to_note_response(db, note_row)


@router.post(
    "/batch",
    response_model=BatchImportResponse,
    status_code=status.HTTP_207_MULTI_STATUS,
    responses={400: {"model": Error400}, 500: {"model": Error500}},
)
async def batch_import_notes(payload: BatchImportRequest, db=Depends(get_db)):
    """Each note is created independently and errors are reported per-note in the response."""

    created: list[Note] = []
    failed: list[BatchImportFailure] = []

    for index, raw_note in enumerate(payload.notes):
        try:
            note_create = NoteCreate(**raw_note)
            note_row = await _create_note_row(db, note_create)
            created.append(await _to_note_response(db, note_row))
        except Exception as exc:
            failed.append(BatchImportFailure(index=index, reason=str(exc)))

    return BatchImportResponse(created=created, failed=failed)


@router.get(
    "/{note_id}",
    response_model=Note,
    responses={404: {"model": Error404}, 500: {"model": Error500}},
)
async def get_note(note_id: uuid.UUID, db=Depends(get_db)):
    """Retrieves a note and serves 404 if note is soft-deleted (is_deleted=true)."""

    note_id = str(note_id)
    note_row = await _fetch_note_row(db, note_id)
    if note_row is None:
        raise NotFoundError(f"Note {note_id} not found")

    return await _to_note_response(db, note_row)


@router.patch(
    "/{note_id}",
    response_model=Note,
    responses={
        400: {"model": Error400},
        404: {"model": Error404},
        500: {"model": Error500},
    },
)
async def update_note(note_id: uuid.UUID, payload: NoteUpdate, db=Depends(get_db)):
    """Partial update, body/title changes re-queue an embed job."""

    note_id = str(note_id)
    note_row = await _fetch_note_row(db, note_id)
    if note_row is None:
        raise NotFoundError(f"Note {note_id} not found")

    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        return await _to_note_response(db, note_row)

    content_changed = "title" in updates or "body" in updates
    set_clauses = []
    params: list = []
    for field, value in updates.items():
        column_value = int(value) if isinstance(value, bool) else value
        set_clauses.append(f"{field} = ?")
        params.append(column_value)

    if "body" in updates:
        set_clauses.append("word_count = ?")
        params.append(len((updates.get("body") or "").split()))

    if content_changed and note_row["note_type"] != "canvas":
        set_clauses.append("embedding_status = 'pending'")

    params.append(note_id)
    await db.execute(f"UPDATE notes SET {', '.join(set_clauses)} WHERE id = ?", params)

    if content_changed and note_row["note_type"] != "canvas":
        await _queue_job(db, "embed", note_id=note_id)

    await db.commit()
    updated_row = await _fetch_note_row(db, note_id)

    return await _to_note_response(db, updated_row)


@router.delete(
    "/{note_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={404: {"model": Error404}, 500: {"model": Error500}},
)
async def delete_note(note_id: uuid.UUID, db=Depends(get_db)):
    """Soft-deletes a note."""

    note_id = str(note_id)
    note_row = await _fetch_note_row(db, note_id)
    if note_row is None:
        raise NotFoundError(f"Note {note_id} not found")

    await db.execute(
        "UPDATE notes SET is_deleted = 1, deleted_at = ? WHERE id = ?",
        (_now_iso(), note_id),
    )
    # Discard pending suggestions but leave confirmed links.
    await db.execute(
        "DELETE FROM links WHERE status = 'pending_approval' "
        "AND (source_note_id = ? OR target_note_id = ?)",
        (note_id, note_id),
    )
    await db.commit()


@router.delete(
    "/{note_id}/permanent",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={
        400: {"model": Error400},
        404: {"model": Error404},
        500: {"model": Error500},
    },
)
async def permanently_delete_note(
    note_id: uuid.UUID, db=Depends(get_db), chroma=Depends(get_chroma)
):
    """Requires the note to already be soft-deleted to permanently delete a note."""

    note_id = str(note_id)
    note_row = await _fetch_note_row(db, note_id, include_deleted=True)
    if note_row is None:
        raise NotFoundError(f"Note {note_id} not found")
    if not note_row["is_deleted"]:
        raise ValidationError(
            f"Note {note_id} must be soft-deleted before permanent deletion"
        )

    await db.execute("DELETE FROM notes WHERE id = ?", (note_id,))
    await db.commit()
    try:
        chroma.delete(ids=[note_id])
    except Exception:
        pass  # pending embedding or canvas note


@router.post(
    "/{note_id}/restore",
    response_model=Note,
    responses={
        400: {"model": Error400},
        404: {"model": Error404},
        500: {"model": Error500},
    },
)
async def restore_note(note_id: uuid.UUID, db=Depends(get_db)):
    """Restore a soft-deleted note."""

    note_id = str(note_id)
    note_row = await _fetch_note_row(db, note_id, include_deleted=True)
    if note_row is None:
        raise NotFoundError(f"Note {note_id} not found")
    if not note_row["is_deleted"]:
        raise ValidationError(f"Note {note_id} is not deleted")

    await db.execute(
        "UPDATE notes SET is_deleted = 0, deleted_at = NULL WHERE id = ?", (note_id,)
    )
    if note_row["embedding_status"] == "complete":
        await _queue_job(db, "generate_links", note_id=note_id)
    await db.commit()

    restored_row = await _fetch_note_row(db, note_id)
    return await _to_note_response(db, restored_row)


@router.post(
    "/{note_id}/attachments",
    response_model=Attachment,
    status_code=status.HTTP_201_CREATED,
    responses={
        400: {"model": Error400},
        404: {"model": Error404},
        409: {"model": Error409},
        500: {"model": Error500},
    },
)
async def create_attachment(
    note_id: uuid.UUID, file: UploadFile = File(...), db=Depends(get_db)
):
    """Create a new attachment and assign it a unique hash."""

    note_id = str(note_id)
    note_row = await _fetch_note_row(db, note_id)
    if note_row is None:
        raise NotFoundError(f"Note {note_id} not found")

    file_bytes = await file.read()
    content_hash = hashlib.sha256(file_bytes).hexdigest()

    cursor = await db.execute(
        "SELECT id, note_id FROM attachments WHERE content_hash = ? AND note_id = ?",
        (content_hash, note_id),
    )
    existing = await cursor.fetchone()
    if existing:
        raise ConflictError(
            "An attachment with this content already exists on this note",
            existing_note_id=existing[1],
        )

    # Only image and audio attachments are supported, so anything not detected as an image is assumed to be audio rather than checked explicitly.
    file_type = "image" if (file.content_type or "").startswith("image/") else "audio"
    ATTACHMENTS_DIR.mkdir(parents=True, exist_ok=True)
    attachment_id = _new_id()
    dest_path = ATTACHMENTS_DIR / f"{attachment_id}_{file.filename}"
    dest_path.write_bytes(file_bytes)

    now = _now_iso()
    await db.execute(
        "INSERT INTO attachments (id, note_id, file_path, file_type, content_hash, "
        "processing_status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)",
        (attachment_id, note_id, str(dest_path), file_type, content_hash, now),
    )

    if file_type == "image":
        await _queue_job(db, "caption", attachment_id=attachment_id)
        await _queue_job(db, "ocr", attachment_id=attachment_id)
    else:
        await _queue_job(db, "transcribe", attachment_id=attachment_id)

    await db.commit()

    cursor = await db.execute(
        "SELECT * FROM attachments WHERE id = ?", (attachment_id,)
    )
    row = await cursor.fetchone()
    columns = [d[0] for d in cursor.description]
    return Attachment(**dict(zip(columns, row)))


async def _fetch_attachment_row(db, attachment_id: str) -> dict | None:
    cursor = await db.execute(
        "SELECT * FROM attachments WHERE id = ?", (attachment_id,)
    )
    row = await cursor.fetchone()
    if row is None:
        return None
    columns = [d[0] for d in cursor.description]
    return dict(zip(columns, row))


@router.delete(
    "/{note_id}/attachments/{attachment_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={404: {"model": Error404}, 500: {"model": Error500}},
)
async def delete_attachment(
    note_id: uuid.UUID, attachment_id: uuid.UUID, db=Depends(get_db)
):
    """Removes an attachment and its file. Cascades to any queued/running caption/ocr/transcribe job via the schema's ON DELETE CASCADE."""

    note_id = str(note_id)
    attachment_id = str(attachment_id)

    note_row = await _fetch_note_row(db, note_id)
    if note_row is None:
        raise NotFoundError(f"Note {note_id} not found")

    attachment_row = await _fetch_attachment_row(db, attachment_id)
    if attachment_row is None or attachment_row["note_id"] != note_id:
        raise NotFoundError(f"Attachment {attachment_id} not found on note {note_id}")

    await db.execute("DELETE FROM attachments WHERE id = ?", (attachment_id,))
    await db.commit()

    try:
        Path(attachment_row["file_path"]).unlink()
    except OSError:
        pass  # file already missing/moved


@router.get(
    "/{note_id}/connections",
    response_model=list[NoteConnection],
    responses={
        404: {"model": Error404},
        409: {"model": Error409},
        500: {"model": Error500},
    },
)
async def get_note_connections(
    note_id: uuid.UUID,
    limit: ConnectionsLimit = 5,
    db=Depends(get_db),
    chroma=Depends(get_chroma),
):
    """Generate links after embedding is completed."""

    note_id = str(note_id)
    note_row = await _fetch_note_row(db, note_id)
    if note_row is None:
        raise NotFoundError(f"Note {note_id} not found")
    if note_row["embedding_status"] != "complete":
        raise ConflictError(
            "Note exists but its embedding is not yet complete",
            error_code="embedding_not_ready",
        )

    stored = chroma.get(ids=[note_id], include=["embeddings"])
    if not stored["ids"]:
        raise ConflictError(
            "Note exists but its embedding is not yet complete",
            error_code="embedding_not_ready",
        )

    query_vector = stored["embeddings"][0]
    results = chroma.query(
        query_embeddings=[query_vector],
        n_results=limit + 1,  # +1 since the note always matches itself
        where={"is_deleted": False},
    )

    connections: list[NoteConnection] = []
    for candidate_id, distance in zip(results["ids"][0], results["distances"][0]):
        if candidate_id == note_id or len(connections) >= limit:
            continue
        candidate_row = await _fetch_note_row(db, candidate_id)
        if candidate_row is None:
            continue
        similarity = max(0.0, min(1.0, 1 - distance))
        connections.append(
            NoteConnection(
                note=await _to_note_response(db, candidate_row),
                similarity_score=similarity,
            )
        )

    return connections


_VALID_LINK_STATUSES = ("pending_approval", "confirmed", "rejected")


@router.get(
    "/{note_id}/links",
    response_model=list[Link],
    responses={
        400: {"model": Error400},
        404: {"model": Error404},
        500: {"model": Error500},
    },
)
async def list_note_connections(
    note_id: uuid.UUID,
    status_filter: str | None = Query(default=None, alias="status"),
    db=Depends(get_db),
):
    """Lists connections in either direction for this note, newest first."""

    note_id = str(note_id)
    note_row = await _fetch_note_row(db, note_id)
    if note_row is None:
        raise NotFoundError(f"Note {note_id} not found")

    if status_filter is not None and status_filter not in _VALID_LINK_STATUSES:
        raise ValidationError(f"Invalid status filter: {status_filter}")

    query = (
        "SELECT l.* FROM links l "
        "JOIN notes s ON s.id = l.source_note_id "
        "JOIN notes t ON t.id = l.target_note_id "
        "WHERE (l.source_note_id = ? OR l.target_note_id = ?) "
        "AND s.is_deleted = 0 AND t.is_deleted = 0"
    )
    sql_params = [note_id, note_id]
    if status_filter is not None:
        query += " AND l.status = ?"
        sql_params.append(status_filter)
    query += " ORDER BY l.created_at DESC"

    db_cursor = await db.execute(query, sql_params)
    rows = await db_cursor.fetchall()
    columns = [d[0] for d in db_cursor.description]

    return [Link(**dict(zip(columns, row))) for row in rows]
