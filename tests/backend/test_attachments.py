from pathlib import Path
from uuid import uuid4

import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from backend.chroma_store import init_chroma
from backend.database import init_sqlite
from backend.dependencies import AppError, app_error_handler
from backend.routes.attachments import router as attachments_router
from backend.routes.notes import router as notes_router

SCHEMA_PATH = Path(__file__).resolve().parents[2] / "backend" / "sql_schema.sql"


@pytest_asyncio.fixture
async def client(tmp_path):
    app = FastAPI()
    app.add_exception_handler(AppError, app_error_handler)
    app.include_router(attachments_router)
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


async def _create_attachment(
    client, filename="test.png", content=b"bytes", content_type="image/png"
):
    note_id = (await client.post("/notes", json={"note_type": "text"})).json()["id"]
    files = {"file": (filename, content, content_type)}
    response = await client.post(f"/notes/{note_id}/attachments", files=files)
    return response.json()


async def test_get_attachment_file_returns_the_bytes_that_were_uploaded(client):
    attachment = await _create_attachment(
        client,
        filename="photo.png",
        content=b"raw-png-bytes-here",
        content_type="image/png",
    )

    response = await client.get(f"/attachments/{attachment['id']}/file")

    assert response.status_code == 200
    assert response.content == b"raw-png-bytes-here"


async def test_get_attachment_file_sets_content_type_from_extension(client):
    attachment = await _create_attachment(
        client,
        filename="clip.mp3",
        content=b"raw-audio-bytes",
        content_type="audio/mpeg",
    )

    response = await client.get(f"/attachments/{attachment['id']}/file")

    assert response.headers["content-type"] == "audio/mpeg"


async def test_get_attachment_file_nonexistent_id_returns_404(client):
    response = await client.get(f"/attachments/{uuid4()}/file")
    assert response.status_code == 404


async def test_get_attachment_file_malformed_uuid_returns_422(client):
    response = await client.get("/attachments/not-a-valid-uuid/file")
    assert response.status_code == 422


async def test_get_attachment_file_missing_from_disk_returns_404(client):
    attachment = await _create_attachment(client, content=b"will-be-deleted")
    row = await client.app.state.db.execute_fetchall(
        "SELECT file_path FROM attachments WHERE id = ?", (attachment["id"],)
    )
    Path(row[0][0]).unlink()

    response = await client.get(f"/attachments/{attachment['id']}/file")
    assert response.status_code == 404
