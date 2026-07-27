from pathlib import Path

import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from backend.chroma_store import init_chroma
from backend.database import init_sqlite
from backend.routes.notes import router as notes_router
from backend.routes.tags import router as tags_router
from backend.dependencies import AppError, app_error_handler

SCHEMA_PATH = Path(__file__).resolve().parents[2] / "backend" / "sql_schema.sql"


@pytest_asyncio.fixture
async def client(tmp_path):
    from fastapi.exception_handlers import request_validation_exception_handler
    from fastapi.exceptions import RequestValidationError
    from fastapi.responses import JSONResponse

    async def validation_error_handler(request, exc):
        error_locations = {error["loc"][0] for error in exc.errors()}
        if "path" in error_locations:
            return await request_validation_exception_handler(request, exc)
        return JSONResponse(
            status_code=400,
            content={"error": "validation_error", "detail": exc.errors()[0]["msg"]},
        )

    app = FastAPI()
    app.add_exception_handler(AppError, app_error_handler)
    app.add_exception_handler(RequestValidationError, validation_error_handler)
    app.include_router(tags_router)
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


async def _create_note(client) -> str:
    response = await client.post("/notes", json={"note_type": "text", "body": "x"})
    return response.json()["id"]


async def test_creating_manual_tag_succeeds(client):
    response = await client.post("/tags", json={"name": "work"})
    assert response.status_code == 201
    assert response.json()["tag_type"] == "manual"


async def test_creating_automatic_tag_via_api_returns_400(client):
    response = await client.post(
        "/tags", json={"name": "auto-tag", "tag_type": "automatic"}
    )
    assert response.status_code == 400


async def test_tag_list_returns_full_flat_set_hierarchy_reconstructible(client):
    parent = (await client.post("/tags", json={"name": "parent"})).json()
    child_a = (
        await client.post("/tags", json={"name": "child-a", "parent_id": parent["id"]})
    ).json()
    child_b = (
        await client.post("/tags", json={"name": "child-b", "parent_id": parent["id"]})
    ).json()

    response = await client.get("/tags")
    tags = {t["id"]: t for t in response.json()}
    assert tags[child_a["id"]]["parent_id"] == parent["id"]
    assert tags[child_b["id"]]["parent_id"] == parent["id"]
    assert tags[parent["id"]]["parent_id"] is None


async def test_tag_rename_updates_name_only(client):
    tag = (await client.post("/tags", json={"name": "original"})).json()

    response = await client.patch(f"/tags/{tag['id']}", json={"name": "renamed"})
    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "renamed"
    assert body["parent_id"] == tag["parent_id"]


async def test_tag_reparenting_moves_tag_independently(client):
    parent = (await client.post("/tags", json={"name": "parent"})).json()
    child_a = (
        await client.post("/tags", json={"name": "child-a", "parent_id": parent["id"]})
    ).json()
    child_b = (
        await client.post("/tags", json={"name": "child-b", "parent_id": parent["id"]})
    ).json()

    response = await client.patch(f"/tags/{child_a['id']}", json={"parent_id": None})
    assert response.status_code == 200
    assert response.json()["parent_id"] is None

    unaffected = (await client.get("/tags")).json()
    by_id = {t["id"]: t for t in unaffected}
    assert by_id[child_b["id"]]["parent_id"] == parent["id"]
    assert by_id[parent["id"]]["name"] == "parent"


async def test_deleting_parent_orphans_children(client):
    parent = (await client.post("/tags", json={"name": "parent"})).json()
    child_a = (
        await client.post("/tags", json={"name": "child-a", "parent_id": parent["id"]})
    ).json()
    child_b = (
        await client.post("/tags", json={"name": "child-b", "parent_id": parent["id"]})
    ).json()

    response = await client.delete(f"/tags/{parent['id']}")
    assert response.status_code == 204

    remaining = {t["id"]: t for t in (await client.get("/tags")).json()}
    assert child_a["id"] in remaining
    assert child_b["id"] in remaining
    assert remaining[child_a["id"]]["parent_id"] is None
    assert remaining[child_b["id"]]["parent_id"] is None


async def test_deleting_tag_removes_note_tags_assignments(client):
    note_a = await _create_note(client)
    note_b = await _create_note(client)
    tag = (await client.post("/tags", json={"name": "shared"})).json()

    await client.post(f"/notes/{note_a}/tags", json={"tag_id": tag["id"]})
    await client.post(f"/notes/{note_b}/tags", json={"tag_id": tag["id"]})

    await client.delete(f"/tags/{tag['id']}")

    remaining = await client.app.state.db.execute_fetchall(
        "SELECT note_id FROM note_tags WHERE tag_id = ?", (tag["id"],)
    )
    assert remaining == []

    assert (await client.get(f"/notes/{note_a}")).status_code == 200
    assert (await client.get(f"/notes/{note_b}")).status_code == 200


async def test_assigning_tag_to_note_succeeds(client):
    note_id = await _create_note(client)
    tag = (await client.post("/tags", json={"name": "work"})).json()

    response = await client.post(f"/notes/{note_id}/tags", json={"tag_id": tag["id"]})
    assert response.status_code == 201


async def test_assigning_nonexistent_tag_returns_404(client):
    note_id = await _create_note(client)

    response = await client.post(
        f"/notes/{note_id}/tags", json={"tag_id": "does-not-exist"}
    )
    assert response.status_code == 404


async def test_tag_duplicate_assignment_is_idempotent(client):
    note_id = await _create_note(client)
    tag = (await client.post("/tags", json={"name": "work"})).json()

    first = await client.post(f"/notes/{note_id}/tags", json={"tag_id": tag["id"]})
    assert first.status_code == 201

    second = await client.post(f"/notes/{note_id}/tags", json={"tag_id": tag["id"]})
    assert second.status_code == 200  # not 409, not another 201

    rows = await client.app.state.db.execute_fetchall(
        "SELECT * FROM note_tags WHERE note_id = ? AND tag_id = ?", (note_id, tag["id"])
    )
    assert len(rows) == 1


async def test_removing_tag_assignment_succeeds(client):
    note_id = await _create_note(client)
    tag = (await client.post("/tags", json={"name": "work"})).json()
    await client.post(f"/notes/{note_id}/tags", json={"tag_id": tag["id"]})

    response = await client.delete(f"/notes/{note_id}/tags/{tag['id']}")
    assert response.status_code == 204

    rows = await client.app.state.db.execute_fetchall(
        "SELECT * FROM note_tags WHERE note_id = ? AND tag_id = ?", (note_id, tag["id"])
    )
    assert rows == []


async def test_removing_nonexistent_tag_assignment_returns_404(client):
    note_id = await _create_note(client)
    tag = (await client.post("/tags", json={"name": "work"})).json()

    response = await client.delete(f"/notes/{note_id}/tags/{tag['id']}")
    assert response.status_code == 404
