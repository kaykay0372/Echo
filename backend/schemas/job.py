from datetime import datetime

from pydantic import BaseModel

from backend.dependencies import JobStatus, JobType


class Job(BaseModel):
    id: str
    note_id: str | None = None
    attachment_id: str | None = None
    job_type: JobType
    status: JobStatus
    error_message: str | None = None
    retry_count: int = 0
    created_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None
