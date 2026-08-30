from datetime import datetime

from pydantic import BaseModel, Field

from backend.schemas.attachment import Attachment
from backend.dependencies import EmbeddingStatus, NoteType
from backend.schemas.tag import Tag


class Note(BaseModel):

    id: str
    note_type: NoteType
    title: str | None = None
    body: str | None = None
    embedding_text: str | None = None
    embedding_status: EmbeddingStatus
    show_generated_content: bool
    is_favourite: bool
    is_deleted: bool
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None = None
    word_count: int
    attachments: list[Attachment] = []
    tags: list[Tag] = []


class NoteCreate(BaseModel):
    note_type: NoteType
    title: str | None = Field(default=None, max_length=500)
    body: str | None = Field(default=None, max_length=100000)
    show_generated_content: bool = True


class NoteUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=500)
    body: str | None = Field(default=None, max_length=100000)
    is_favourite: bool | None = None
    show_generated_content: bool | None = None


class NoteConnection(BaseModel):
    note: Note
    similarity_score: float = Field(ge=0.0, le=1.0)

class NoteListResponse(BaseModel):
    notes: list[Note]
    next_cursor: str | None = None


class BatchImportRequest(BaseModel):
    notes: list[dict] = Field(min_length=1, max_length=50)


class BatchImportFailure(BaseModel):
    index: int
    reason: str


class BatchImportResponse(BaseModel):
    created: list[Note]
    failed: list[BatchImportFailure]
