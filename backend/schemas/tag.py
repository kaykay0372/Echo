from datetime import datetime

from pydantic import BaseModel

from backend.dependencies import TagType


class Tag(BaseModel):
    id: str
    name: str
    parent_id: str | None = None
    tag_type: TagType
    created_at: datetime


class TagCreate(BaseModel):
    name: str
    parent_id: str | None = None
    tag_type: str | None = None


class TagUpdate(BaseModel):
    name: str | None = None
    parent_id: str | None = None


class AssignTagRequest(BaseModel):
    tag_id: str
