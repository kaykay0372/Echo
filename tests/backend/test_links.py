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


# TESTS FOR /notes/{note_id}/links ENDPOINT


async def _create_note(client, body="x") -> str:
    return (
        await client.post("/notes", json={"note_type": "text", "body": body})
    ).json()["id"]


async def _create_link(
    client,
    note_a: str,
    note_b: str,
    *,
    status: str = "pending_approval",
    link_type: str = "automatic",
    similarity_score: float | None = 0.5,
    created_at: str = "2026-01-01T00:00:00.000Z",
) -> tuple[str, str, str]:
    source, target = sorted([note_a, note_b])
    link_id = str(uuid4())
    confirmed_at = created_at if status == "confirmed" else None
    await client.app.state.db.execute(
        "INSERT INTO links (id, source_note_id, target_note_id, link_type, "
        "similarity_score, status, created_at, confirmed_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (
            link_id,
            source,
            target,
            link_type,
            similarity_score,
            status,
            created_at,
            confirmed_at,
        ),
    )
    await client.app.state.db.commit()
    return link_id, source, target


async def test_list_links_empty_when_none_exist(client):
    note_id = await _create_note(client)

    response = await client.get(f"/notes/{note_id}/links")
    assert response.status_code == 200
    assert response.json() == []


async def test_list_links_returns_link_regardless_of_direction(client):
    note_a = await _create_note(client, "a")
    note_b = await _create_note(client, "b")
    link_id, source, target = await _create_link(
        client, note_a, note_b, status="confirmed"
    )

    # Both notes are party to the link
    for note_id in (note_a, note_b):
        response = await client.get(f"/notes/{note_id}/links")
        assert response.status_code == 200
        ids = [link["id"] for link in response.json()]
        assert link_id in ids


async def test_list_links_returned_fields_match_link_schema(client):
    note_a = await _create_note(client, "a")
    note_b = await _create_note(client, "b")
    link_id, source, target = await _create_link(
        client, note_a, note_b, status="confirmed", similarity_score=0.73
    )

    response = await client.get(f"/notes/{note_a}/links")
    assert response.status_code == 200
    [link] = response.json()
    assert link["id"] == link_id
    assert link["source_note_id"] == source
    assert link["target_note_id"] == target
    assert link["link_type"] == "automatic"
    assert link["similarity_score"] == 0.73
    assert link["status"] == "confirmed"
    assert link["confirmed_at"] is not None


async def test_list_links_manual_link_has_null_similarity_score(client):
    note_a = await _create_note(client, "a")
    note_b = await _create_note(client, "b")
    await _create_link(
        client,
        note_a,
        note_b,
        status="confirmed",
        link_type="manual",
        similarity_score=None,
    )

    response = await client.get(f"/notes/{note_a}/links")
    [link] = response.json()
    assert link["link_type"] == "manual"
    assert link["similarity_score"] is None


async def test_list_links_status_filter_confirmed_excludes_pending(client):
    note_a = await _create_note(client, "a")
    note_b = await _create_note(client, "b")
    note_c = await _create_note(client, "c")
    await _create_link(client, note_a, note_b, status="confirmed")
    await _create_link(client, note_a, note_c, status="pending_approval")

    response = await client.get(
        f"/notes/{note_a}/links", params={"status": "confirmed"}
    )
    assert response.status_code == 200
    statuses = {link["status"] for link in response.json()}
    assert statuses == {"confirmed"}


async def test_list_links_status_filter_pending_excludes_confirmed(client):
    note_a = await _create_note(client, "a")
    note_b = await _create_note(client, "b")
    note_c = await _create_note(client, "c")
    await _create_link(client, note_a, note_b, status="confirmed")
    await _create_link(client, note_a, note_c, status="pending_approval")

    response = await client.get(
        f"/notes/{note_a}/links", params={"status": "pending_approval"}
    )
    assert response.status_code == 200
    statuses = {link["status"] for link in response.json()}
    assert statuses == {"pending_approval"}


async def test_list_links_rejected_status_is_a_valid_filter(client):
    note_a = await _create_note(client, "a")
    note_b = await _create_note(client, "b")
    await _create_link(client, note_a, note_b, status="rejected")

    response = await client.get(f"/notes/{note_a}/links", params={"status": "rejected"})
    assert response.status_code == 200
    assert len(response.json()) == 1


async def test_list_links_invalid_status_filter_returns_400(client):
    note_id = await _create_note(client)

    response = await client.get(f"/notes/{note_id}/links", params={"status": "bogus"})
    assert response.status_code == 400


async def test_list_links_no_filter_returns_every_status(client):
    note_a = await _create_note(client, "a")
    note_b = await _create_note(client, "b")
    note_c = await _create_note(client, "c")
    note_d = await _create_note(client, "d")
    await _create_link(client, note_a, note_b, status="confirmed")
    await _create_link(client, note_a, note_c, status="pending_approval")
    await _create_link(client, note_a, note_d, status="rejected")

    response = await client.get(f"/notes/{note_a}/links")
    assert response.status_code == 200
    statuses = {link["status"] for link in response.json()}
    assert statuses == {"confirmed", "pending_approval", "rejected"}


async def test_list_links_excludes_link_to_soft_deleted_note(client):
    note_a = await _create_note(client, "a")
    note_b = await _create_note(client, "b")
    # Confirmed links survive soft-delete (only pending links are discarded
    # on delete)
    await _create_link(client, note_a, note_b, status="confirmed")

    await client.delete(f"/notes/{note_b}")

    response = await client.get(f"/notes/{note_a}/links")
    assert response.status_code == 200
    assert response.json() == []


async def test_list_links_only_returns_links_for_the_requested_note(client):
    note_a = await _create_note(client, "a")
    note_b = await _create_note(client, "b")
    note_c = await _create_note(client, "c")
    await _create_link(client, note_a, note_b, status="confirmed")

    response = await client.get(f"/notes/{note_c}/links")
    assert response.status_code == 200
    assert response.json() == []


async def test_list_links_ordered_newest_first(client):
    note_a = await _create_note(client, "a")
    note_b = await _create_note(client, "b")
    note_c = await _create_note(client, "c")
    older_id, *_ = await _create_link(
        client, note_a, note_b, status="confirmed", created_at="2025-01-01T00:00:00.000Z"
    )
    newer_id, *_ = await _create_link(
        client, note_a, note_c, status="confirmed", created_at="2026-06-01T00:00:00.000Z"    )

    response = await client.get(f"/notes/{note_a}/links")
    ids = [link["id"] for link in response.json()]
    assert ids == [newer_id, older_id]


async def test_list_links_nonexistent_note_returns_404(client):
    response = await client.get(f"/notes/{uuid4()}/links")
    assert response.status_code == 404


async def test_list_links_soft_deleted_note_returns_404(client):
    note_id = await _create_note(client)
    await client.delete(f"/notes/{note_id}")

    response = await client.get(f"/notes/{note_id}/links")
    assert response.status_code == 404


async def test_list_links_malformed_uuid_returns_422(client):
    response = await client.get("/notes/not-a-valid-uuid/links")
    assert response.status_code == 422


async def test_list_links_reflects_confirm_action(client):
    note_a = await _create_note(client, "a")
    note_b = await _create_note(client, "b")
    link_id, *_ = await _create_link(client, note_a, note_b, status="pending_approval")

    await client.post(f"/links/{link_id}/confirm")

    response = await client.get(
        f"/notes/{note_a}/links", params={"status": "confirmed"}
    )
    ids = [link["id"] for link in response.json()]
    assert link_id in ids

    response = await client.get(
        f"/notes/{note_a}/links", params={"status": "pending_approval"}
    )
    assert response.json() == []
