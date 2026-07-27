from pathlib import Path
from uuid import uuid4

import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from backend.chroma_store import init_chroma
from backend.database import init_sqlite
from backend.dependencies import AppError, app_error_handler
from backend.routes.graph import router as graph_router
from backend.routes.notes import router as notes_router

SCHEMA_PATH = Path(__file__).resolve().parents[2] / "backend" / "sql_schema.sql"


@pytest_asyncio.fixture
async def client(tmp_path):
    app = FastAPI()
    app.add_exception_handler(AppError, app_error_handler)
    app.include_router(graph_router)
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


async def test_empty_database_returns_empty_graph(client):
    response = await client.get("/graph")
    assert response.status_code == 200
    body = response.json()
    assert body["nodes"] == []
    assert body["edges"] == []
    assert body["stats"] == {"total_notes": 0, "total_links": 0, "total_embeddings": 0}


async def test_graph_excludes_canvas_and_soft_deleted_notes(client):
    living = (
        await client.post("/notes", json={"note_type": "text", "body": "living"})
    ).json()["id"]
    canvas = (await client.post("/notes", json={"note_type": "canvas"})).json()["id"]
    deleted = (
        await client.post("/notes", json={"note_type": "text", "body": "deleted"})
    ).json()["id"]
    await client.delete(f"/notes/{deleted}")

    response = await client.get("/graph")
    node_ids = [n["id"] for n in response.json()["nodes"]]
    assert living in node_ids
    assert canvas not in node_ids
    assert deleted not in node_ids


async def test_graph_only_confirmed_links_with_live_endpoints_as_edges(client):
    note_a = (
        await client.post("/notes", json={"note_type": "text", "body": "a"})
    ).json()["id"]
    note_b = (
        await client.post("/notes", json={"note_type": "text", "body": "b"})
    ).json()["id"]
    note_c = (
        await client.post("/notes", json={"note_type": "text", "body": "c"})
    ).json()["id"]
    note_d = (
        await client.post("/notes", json={"note_type": "text", "body": "d"})
    ).json()["id"]

    db = client.app.state.db
    now = "2026-01-01T00:00:00Z"

    # Confirmed link between two live notes should appear.
    source1, target1 = sorted([note_a, note_b])
    await db.execute(
        "INSERT INTO links (id, source_note_id, target_note_id, link_type, status, created_at) "
        "VALUES (?, ?, ?, 'automatic', 'confirmed', ?)",
        (str(uuid4()), source1, target1, now),
    )
    # Pending links should NOT appear.
    source2, target2 = sorted([note_a, note_c])
    await db.execute(
        "INSERT INTO links (id, source_note_id, target_note_id, link_type, status, created_at) "
        "VALUES (?, ?, ?, 'automatic', 'pending_approval', ?)",
        (str(uuid4()), source2, target2, now),
    )
    await db.commit()

    # Confirmed link where one endpoint is soft-deleted should NOT appear.
    source3, target3 = sorted([note_c, note_d])
    await db.execute(
        "INSERT INTO links (id, source_note_id, target_note_id, link_type, status, created_at) "
        "VALUES (?, ?, ?, 'automatic', 'confirmed', ?)",
        (str(uuid4()), source3, target3, now),
    )
    await db.commit()
    await client.delete(f"/notes/{note_d}")

    response = await client.get("/graph")
    edges = response.json()["edges"]
    edge_pairs = {(e["source"], e["target"]) for e in edges}

    assert (source1, target1) in edge_pairs
    assert (source2, target2) not in edge_pairs
    assert (source3, target3) not in edge_pairs
    assert len(edges) == 1


async def test_graph_stats_reflect_current_state(client):
    note_a = (
        await client.post("/notes", json={"note_type": "text", "body": "a"})
    ).json()["id"]
    note_b = (
        await client.post("/notes", json={"note_type": "text", "body": "b"})
    ).json()["id"]
    await client.post("/notes", json={"note_type": "canvas"})  # excluded from stats too

    db = client.app.state.db
    await db.execute(
        "UPDATE notes SET embedding_status = 'complete' WHERE id = ?", (note_a,)
    )
    await db.commit()

    source, target = sorted([note_a, note_b])
    await db.execute(
        "INSERT INTO links (id, source_note_id, target_note_id, link_type, status, created_at) "
        "VALUES (?, ?, ?, 'automatic', 'confirmed', '2026-01-01T00:00:00Z')",
        (str(uuid4()), source, target),
    )
    await db.commit()

    response = await client.get("/graph")
    stats = response.json()["stats"]
    assert stats["total_notes"] == 2
    assert stats["total_links"] == 1
    assert stats["total_embeddings"] == 1
