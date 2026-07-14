from fastapi import APIRouter, Query

from backend.dependencies import (
    NotesLimit,
    JobStatus,
    Error400,
    Error404,
    Error500
)
from backend.schemas.job import Job

router = APIRouter(prefix="/jobs", tags=["Jobs"])


@router.get("", response_model=list[Job], responses={500: {"model": Error500}})
async def list_jobs(
    status_filter: JobStatus | None = Query(default=None, alias="status"),
    limit: NotesLimit = 50,
):
    '''List jobs, optionally filtered by status. Default limit 50, max 1000.'''
    return 0


@router.post("/{job_id}/retry", response_model=Job, responses={400: {"model": Error400}, 404: {"model": Error404}, 500: {"model": Error500}})
async def retry_job(job_id: str):
    '''400 if job is not currently in a failed state.'''
    return 0
