import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query, status

from backend.dependencies import (
    NotesLimit,
    JobStatus,
    Error400,
    Error404,
    Error500,
    ValidationError,
    NotFoundError,
    get_db,
)
from backend.schemas.job import Job

router = APIRouter(prefix="/jobs", tags=["Jobs"])

# Delete a job that is more than 7 days old.
DELETE_AGE_THRESHOLD = timedelta(days=7)


def _parse_created_at(value: str) -> datetime:
    return datetime.strptime(value, "%Y-%m-%dT%H:%M:%S.%fZ").replace(
        tzinfo=timezone.utc
    )


async def _fetch_job_row(db, job_id: str) -> dict | None:
    cursor = await db.execute("SELECT * FROM jobs WHERE id = ?", (job_id,))
    row = await cursor.fetchone()
    if row is None:
        return None
    columns = [d[0] for d in cursor.description]
    return dict(zip(columns, row))


@router.get("", response_model=list[Job], responses={500: {"model": Error500}})
async def list_jobs(
    status_filter: JobStatus | None = Query(default=None, alias="status"),
    limit: NotesLimit = 50,
    db=Depends(get_db),
):
    """Lists jobs in decsending order with an optional status filter."""

    if status_filter:
        cursor = await db.execute(
            "SELECT * FROM jobs WHERE status = ? ORDER BY created_at DESC LIMIT ?",
            (status_filter.value, limit),
        )
    else:
        cursor = await db.execute(
            "SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?", (limit,)
        )
    rows = await cursor.fetchall()
    columns = [d[0] for d in cursor.description]
    return [Job(**dict(zip(columns, row))) for row in rows]


@router.post(
    "/{job_id}/retry",
    response_model=Job,
    responses={
        400: {"model": Error400},
        404: {"model": Error404},
        500: {"model": Error500},
    },
)
async def retry_job(job_id: uuid.UUID, db=Depends(get_db)):
    """Increments retry count, requeues job and checks valid jobs."""

    job_id = str(job_id)
    job_row = await _fetch_job_row(db, job_id)
    if job_row is None:
        raise NotFoundError(f"Job {job_id} not found")
    if job_row["status"] != "failed":
        raise ValidationError(
            f"Job {job_id} is not in a failed state and cannot be retried"
        )

    await db.execute(
        "UPDATE jobs SET status = 'queued', retry_count = retry_count + 1, "
        "error_message = NULL, started_at = NULL, completed_at = NULL WHERE id = ?",
        (job_id,),
    )
    await db.commit()
    return Job(**await _fetch_job_row(db, job_id))


@router.delete(
    "/{job_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={
        400: {"model": Error400},
        404: {"model": Error404},
        500: {"model": Error500},
    },
)
async def delete_job(job_id: uuid.UUID, db=Depends(get_db)):
    """Permanently removes a job row."""

    job_id = str(job_id)
    job_row = await _fetch_job_row(db, job_id)
    if job_row is None:
        raise NotFoundError(f"Job {job_id} not found")

    status_value = job_row["status"]

    if status_value == "running":
        raise ValidationError(f"Job {job_id} is running and cannot be deleted. ")

    if status_value not in ("failed", "discarded"):
        age = datetime.now(timezone.utc) - _parse_created_at(job_row["created_at"])
        if age < DELETE_AGE_THRESHOLD:
            raise ValidationError(
                f"Job {job_id} is {status_value} and less than 7 days old."
            )

    await db.execute("DELETE FROM jobs WHERE id = ?", (job_id,))
    await db.commit()
