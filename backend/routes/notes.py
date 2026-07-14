from fastapi import APIRouter, File, UploadFile, status

from backend.dependencies import (
    ConnectionsLimit,
    IncludeDeleted,
    NotesLimit,
    NoteTypeFilter,
    SearchQuery,
    TagIdFilter,
    Error400,
    Error404,
    Error409,
    Error500,
)
from backend.schemas.attachment import Attachment
from backend.schemas.note import (
    BatchImportRequest,
    BatchImportResponse,
    Note,
    NoteConnection,
    NoteCreate,
    NoteUpdate,
)

router = APIRouter(prefix="/notes", tags=["Notes"])


@router.get("", response_model=list[Note], responses={500: {"model": Error500}})
async def list_notes(
    limit: NotesLimit = 50,
    include_deleted: IncludeDeleted = False,
    note_type: NoteTypeFilter = None,
    tag_id: TagIdFilter = None,
    search: SearchQuery = None,
):
    '''List notes, optionally filtered by type, tag or search query. Default limit 50, max 1000.'''
    return 0


@router.post(
    "",
    response_model=Note,
    status_code=status.HTTP_201_CREATED,
    responses={400: {"model": Error400}, 500: {"model": Error500}},
)
async def create_note(payload: NoteCreate):
    '''Must respond in <200ms (NF-01); ML jobs dispatch async.'''
    return 0


@router.post(
    "/batch",
    response_model=BatchImportResponse,
    status_code=status.HTTP_207_MULTI_STATUS,
    responses={400: {"model": Error400}, 500: {"model": Error500}},
)
async def batch_import_notes(payload: BatchImportRequest):
    '''Each note is created independently and errors are reported per-note in the response.'''
    return 0


@router.get(
    "/{note_id}",
    response_model=Note,
    responses={404: {"model": Error404}, 500: {"model": Error500}},
)
async def get_note(note_id: str):
    '''404 if note is soft-deleted (is_deleted=true).'''
    return 0


@router.patch(
    "/{note_id}",
    response_model=Note,
    responses={
        400: {"model": Error400},
        404: {"model": Error404},
        500: {"model": Error500},
    },
)
async def update_note(note_id: str, payload: NoteUpdate):
    '''Partial update, body/title changes re-queue an embed job.'''
    return 0


@router.delete(
    "/{note_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={404: {"model": Error404}, 500: {"model": Error500}},
)
async def delete_note(note_id: str):
    '''404 if note is soft-deleted (is_deleted=true).'''
    return 0


@router.delete(
    "/{note_id}/permanent",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={
        400: {"model": Error400},
        404: {"model": Error404},
        500: {"model": Error500},
    },
)
async def permanently_delete_note(note_id: str):
    '''Requires the note to already be soft-deleted.'''
    return 0


@router.post(
    "/{note_id}/restore",
    response_model=Note,
    responses={
        400: {"model": Error400},
        404: {"model": Error404},
        500: {"model": Error500},
    },
)
async def restore_note(note_id: str):
    '''404 if note is not soft-deleted (is_deleted=false).'''
    return 0


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
async def create_attachment(note_id: str, file: UploadFile = File(...)):
    '''409 on content_hash collision.'''
    return 0


@router.get(
    "/{note_id}/connections",
    response_model=list[NoteConnection],
    responses={
        404: {"model": Error404},
        409: {"model": Error409},
        500: {"model": Error500},
    },
)
async def get_note_connections(note_id: str, limit: ConnectionsLimit = 5):
    '''409 if embedding isn't complete yet.'''
    return 0
