from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from backend.dependencies import LinkStatus, LinkType


class Link(BaseModel):
    # model_config = ConfigDict(from_attributes=True)

    id: str
    source_note_id: str
    target_note_id: str
    link_type: LinkType
    similarity_score: float | None = Field(default=None, ge=0.0, le=1.0)
    status: LinkStatus
    created_at: datetime
    confirmed_at: datetime | None = None
