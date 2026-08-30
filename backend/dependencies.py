from enum import Enum
from typing import Annotated
from fastapi import Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

# Enumerations


class NoteType(str, Enum):
    text = "text"
    image = "image"
    audio = "audio"
    canvas = "canvas"


class EmbeddingStatus(str, Enum):
    pending = "pending"
    processing = "processing"
    complete = "complete"
    failed = "failed"
    skipped = "skipped"


class LinkType(str, Enum):
    automatic = "automatic"
    manual = "manual"


class LinkStatus(str, Enum):
    pending_approval = "pending_approval"
    confirmed = "confirmed"
    rejected = "rejected"


class JobType(str, Enum):
    transcribe = "transcribe"
    caption = "caption"
    ocr = "ocr"
    embed = "embed"
    generate_links = "generate_links"


class JobStatus(str, Enum):
    queued = "queued"
    running = "running"
    complete = "complete"
    failed = "failed"
    discarded = "discarded"


class ElementType(str, Enum):
    shape = "shape"
    arrow = "arrow"
    sticky_note = "sticky_note"
    text_box = "text_box"
    drawing = "drawing"
    frame = "frame"


# Main error response schemas


class Error400(BaseModel):
    error: str
    detail: str


class Error404(BaseModel):
    error: str
    detail: str


class Error409(BaseModel):
    error: str
    detail: str
    existing_note_id: str | None = None


class Error500(BaseModel):
    error: str
    detail: str


# Error control flow


class AppError(Exception):
    status_code = 500
    error_code = "internal_error"

    def __init__(self, detail: str, error_code: str | None = None):
        self.detail = detail
        if error_code:
            self.error_code = error_code


class ValidationError(AppError):
    status_code = 400
    error_code = "validation_error"


class NotFoundError(AppError):
    status_code = 404
    error_code = "not_found"


class ConflictError(AppError):
    status_code = 409
    error_code = "duplicate_content"

    def __init__(
        self,
        detail: str,
        existing_note_id: str | None = None,
        error_code: str | None = None,
    ):
        super().__init__(detail, error_code=error_code)
        self.existing_note_id = existing_note_id


async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
    body = {"error": exc.error_code, "detail": exc.detail}
    if isinstance(exc, ConflictError) and exc.existing_note_id:
        body["existing_note_id"] = exc.existing_note_id
    return JSONResponse(status_code=exc.status_code, content=body)


# Query parameters

NotesLimit = Annotated[int, Query(ge=1, le=200)]
ConnectionsLimit = Annotated[int, Query(ge=1, le=50)]
IncludeDeleted = Annotated[bool, Query()]
NoteTypeFilter = Annotated[NoteType | None, Query()]
TagIdFilter = Annotated[str | None, Query()]
SearchQuery = Annotated[str | None, Query(max_length=200)]
FavouriteFilter = Annotated[bool | None, Query()]
DeletedOnly = Annotated[bool, Query()]


# FastAPI dependency getters


async def get_db(request: Request):
    return request.app.state.db


def get_chroma(request: Request):
    return request.app.state.chroma_collection


def get_embedder(request: Request):
    return request.app.state.embedding_model


def get_whisper(request: Request):
    return request.app.state.whisper_model


def get_blip(request: Request):
    return request.app.state.blip_processor, request.app.state.blip_model


def get_surya(request: Request):
    return request.app.state.surya_detector, request.app.state.surya_recognizer
