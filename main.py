"""
Run during development with:
    uvicorn main:app --reload
"""

from bootstrap import ensure_ffmpeg_available

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI

from backend import chroma_store, database
from backend.database import init_sqlite
from backend.chroma_store import init_chroma
from backend.models import load_all_models
from backend.job_worker import job_worker_loop, recover_orphaned_jobs, cleanup_old_jobs
from backend.dependencies import AppError, app_error_handler
from backend.routes import attachments, graph, health, jobs, links, notes, tags

from fastapi.middleware.cors import CORSMiddleware

ensure_ffmpeg_available()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # --- Startup: runs once, before the app accepts any requests ---
    app.state.db = await init_sqlite(database.DB_PATH, database.SCHEMA_PATH)
    app.state.chroma_collection = init_chroma(chroma_store.CHROMA_PATH)
    await recover_orphaned_jobs(app.state.db)
    await cleanup_old_jobs(app.state.db)

    models = load_all_models()
    for attr_name, model_obj in models.items():
        setattr(app.state, attr_name, model_obj)

    worker_task = asyncio.create_task(job_worker_loop(app))

    yield

    # --- Shutdown: runs once, after the server stops accepting requests ---
    worker_task.cancel()
    try:
        await worker_task
    except asyncio.CancelledError:
        pass
    await app.state.db.close()


app = FastAPI(title="Echo API", version="1.0.0", lifespan=lifespan)
app.add_exception_handler(AppError, app_error_handler)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:1420", "tauri://localhost"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def home():
    return {"message": "Welcome to Echo"}


for router in (
    health.router,
    notes.router,
    tags.router,
    links.router,
    graph.router,
    jobs.router,
    attachments.router,
):
    app.include_router(router)
