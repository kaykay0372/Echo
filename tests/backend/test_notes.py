from pathlib import Path


import uuid
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from backend.chroma_store import init_chroma
from backend.database import init_sqlite
from backend.routes.notes import router as notes_router
from backend.dependencies import AppError, app_error_handler

SCHEMA_PATH = Path(__file__).resolve().parents[2] / "backend" / "sql_schema.sql"


@pytest_asyncio.fixture
async def client(tmp_path):
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
    app.include_router(notes_router)
    app.state.db = await init_sqlite(
        db_path=tmp_path / "test.db", schema_path=SCHEMA_PATH
    )
    app.state.chroma_collection = init_chroma(path=str(tmp_path / "chroma"))

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        ac.app = (
            app  # attached so tests can reach app.state.db/chroma_collection directly
        )
        yield ac
    await app.state.db.close()


async def test_create_text_note_queues_embed_job(client):
    response = await client.post(
        "/notes", json={"note_type": "text", "body": "hello world"}
    )
    assert response.status_code == 201
    body = response.json()
    assert body["embedding_status"] == "pending"
    assert body["word_count"] == 2

    jobs = await client.app.state.db.execute_fetchall(
        "SELECT job_type, status FROM jobs WHERE note_id = ?", (body["id"],)
    )
    assert jobs == [("embed", "queued")]


async def test_create_canvas_note_skips_embedding_and_queues_no_job(client):
    response = await client.post("/notes", json={"note_type": "canvas"})
    assert response.status_code == 201
    body = response.json()
    assert body["embedding_status"] == "skipped"

    jobs = await client.app.state.db.execute_fetchall(
        "SELECT id FROM jobs WHERE note_id = ?", (body["id"],)
    )
    assert jobs == []


async def test_get_note_not_found_returns_404(client):
    response = await client.get(f"/notes/{uuid.uuid4()}")
    assert response.status_code == 404
    assert response.json()["error"] == "not_found"


async def test_get_deleted_note_returns_404(client):
    created = await client.post("/notes", json={"note_type": "text", "body": "x"})
    note_id = created.json()["id"]
    await client.delete(f"/notes/{note_id}")

    response = await client.get(f"/notes/{note_id}")
    assert response.status_code == 404


async def test_update_note_body_resets_embedding_and_requeues(client):
    created = await client.post(
        "/notes", json={"note_type": "text", "body": "original"}
    )
    note_id = created.json()["id"]

    # Simulate the embed job having already completed once.
    await client.app.state.db.execute(
        "UPDATE notes SET embedding_status = 'complete' WHERE id = ?", (note_id,)
    )
    await client.app.state.db.commit()

    response = await client.patch(
        f"/notes/{note_id}", json={"body": "changed content here"}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["embedding_status"] == "pending"
    assert body["word_count"] == 3

    jobs = await client.app.state.db.execute_fetchall(
        "SELECT job_type, status FROM jobs WHERE note_id = ? AND job_type = 'embed' "
        "AND status = 'queued'",
        (note_id,),
    )
    # At least one queued embed job exists to eventually pick up the new body content.
    assert len(jobs) >= 1


async def test_update_note_favourite_only_does_not_requeue_embed(client):
    created = await client.post("/notes", json={"note_type": "text", "body": "x"})
    note_id = created.json()["id"]

    response = await client.patch(f"/notes/{note_id}", json={"is_favourite": True})
    assert response.status_code == 200
    assert response.json()["is_favourite"] is True

    jobs = await client.app.state.db.execute_fetchall(
        "SELECT job_type FROM jobs WHERE note_id = ? AND job_type = 'embed'", (note_id,)
    )
    assert len(jobs) == 1


async def test_delete_then_restore_round_trip(client):
    created = await client.post("/notes", json={"note_type": "text", "body": "x"})
    note_id = created.json()["id"]

    delete_response = await client.delete(f"/notes/{note_id}")
    assert delete_response.status_code == 204

    restore_response = await client.post(f"/notes/{note_id}/restore")
    assert restore_response.status_code == 200
    assert restore_response.json()["is_deleted"] is False


async def test_restore_non_deleted_note_returns_400(client):
    created = await client.post("/notes", json={"note_type": "text", "body": "x"})
    note_id = created.json()["id"]

    response = await client.post(f"/notes/{note_id}/restore")
    assert response.status_code == 400


async def test_permanent_delete_requires_soft_delete_first(client):
    created = await client.post("/notes", json={"note_type": "text", "body": "x"})
    note_id = created.json()["id"]

    response = await client.delete(f"/notes/{note_id}/permanent")
    assert response.status_code == 400


async def test_permanent_delete_after_soft_delete_succeeds(client):
    created = await client.post("/notes", json={"note_type": "text", "body": "x"})
    note_id = created.json()["id"]

    await client.delete(f"/notes/{note_id}")
    response = await client.delete(f"/notes/{note_id}/permanent")
    assert response.status_code == 204

    remaining = await client.app.state.db.execute_fetchall(
        "SELECT id FROM notes WHERE id = ?", (note_id,)
    )
    assert remaining == []


async def test_delete_discards_pending_links_involving_the_note(client):
    note_a = (
        await client.post("/notes", json={"note_type": "text", "body": "a"})
    ).json()["id"]
    note_b = (
        await client.post("/notes", json={"note_type": "text", "body": "b"})
    ).json()["id"]
    source, target = sorted([note_a, note_b])

    await client.app.state.db.execute(
        "INSERT INTO links (id, source_note_id, target_note_id, link_type, status, created_at) "
        "VALUES ('link1', ?, ?, 'automatic', 'pending_approval', '2026-01-01T00:00:00Z')",
        (source, target),
    )
    await client.app.state.db.commit()

    await client.delete(f"/notes/{note_a}")

    remaining_links = await client.app.state.db.execute_fetchall(
        "SELECT id FROM links WHERE id = 'link1'"
    )
    assert remaining_links == []


async def test_list_notes_excludes_deleted_by_default(client):
    kept = (
        await client.post("/notes", json={"note_type": "text", "body": "kept"})
    ).json()["id"]
    deleted = (
        await client.post("/notes", json={"note_type": "text", "body": "deleted"})
    ).json()["id"]
    await client.delete(f"/notes/{deleted}")

    response = await client.get("/notes")
    ids = [n["id"] for n in response.json()["notes"]]
    assert kept in ids
    assert deleted not in ids


async def test_list_notes_filters_by_note_type(client):
    await client.post("/notes", json={"note_type": "text", "body": "a text note"})
    await client.post("/notes", json={"note_type": "canvas"})

    response = await client.get("/notes", params={"note_type": "canvas"})
    types = {n["note_type"] for n in response.json()["notes"]}
    assert types == {"canvas"}


async def test_batch_import_all_valid_notes_succeed(client):
    response = await client.post(
        "/notes/batch",
        json={
            "notes": [
                {"note_type": "text", "body": "first"},
                {"note_type": "text", "body": "second"},
            ]
        },
    )
    assert response.status_code == 207
    body = response.json()
    assert len(body["created"]) == 2
    assert len(body["failed"]) == 0


async def test_connections_returns_409_when_embedding_not_complete(client):
    created = await client.post("/notes", json={"note_type": "text", "body": "x"})
    note_id = created.json()["id"]

    response = await client.get(f"/notes/{note_id}/connections")
    assert response.status_code == 409
    assert response.json()["error"] == "embedding_not_ready"


async def test_connections_returns_similar_notes_excluding_self(client):
    note_a = (
        await client.post("/notes", json={"note_type": "text", "body": "a"})
    ).json()["id"]
    note_b = (
        await client.post("/notes", json={"note_type": "text", "body": "b"})
    ).json()["id"]

    db = client.app.state.db
    chroma = client.app.state.chroma_collection
    for nid, vec in [(note_a, [0.1] * 768), (note_b, [0.1] * 768)]:
        await db.execute(
            "UPDATE notes SET embedding_status = 'complete' WHERE id = ?", (nid,)
        )
        chroma.upsert(
            ids=[nid],
            embeddings=[vec],
            documents=["doc"],
            metadatas=[{"note_type": "text", "is_deleted": False}],
        )
    await db.commit()

    response = await client.get(f"/notes/{note_a}/connections")
    assert response.status_code == 200
    connections = response.json()
    returned_ids = [c["note"]["id"] for c in connections]
    assert note_a not in returned_ids
    assert note_b in returned_ids


async def test_create_attachment_duplicate_content_same_note_returns_409(client):
    note_id = (await client.post("/notes", json={"note_type": "text"})).json()["id"]

    files = {"file": ("test.png", b"identical-bytes", "image/png")}
    first = await client.post(f"/notes/{note_id}/attachments", files=files)
    assert first.status_code == 201

    second = await client.post(f"/notes/{note_id}/attachments", files=files)
    assert second.status_code == 409
    assert second.json()["existing_note_id"] == note_id


async def test_create_attachment_duplicate_content_different_note_is_allowed(client):
    # Fixed schema limitation
    note_a = (await client.post("/notes", json={"note_type": "text"})).json()["id"]
    note_b = (await client.post("/notes", json={"note_type": "text"})).json()["id"]

    files = {"file": ("test.png", b"identical-bytes", "image/png")}
    first = await client.post(f"/notes/{note_a}/attachments", files=files)
    assert first.status_code == 201

    second = await client.post(f"/notes/{note_b}/attachments", files=files)
    assert second.status_code == 201
    assert second.json()["id"] != first.json()["id"]


async def test_create_attachment_image_queues_caption_and_ocr(client):
    note_id = (await client.post("/notes", json={"note_type": "text"})).json()["id"]
    files = {"file": ("test.png", b"some-image-bytes", "image/png")}

    response = await client.post(f"/notes/{note_id}/attachments", files=files)
    assert response.status_code == 201

    jobs = await client.app.state.db.execute_fetchall(
        "SELECT job_type FROM jobs WHERE attachment_id = ?", (response.json()["id"],)
    )
    assert {j[0] for j in jobs} == {"caption", "ocr"}


async def test_create_attachment_audio_queues_transcribe_only(client):
    note_id = (await client.post("/notes", json={"note_type": "text"})).json()["id"]
    files = {"file": ("test.mp3", b"some-audio-bytes", "audio/mpeg")}

    response = await client.post(f"/notes/{note_id}/attachments", files=files)
    assert response.status_code == 201

    jobs = await client.app.state.db.execute_fetchall(
        "SELECT job_type FROM jobs WHERE attachment_id = ?", (response.json()["id"],)
    )
    assert [j[0] for j in jobs] == ["transcribe"]


async def test_create_attachment_missing_note_returns_404(client):
    files = {"file": ("test.png", b"bytes", "image/png")}
    response = await client.post(f"/notes/{uuid.uuid4()}/attachments", files=files)
    assert response.status_code == 404


async def _create_attachment(
    client, note_id, filename="test.png", content=b"bytes", content_type="image/png"
):
    files = {"file": (filename, content, content_type)}
    response = await client.post(f"/notes/{note_id}/attachments", files=files)
    return response.json()


async def test_delete_attachment_removes_row_and_file(client):
    note_id = (await client.post("/notes", json={"note_type": "text"})).json()["id"]
    attachment = await _create_attachment(
        client, note_id, content=b"unique-delete-bytes"
    )
    file_path = Path(
        (
            await client.app.state.db.execute_fetchall(
                "SELECT file_path FROM attachments WHERE id = ?", (attachment["id"],)
            )
        )[0][0]
    )
    assert file_path.exists()

    response = await client.delete(f"/notes/{note_id}/attachments/{attachment['id']}")
    assert response.status_code == 204

    remaining = await client.app.state.db.execute_fetchall(
        "SELECT id FROM attachments WHERE id = ?", (attachment["id"],)
    )
    assert remaining == []
    assert not file_path.exists()


async def test_delete_attachment_cascades_to_its_jobs(client):
    note_id = (await client.post("/notes", json={"note_type": "text"})).json()["id"]
    attachment = await _create_attachment(
        client, note_id, content=b"unique-cascade-deletion-bytes"
    )

    await client.delete(f"/notes/{note_id}/attachments/{attachment['id']}")

    remaining_jobs = await client.app.state.db.execute_fetchall(
        "SELECT id FROM jobs WHERE attachment_id = ?", (attachment["id"],)
    )
    assert remaining_jobs == []


async def test_delete_attachment_nonexistent_returns_404(client):
    note_id = (await client.post("/notes", json={"note_type": "text"})).json()["id"]
    response = await client.delete(f"/notes/{note_id}/attachments/{uuid.uuid4()}")
    assert response.status_code == 404


async def test_delete_attachment_missing_note_returns_404(client):
    response = await client.delete(f"/notes/{uuid.uuid4()}/attachments/{uuid.uuid4()}")
    assert response.status_code == 404


async def test_delete_attachment_belonging_to_a_different_note_returns_404(client):
    note_a = (await client.post("/notes", json={"note_type": "text"})).json()["id"]
    note_b = (await client.post("/notes", json={"note_type": "text"})).json()["id"]
    attachment = await _create_attachment(
        client, note_a, content=b"unique-crosscheck-bytes"
    )

    response = await client.delete(f"/notes/{note_b}/attachments/{attachment['id']}")
    assert response.status_code == 404

    still_there = await client.app.state.db.execute_fetchall(
        "SELECT id FROM attachments WHERE id = ?", (attachment["id"],)
    )
    assert still_there != []


async def test_delete_attachment_survives_file_already_missing_on_disk(client):
    note_id = (await client.post("/notes", json={"note_type": "text"})).json()["id"]
    attachment = await _create_attachment(
        client, note_id, content=b"unique-vanished-bytes"
    )
    file_path = Path(
        (
            await client.app.state.db.execute_fetchall(
                "SELECT file_path FROM attachments WHERE id = ?", (attachment["id"],)
            )
        )[0][0]
    )
    file_path.unlink()  # simulate the file having been removed unconventionally

    response = await client.delete(f"/notes/{note_id}/attachments/{attachment['id']}")
    assert response.status_code == 204


async def test_malformed_uuid_returns_422(client):
    response = await client.get("/notes/not-a-valid-uuid")
    assert response.status_code == 422


async def test_missing_note_type_returns_400(client):
    response = await client.post("/notes", json={"body": "no type given"})
    assert response.status_code == 400


async def test_invalid_note_type_value_returns_400(client):
    response = await client.post(
        "/notes", json={"note_type": "spreadsheet", "body": "x"}
    )
    assert response.status_code == 400


async def test_list_notes_limit_below_minimum_rejected(client):
    response = await client.get("/notes", params={"limit": 0})
    assert response.status_code == 400


async def test_list_notes_limit_above_maximum_rejected(client):
    response = await client.get("/notes", params={"limit": 201})
    assert response.status_code == 400


async def test_list_notes_respects_limit(client):
    for i in range(5):
        await client.post("/notes", json={"note_type": "text", "body": f"note {i}"})

    response = await client.get("/notes", params={"limit": 2})
    assert len(response.json()) == 2


async def test_title_exceeding_500_chars_returns_400(client):
    response = await client.post(
        "/notes", json={"note_type": "text", "title": "x" * 501, "body": "y"}
    )
    assert response.status_code == 400


async def test_body_exceeding_100000_chars_returns_400(client):
    response = await client.post(
        "/notes", json={"note_type": "text", "body": "x" * 100_001}
    )
    assert response.status_code == 400


async def test_list_notes_include_deleted_true_shows_deleted(client):
    note_id = (
        await client.post("/notes", json={"note_type": "text", "body": "x"})
    ).json()["id"]
    await client.delete(f"/notes/{note_id}")

    response = await client.get("/notes", params={"include_deleted": True})
    ids = [n["id"] for n in response.json()["notes"]]
    assert note_id in ids


async def test_list_notes_search_matches_title_or_body(client):
    await client.post(
        "/notes", json={"note_type": "text", "title": "Project Echo", "body": "notes"}
    )
    await client.post(
        "/notes",
        json={"note_type": "text", "title": "Unrelated", "body": "different topic"},
    )

    response = await client.get("/notes", params={"search": "echo"})
    titles = [n["title"] for n in response.json()["notes"]]
    assert "Project Echo" in titles
    assert "Unrelated" not in titles


async def test_list_notes_filters_by_tag_id(client):
    tagged = (
        await client.post("/notes", json={"note_type": "text", "body": "tagged"})
    ).json()["id"]
    untagged = (
        await client.post("/notes", json={"note_type": "text", "body": "untagged"})
    ).json()["id"]

    db = client.app.state.db
    await db.execute(
        "INSERT INTO tags (id, name, created_at) VALUES ('tag1', 'work', '2026-01-01T00:00:00Z')"
    )
    await db.execute(
        "INSERT INTO note_tags (note_id, tag_id) VALUES (?, 'tag1')", (tagged,)
    )
    await db.commit()

    response = await client.get("/notes", params={"tag_id": "tag1"})
    ids = [n["id"] for n in response.json()["notes"]]
    assert tagged in ids
    assert untagged not in ids


async def test_update_note_title_only_also_requeues_embed(client):
    created = await client.post(
        "/notes", json={"note_type": "text", "title": "old", "body": "x"}
    )
    note_id = created.json()["id"]
    await client.app.state.db.execute(
        "UPDATE notes SET embedding_status = 'complete' WHERE id = ?", (note_id,)
    )
    await client.app.state.db.commit()

    response = await client.patch(f"/notes/{note_id}", json={"title": "new title"})
    assert response.status_code == 200
    assert response.json()["embedding_status"] == "pending"


async def test_update_note_missing_returns_404(client):
    response = await client.patch(f"/notes/{uuid.uuid4()}", json={"title": "x"})
    assert response.status_code == 404


async def test_update_note_empty_payload_is_a_noop(client):
    created = await client.post(
        "/notes", json={"note_type": "text", "title": "unchanged", "body": "x"}
    )
    note_id = created.json()["id"]

    response = await client.patch(f"/notes/{note_id}", json={})
    assert response.status_code == 200
    assert response.json()["title"] == "unchanged"


async def test_delete_already_deleted_note_returns_404(client):
    note_id = (
        await client.post("/notes", json={"note_type": "text", "body": "x"})
    ).json()["id"]
    await client.delete(f"/notes/{note_id}")

    response = await client.delete(f"/notes/{note_id}")
    assert response.status_code == 404


async def test_null_title_and_body_valid(client):
    response = await client.post("/notes", json={"note_type": "text"})
    assert response.status_code == 201
    assert response.json()["word_count"] == 0


async def test_restore_never_embedded_note_does_not_queue_generate_links(client):
    note_id = (
        await client.post("/notes", json={"note_type": "text", "body": "x"})
    ).json()["id"]
    # embedding_status is still 'pending' -- never actually completed.
    await client.delete(f"/notes/{note_id}")

    await client.post(f"/notes/{note_id}/restore")

    jobs = await client.app.state.db.execute_fetchall(
        "SELECT job_type FROM jobs WHERE note_id = ? AND job_type = 'generate_links'",
        (note_id,),
    )
    assert jobs == []


async def test_restore_embedded_note_queues_generate_links(client):
    note_id = (
        await client.post("/notes", json={"note_type": "text", "body": "x"})
    ).json()["id"]
    await client.app.state.db.execute(
        "UPDATE notes SET embedding_status = 'complete' WHERE id = ?", (note_id,)
    )
    await client.app.state.db.commit()
    await client.delete(f"/notes/{note_id}")

    await client.post(f"/notes/{note_id}/restore")

    jobs = await client.app.state.db.execute_fetchall(
        "SELECT job_type FROM jobs WHERE note_id = ? AND job_type = 'generate_links'",
        (note_id,),
    )
    assert len(jobs) == 1


async def test_connections_respects_limit_parameter(client):
    note_ids = []
    for i in range(4):

        nid = (
            await client.post("/notes", json={"note_type": "text", "body": f"n{i}"})
        ).json()["id"]
        note_ids.append(nid)

    db = client.app.state.db
    chroma = client.app.state.chroma_collection
    for nid in note_ids:
        await db.execute(
            "UPDATE notes SET embedding_status = 'complete' WHERE id = ?", (nid,)
        )
        chroma.upsert(
            ids=[nid],
            embeddings=[[0.1] * 768],
            documents=["doc"],
            metadatas=[{"note_type": "text", "is_deleted": False}],
        )
    await db.commit()

    response = await client.get(
        f"/notes/{note_ids[0]}/connections", params={"limit": 2}
    )
    assert response.status_code == 200
    assert len(response.json()) <= 2


async def test_connections_excludes_soft_deleted_candidates(client):
    note_a = (
        await client.post("/notes", json={"note_type": "text", "body": "a"})
    ).json()["id"]
    note_b = (
        await client.post("/notes", json={"note_type": "text", "body": "b"})
    ).json()["id"]

    db = client.app.state.db
    chroma = client.app.state.chroma_collection
    for nid in (note_a, note_b):
        await db.execute(
            "UPDATE notes SET embedding_status = 'complete' WHERE id = ?", (nid,)
        )
        chroma.upsert(
            ids=[nid],
            embeddings=[[0.1] * 768],
            documents=["doc"],
            metadatas=[{"note_type": "text", "is_deleted": False}],
        )
    await db.commit()

    await client.delete(f"/notes/{note_b}")
    # Stale Chroma flag is caught by the SQLite lookup regardless of its relevance.
    response = await client.get(f"/notes/{note_a}/connections")
    returned_ids = [c["note"]["id"] for c in response.json()]
    assert note_b not in returned_ids


async def test_batch_import_empty_list_rejected(client):
    response = await client.post("/notes/batch", json={"notes": []})
    assert response.status_code == 400  # TC-BATCH-04


async def test_batch_import_over_fifty_notes_rejected(client):
    notes = [{"note_type": "text", "body": f"n{i}"} for i in range(51)]
    response = await client.post("/notes/batch", json={"notes": notes})
    assert response.status_code == 400


async def test_batch_import_partial_failure_mixed_valid_and_invalid(client):
    response = await client.post(
        "/notes/batch",
        json={
            "notes": [
                {"note_type": "text", "body": "valid note"},
                {"note_type": "not_a_real_type", "body": "invalid"},
            ]
        },
    )
    assert response.status_code == 207
    body = response.json()
    assert len(body["created"]) == 1
    assert len(body["failed"]) == 1
    assert body["failed"][0]["index"] == 1


async def test_note_word_count_zero_for_empty_body(client):
    response = await client.post("/notes", json={"note_type": "text", "body": ""})
    assert response.json()["word_count"] == 0


async def test_note_defaults_show_generated_content_true(client):
    response = await client.post("/notes", json={"note_type": "text", "body": "x"})
    assert response.json()["show_generated_content"] is True
