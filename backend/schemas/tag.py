from datetime import datetime

from pydantic import BaseModel


class Tag(BaseModel):
    id: str
    name: str
    parent_id: str | None = None
    created_at: datetime


class TagCreate(BaseModel):
    name: str
    parent_id: str | None = None


class TagUpdate(BaseModel):
    name: str | None = None
    parent_id: str | None = None


class AssignTagRequest(BaseModel):
    tag_id: str
