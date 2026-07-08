from contextlib import asynccontextmanager
from fastapi import FastAPI

# from backend.database import init_db
# from backend.chroma_store import init_chroma


@asynccontextmanager
async def lifespan(app: FastAPI):
    # --- Startup: runs once, before the app accepts any requests ---
    # init_db()
    # init_chroma()
    yield
    # --- Shutdown: runs once, when the app is stopping ---


# FastAPI gives you a browsable API documentation page for free at /docs, built directly from your route definitions and Pydantic models
app = FastAPI(title="Echo API", lifespan=lifespan)


@app.get("/")
def home():
    return {"message": "Welcome to Echo"}


@app.get("/health")
def health_check():
    return {"status": "ok"}


# Routers:

# from backend.routers import notes
# app.include_router(notes.router, prefix="/notes", tags=["Notes"])