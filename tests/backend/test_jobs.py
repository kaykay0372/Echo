from pathlib import Path
from uuid import uuid4

import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from backend.chroma_store import init_chroma
from backend.database import init_sqlite
from backend.dependencies import AppError, app_error_handler
from backend.routes.jobs import router as jobs_router
from backend.routes.notes import router as notes_router

SCHEMA_PATH = Path(__file__).resolve().parents[2] / "backend" / "sql_schema.sql"


@pytest_asyncio.fixture
async def client(tmp_path):
    app = FastAPI()
    app.add_exception_handler(AppError, app_error_handler)
    app.include_router(jobs_router)
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


async def _insert_job(
    client,
    job_type="generate_links",
    status="queued",
    created_at="2026-01-01T00:00:00Z",
    note_id=None,
):
    note_id = (
        note_id
        or (
            await client.post("/notes", json={"note_type": "text", "body": "x"})
        ).json()["id"]
    )
    job_id = str(uuid4())
    await client.app.state.db.execute(
        "INSERT INTO jobs (id, note_id, job_type, status, created_at) VALUES (?, ?, ?, ?, ?)",
        (job_id, note_id, job_type, status, created_at),
    )
    await client.app.state.db.commit()
    return job_id


async def test_jobs_lists_jobs_ordered_by_created_at_descending(client):
    older = await _insert_job(client, created_at="2025-01-01T00:00:00Z")
    newer = await _insert_job(client, created_at="2026-06-01T00:00:00Z")

    response = await client.get("/jobs")
    ids = [j["id"] for j in response.json()]
    assert ids.index(newer) < ids.index(older)


async def test_jobs_status_filter_returns_only_matching_jobs(client):
    await _insert_job(client, status="queued")
    failed_id = await _insert_job(client, status="failed")

    response = await client.get("/jobs", params={"status": "failed"})
    body = response.json()
    assert all(j["status"] == "failed" for j in body)
    assert any(j["id"] == failed_id for j in body)


async def test_jobs_retry_increments_retry_count_and_requeues(client):
    job_id = await _insert_job(client, status="failed")
    await client.app.state.db.execute(
        "UPDATE jobs SET retry_count = 2, error_message = 'boom' WHERE id = ?",
        (job_id,),
    )
    await client.app.state.db.commit()

    response = await client.post(f"/jobs/{job_id}/retry")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "queued"
    assert body["retry_count"] == 3
    assert body["error_message"] is None


async def test_jobs_retry_non_failed_job_returns_400(client):
    job_id = await _insert_job(client, status="queued")
    response = await client.post(f"/jobs/{job_id}/retry")
    assert response.status_code == 400


async def test_jobs_retry_discarded_job_returns_400(client):
    job_id = await _insert_job(client, status="discarded")
    response = await client.post(f"/jobs/{job_id}/retry")
    assert response.status_code == 400


async def test_retry_nonexistent_job_returns_404(client):
    response = await client.post(f"/jobs/{uuid4()}/retry")
    assert response.status_code == 404


async def test_list_jobs_respects_limit(client):
    for _ in range(3):
        await _insert_job(client)

    response = await client.get("/jobs", params={"limit": 1})
    assert len(response.json()) == 1
