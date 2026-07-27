from pathlib import Path
from uuid import uuid4

import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from backend.chroma_store import init_chroma
from backend.database import init_sqlite
from backend.dependencies import AppError, app_error_handler
from backend.routes.links import router as links_router
from backend.routes.notes import router as notes_router

SCHEMA_PATH = Path(__file__).resolve().parents[2] / "backend" / "sql_schema.sql"


@pytest_asyncio.fixture
async def client(tmp_path):
    app = FastAPI()
    app.add_exception_handler(AppError, app_error_handler)
    app.include_router(links_router)
    app.include_router(notes_router)
    app.state.db = await init_sqlite(
        db_path=tmp_path / "test.db", schema_path=SCHEMA_PATH
    )
    app.state.chroma_collection = init_chroma(path=str(tmp_path / "chroma"))

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        ac.app = app
        yield ac
    await app.state.db.close()


async def _create_pending_link(client) -> tuple[str, str, str]:
    note_a = (
        await client.post("/notes", json={"note_type": "text", "body": "a"})
    ).json()["id"]
    note_b = (
        await client.post("/notes", json={"note_type": "text", "body": "b"})
    ).json()["id"]
    source, target = sorted([note_a, note_b])

    link_id = str(uuid4())
    await client.app.state.db.execute(
        "INSERT INTO links (id, source_note_id, target_note_id, link_type, "
        "status, created_at) VALUES (?, ?, ?, 'automatic', 'pending_approval', '2026-01-01T00:00:00Z')",
        (link_id, source, target),
    )
    await client.app.state.db.commit()
    return link_id, source, target


async def test_link_confirm_moves_pending_to_confirmed(client):
    link_id, _, _ = await _create_pending_link(client)

    response = await client.post(f"/links/{link_id}/confirm")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "confirmed"
    assert body["confirmed_at"] is not None


async def test_link_reject_moves_pending_to_rejected(client):
    link_id, _, _ = await _create_pending_link(client)

    response = await client.post(f"/links/{link_id}/reject")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "rejected"
    assert body["confirmed_at"] is None


async def test_confirming_already_confirmed_link_returns_400(client):
    link_id, _, _ = await _create_pending_link(client)
    await client.post(f"/links/{link_id}/confirm")

    response = await client.post(f"/links/{link_id}/confirm")
    assert response.status_code == 400


async def test_rejecting_already_rejected_link_returns_400(client):
    link_id, _, _ = await _create_pending_link(client)
    await client.post(f"/links/{link_id}/reject")

    response = await client.post(f"/links/{link_id}/reject")
    assert response.status_code == 400


async def test_confirming_nonexistent_link_returns_404(client):
    response = await client.post(f"/links/{uuid4()}/confirm")
    assert response.status_code == 404


async def test_reject_nonexistent_link_returns_404(client):
    response = await client.post(f"/links/{uuid4()}/reject")
    assert response.status_code == 404
