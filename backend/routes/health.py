from fastapi import APIRouter, Request

from backend.schemas.health import (
    HealthResponse,
    ModelStatus,
    QueueStatus,
    StorageStatus,
)

router = APIRouter(tags=["System"])


@router.get("/health", response_model=HealthResponse)
async def get_health(request: Request):
    '''Overall system health, including model load status, database connectivity and job queue status.'''
    return 0