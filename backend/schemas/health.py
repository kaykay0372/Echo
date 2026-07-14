from pydantic import BaseModel


class ModelStatus(BaseModel):
    sentence_transformers: bool
    whisper: bool
    blip: bool
    surya: bool


class StorageStatus(BaseModel):
    sqlite: bool
    chromadb: bool


class QueueStatus(BaseModel):
    pending_jobs: int
    failed_jobs: int


class HealthResponse(BaseModel):
    status: str  # "ok" | "degraded"
    models: ModelStatus
    storage: StorageStatus | None = None
    queue: QueueStatus | None = None
