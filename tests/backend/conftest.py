import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from backend import chroma_store, database
from main import app


@pytest_asyncio.fixture
async def client(tmp_path, monkeypatch):
    """Full app with real lifespan context, but with a temporary database and chroma collection."""
    
    monkeypatch.setattr(database, "DB_PATH", tmp_path / "test_echo.db")
    monkeypatch.setattr(chroma_store, "CHROMA_PATH", str(tmp_path / "test_chroma"))

    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac


@pytest_asyncio.fixture
async def client_with_overrides(client):
    """Full app with dependency overrides cleared after the test."""

    yield client
    app.dependency_overrides.clear()
