from uuid import uuid4

from backend.dependencies import get_embedder
from main import app


async def test_all_models_and_storage_respond_healthy(client):
    response = await client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert all(body["models"].values())
    assert body["storage"]["sqlite"] is True
    assert body["storage"]["chromadb"] is True


async def test_degraded_status_on_model_unavailability(client_with_overrides):
    app.dependency_overrides[get_embedder] = lambda: None

    response = await client_with_overrides.get("/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "degraded"
    assert body["models"]["sentence_transformers"] is False


async def test_queue_counts_are_accurate(client):
    db = app.state.db
    now = "2026-01-01T00:00:00Z"

    for _ in range(3):
        await db.execute(
            "INSERT INTO notes (id, note_type, word_count, created_at, updated_at) "
            "VALUES (?, 'text', 0, ?, ?)",
            (str(uuid4()), now, now),
        )
    cursor = await db.execute("SELECT id FROM notes")
    note_ids = [row[0] for row in await cursor.fetchall()]

    for note_id, status in zip(note_ids, ["queued", "queued", "queued"]):
        await db.execute(
            "INSERT INTO jobs (id, note_id, job_type, status, created_at) "
            "VALUES (?, ?, 'embed', ?, ?)",
            (str(uuid4()), note_id, status, now),
        )
    await db.execute(
        "INSERT INTO jobs (id, note_id, job_type, status, created_at) "
        "VALUES (?, ?, 'embed', 'failed', ?)",
        (str(uuid4()), note_ids[0], now),
    )
    await db.commit()

    response = await client.get("/health")
    body = response.json()
    assert body["queue"]["pending_jobs"] == 3
    assert body["queue"]["failed_jobs"] == 1
