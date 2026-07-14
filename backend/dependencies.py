from enum import Enum
from typing import Annotated
from fastapi import Query
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
    discarded = "discarded"  # see sql_schema.sql: TC-DEL-05


class TagType(str, Enum):
    manual = "manual"
    automatic = "automatic"


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


# Query parameters

NotesLimit = Annotated[int, Query(ge=1, le=200)]
ConnectionsLimit = Annotated[int, Query(ge=1, le=50)]
IncludeDeleted = Annotated[bool, Query()]
NoteTypeFilter = Annotated[NoteType | None, Query()]
TagIdFilter = Annotated[str | None, Query()]
SearchQuery = Annotated[str | None, Query(max_length=200)]
