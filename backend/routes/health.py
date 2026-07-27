from fastapi import APIRouter, Depends

from backend.chroma_store import check_chroma_alive
from backend.database import check_sqlite_alive
from backend.dependencies import (
    get_chroma,
    get_db,
    get_blip,
    get_embedder,
    get_surya,
    get_whisper,
)
from backend.schemas.health import (
    HealthResponse,
    ModelStatus,
    QueueStatus,
    StorageStatus,
)

router = APIRouter(tags=["System"])


@router.get("/health", response_model=HealthResponse)
async def get_health(
    db=Depends(get_db),
    chroma_collection=Depends(get_chroma),
    embedder=Depends(get_embedder),
    whisper_model=Depends(get_whisper),
    blip=Depends(get_blip),
    surya=Depends(get_surya),
):
    """Overall system health, including model load status, database connectivity and job queue status."""

    blip_processor, blip_model = blip
    surya_detector, surya_recognizer = surya

    models = ModelStatus(
        sentence_transformers=embedder is not None,
        whisper=whisper_model is not None,
        blip=(blip_processor is not None and blip_model is not None),
        surya=(surya_detector is not None and surya_recognizer is not None),
    )

    sqlite_ok = await check_sqlite_alive(db)
    chroma_ok = check_chroma_alive(chroma_collection)
    storage = StorageStatus(sqlite=sqlite_ok, chromadb=chroma_ok)

    cursor = await db.execute(
        "SELECT status, COUNT(*) FROM jobs WHERE status IN ('queued', 'failed') GROUP BY status"
    )
    counts = dict(await cursor.fetchall())
    queue = QueueStatus(
        pending_jobs=counts.get("queued", 0), failed_jobs=counts.get("failed", 0)
    )

    all_models_loaded = all(models.model_dump().values())
    overall_status = (
        "ok" if (all_models_loaded and sqlite_ok and chroma_ok) else "degraded"
    )

    return HealthResponse(
        status=overall_status, models=models, storage=storage, queue=queue
    )
