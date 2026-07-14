from datetime import datetime

from pydantic import BaseModel, ConfigDict

from backend.dependencies import JobStatus, JobType


class Job(BaseModel):
    # model_config = ConfigDict(from_attributes=True)

    id: str
    note_id: str | None = None
    attachment_id: str | None = (
        None  # exactly one of note_id/attachment_id is set (DB CHECK)
    )
    job_type: JobType
    status: JobStatus
    error_message: str | None = None
    retry_count: int = 0
    created_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None
