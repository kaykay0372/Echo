"""
Run during development with:
    uvicorn backend.main:app --reload
"""

from contextlib import asynccontextmanager
from fastapi import FastAPI

# from backend.database import init_db
# from backend.chroma_store import init_chroma
from backend.schemas.exceptions import AppError, app_error_handler
from backend.routes import graph, health, jobs, links, notes, tags

@asynccontextmanager
async def lifespan(app: FastAPI):
    # --- Startup: runs once, before the app accepts any requests ---
    # init_db()
    # init_chroma()

    yield
    # --- Shutdown: runs once, when the app is stopping ---

# FastAPI gives you a browsable API documentation page for free at /docs, built directly from your route definitions and Pydantic models
app = FastAPI(title="Echo API", version="1.0.0", lifespan=lifespan)
app.add_exception_handler(AppError, app_error_handler)

@app.get("/")
def home():
    return {"message": "Welcome to Echo"}


# @app.get("/health")
# def health_check():
#     return {"status": "ok"}


# Routers:
for router in (
    health.router,
    notes.router,
    tags.router,
    links.router,
    graph.router,
    jobs.router,
):
    app.include_router(router)