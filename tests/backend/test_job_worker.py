import pytest

from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

from backend.database import init_sqlite
from backend.job_worker import (
    JOB_HANDLERS,
    build_embedding_text,
    _claim_next_job,
    _load_job_context,
    _run_job,
    recover_orphaned_jobs,
    cleanup_old_jobs,
)

SCHEMA_PATH = Path(__file__).resolve().parents[2] / "backend" / "sql_schema.sql"


async def _fresh_db(tmp_path):
    return await init_sqlite(
        db_path=tmp_path / "worker_test.db", schema_path=SCHEMA_PATH
    )


async def _insert_note(db, note_type="text", title="t", body="b"):
    note_id = str(uuid4())
    now = "2026-01-01T00:00:00Z"
    await db.execute(
        "INSERT INTO notes (id, note_type, title, body, word_count, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, 0, ?, ?)",
        (note_id, note_type, title, body, now, now),
    )
    await db.commit()
    return note_id


async def _insert_job(
    db,
    note_id=None,
    job_type="embed",
    status="queued",
    created_at="2026-01-01T00:00:00Z",
):
    job_id = str(uuid4())
    await db.execute(
        "INSERT INTO jobs (id, note_id, job_type, status, created_at) "
        "VALUES (?, ?, ?, ?, ?)",
        (job_id, note_id, job_type, status, created_at),
    )
    await db.commit()
    return job_id


def test_text_note_title_and_body_concatenated():
    result = build_embedding_text(
        note_type="text", title="Ideas", body="write more tests"
    )
    assert "Ideas" in result
    assert "write more tests" in result


def test_text_note_null_title_uses_body_only():
    result = build_embedding_text(note_type="text", title=None, body="just body text")
    assert result == "just body text"


def test_text_note_null_body_uses_title_only():
    result = build_embedding_text(note_type="text", title="just a title", body=None)
    assert result == "just a title"


def test_text_note_with_embedded_image_aggregates_caption_and_ocr():
    result = build_embedding_text(
        note_type="text",
        title=None,
        body="my annotation",
        captions=["a cat on a couch"],
        ocr_texts=["handwritten label: fluffy"],
    )
    assert "a cat on a couch" in result
    assert "handwritten label: fluffy" in result
    assert "my annotation" in result


def test_text_note_with_multiple_embedded_images_aggregates_all_captions():
    result = build_embedding_text(
        note_type="text",
        title=None,
        body=None,
        captions=["a cat on a couch", "a dog in a park"],
    )
    assert "a cat on a couch" in result
    assert "a dog in a park" in result


def test_text_note_missing_ocr_handled_gracefully():
    result = build_embedding_text(
        note_type="text",
        title=None,
        body=None,
        captions=["a cat on a couch"],
        ocr_texts=[],
    )
    assert result == "a cat on a couch"


def test_text_note_with_embedded_audio_transcript_included():
    result = build_embedding_text(
        note_type="text", title="ignored", body="ignored", transcripts=["hello world"]
    )
    assert "hello world" in result
    assert "ignored" in result


def test_canvas_note_raises_value_error():
    with pytest.raises(ValueError):
        build_embedding_text(note_type="canvas", title=None, body=None)


async def test_claim_next_job_returns_none_when_queue_empty(tmp_path):
    db = await _fresh_db(tmp_path)
    assert await _claim_next_job(db) is None
    await db.close()


async def test_claim_next_job_marks_job_running(tmp_path):
    db = await _fresh_db(tmp_path)
    note_id = await _insert_note(db)
    job_id = await _insert_job(db, note_id=note_id)

    claimed = await _claim_next_job(db)

    assert claimed["id"] == job_id
    cursor = await db.execute(
        "SELECT status, started_at FROM jobs WHERE id = ?", (job_id,)
    )
    status, started_at = await cursor.fetchone()
    assert status == "running"
    assert started_at is not None
    await db.close()


async def test_claim_next_job_returns_oldest_first(tmp_path):
    db = await _fresh_db(tmp_path)
    note_a = await _insert_note(db)
    note_b = await _insert_note(db)
    older_id = await _insert_job(db, note_id=note_a, created_at="2025-01-01T00:00:00Z")
    await _insert_job(db, note_id=note_b, created_at="2026-06-01T00:00:00Z")

    claimed = await _claim_next_job(db)
    assert claimed["id"] == older_id
    await db.close()


async def test_load_job_context_for_text_note_embed_job(tmp_path):
    db = await _fresh_db(tmp_path)
    note_id = await _insert_note(db, note_type="text", title="hello", body="world")
    job = {"job_type": "embed", "note_id": note_id, "attachment_id": None}

    context = await _load_job_context(db, job)

    assert context["note_type"] == "text"
    assert context["title"] == "hello"
    assert context["body"] == "world"
    assert context["captions"] == []
    await db.close()


async def test_load_job_context_for_text_note_with_embedded_image(tmp_path):
    db = await _fresh_db(tmp_path)
    note_id = await _insert_note(db, note_type="text", title=None, body="my annotation")
    now = "2026-01-01T00:00:00Z"
    await db.execute(
        "INSERT INTO attachments (id, note_id, file_path, file_type, content_hash, "
        "generated_caption, processing_status, created_at) "
        "VALUES (?, ?, 'x.png', 'image', 'hash1', 'a cat', 'complete', ?)",
        (str(uuid4()), note_id, now),
    )
    await db.commit()

    job = {"job_type": "embed", "note_id": note_id, "attachment_id": None}
    context = await _load_job_context(db, job)

    assert context["captions"] == ["a cat"]
    await db.close()


async def test_load_job_context_aggregates_multiple_attachments_on_one_note(tmp_path):
    db = await _fresh_db(tmp_path)
    note_id = await _insert_note(db, note_type="text", title=None, body=None)
    now = "2026-01-01T00:00:00Z"
    await db.execute(
        "INSERT INTO attachments (id, note_id, file_path, file_type, content_hash, "
        "generated_caption, processing_status, created_at) "
        "VALUES (?, ?, 'a.png', 'image', 'hashA', 'first caption', 'complete', ?)",
        (str(uuid4()), note_id, now),
    )
    await db.execute(
        "INSERT INTO attachments (id, note_id, file_path, file_type, content_hash, "
        "generated_caption, processing_status, created_at) "
        "VALUES (?, ?, 'b.png', 'image', 'hashB', 'second caption', 'complete', ?)",
        (str(uuid4()), note_id, now),
    )
    await db.commit()

    job = {"job_type": "embed", "note_id": note_id, "attachment_id": None}
    context = await _load_job_context(db, job)

    assert context["captions"] == ["first caption", "second caption"]
    await db.close()


async def test_run_job_success_marks_complete(tmp_path):
    db = await _fresh_db(tmp_path)
    note_id = await _insert_note(db, note_type="text", title="t", body="b")
    job_id = await _insert_job(db, note_id=note_id, job_type="embed")

    class FakeVector:
        def tolist(self):
            return [0.0] * 768

    class FakeEmbedder:
        def encode(self, text):
            return FakeVector()

    class FakeCollection:
        def upsert(self, **kwargs):
            self.last_upsert = kwargs

    app = SimpleNamespace(
        state=SimpleNamespace(
            db=db, embedding_model=FakeEmbedder(), chroma_collection=FakeCollection()
        )
    )

    job = await _claim_next_job(db)
    await _run_job(app, job)

    cursor = await db.execute("SELECT status FROM jobs WHERE id = ?", (job_id,))
    (status,) = await cursor.fetchone()
    assert status == "complete"

    cursor = await db.execute(
        "SELECT embedding_status, embedding_text FROM notes WHERE id = ?", (note_id,)
    )
    embedding_status, embedding_text = await cursor.fetchone()
    assert embedding_status == "complete"
    assert embedding_text == "t b"
    await db.close()


async def test_run_job_failure_marks_failed_and_increments_retry_count(tmp_path):
    db = await _fresh_db(tmp_path)
    note_id = await _insert_note(db, note_type="text")
    job_id = await _insert_job(db, note_id=note_id, job_type="embed")

    class BrokenEmbedder:
        def encode(self, text):
            raise RuntimeError("model unavailable")

    app = SimpleNamespace(
        state=SimpleNamespace(
            db=db, embedding_model=BrokenEmbedder(), chroma_collection=None
        )
    )

    job = await _claim_next_job(db)
    await _run_job(app, job)

    cursor = await db.execute(
        "SELECT status, error_message, retry_count FROM jobs WHERE id = ?", (job_id,)
    )
    status, error_message, retry_count = await cursor.fetchone()
    assert status == "failed"
    assert "model unavailable" in error_message
    assert retry_count == 1
    await db.close()


def test_job_handlers_registered_for_all_implemented_types():
    assert set(JOB_HANDLERS.keys()) == {
        "embed",
        "caption",
        "ocr",
        "transcribe",
        "generate_links",
    }


class _FakeChroma:
    """Minimal fake class for a real ChromaDB collection."""

    def __init__(self):
        self.store = {}  # id -> (vector, metadata)

    def upsert(self, ids, embeddings, documents, metadatas):
        for i, id_ in enumerate(ids):
            self.store[id_] = (embeddings[i], metadatas[i])

    def get(self, ids, include=None):
        found_ids, found_embeddings = [], []
        for id_ in ids:
            if id_ in self.store:
                found_ids.append(id_)
                found_embeddings.append(self.store[id_][0])
        return {"ids": found_ids, "embeddings": found_embeddings}

    def query(self, query_embeddings, n_results, where=None):
        candidates = [
            (id_, meta)
            for id_, (_, meta) in self.store.items()
            if where is None or all(meta.get(k) == v for k, v in where.items())
        ]
        ids = [c[0] for c in candidates][:n_results]
        distances = [0.1] * len(ids)
        return {"ids": [ids], "distances": [distances]}


async def test_generate_links_creates_pending_automatic_links_for_similar_notes(
    tmp_path,
):
    db = await _fresh_db(tmp_path)
    note_a = await _insert_note(db, note_type="text")
    note_b = await _insert_note(db, note_type="text")
    await db.execute(
        "UPDATE notes SET embedding_status = 'complete' WHERE id IN (?, ?)",
        (note_a, note_b),
    )
    await db.commit()

    chroma = _FakeChroma()
    chroma.upsert(
        ids=[note_a, note_b],
        embeddings=[[0.1] * 768, [0.1] * 768],
        documents=["a", "b"],
        metadatas=[{"is_deleted": False}, {"is_deleted": False}],
    )

    app = SimpleNamespace(state=SimpleNamespace(db=db, chroma_collection=chroma))
    job_id = await _insert_job(db, note_id=note_a, job_type="generate_links")
    job = await _claim_next_job(db)
    await _run_job(app, job)

    cursor = await db.execute("SELECT status FROM jobs WHERE id = ?", (job_id,))
    (status,) = await cursor.fetchone()
    assert status == "complete"

    source, target = sorted([note_a, note_b])
    links = await db.execute_fetchall(
        "SELECT link_type, status FROM links WHERE source_note_id = ? AND target_note_id = ?",
        (source, target),
    )
    assert links == [("automatic", "pending_approval")]
    await db.close()


async def test_generate_links_skips_already_linked_notes(tmp_path):
    db = await _fresh_db(tmp_path)
    note_a = await _insert_note(db, note_type="text")
    note_b = await _insert_note(db, note_type="text")
    source, target = sorted([note_a, note_b])
    await db.execute(
        "INSERT INTO links (id, source_note_id, target_note_id, link_type, status, created_at) "
        "VALUES (?, ?, ?, 'manual', 'confirmed', '2026-01-01T00:00:00Z')",
        (str(uuid4()), source, target),
    )
    await db.commit()

    chroma = _FakeChroma()
    chroma.upsert(
        ids=[note_a, note_b],
        embeddings=[[0.1] * 768, [0.1] * 768],
        documents=["a", "b"],
        metadatas=[{"is_deleted": False}, {"is_deleted": False}],
    )
    app = SimpleNamespace(state=SimpleNamespace(db=db, chroma_collection=chroma))
    job_id = await _insert_job(db, note_id=note_a, job_type="generate_links")
    job = await _claim_next_job(db)
    await _run_job(app, job)

    links = await db.execute_fetchall(
        "SELECT id FROM links WHERE source_note_id = ? AND target_note_id = ?",
        (source, target),
    )
    assert len(links) == 1
    await db.close()


async def test_completing_embed_enqueues_generate_links(tmp_path):
    db = await _fresh_db(tmp_path)
    note_id = await _insert_note(db, note_type="text", title="t", body="b")

    class FakeVector:
        def tolist(self):
            return [0.0] * 768

    class FakeEmbedder:
        def encode(self, text):
            return FakeVector()

    chroma = _FakeChroma()
    app = SimpleNamespace(
        state=SimpleNamespace(
            db=db, embedding_model=FakeEmbedder(), chroma_collection=chroma
        )
    )

    await _insert_job(db, note_id=note_id, job_type="embed")
    job = await _claim_next_job(db)
    await _run_job(app, job)

    jobs = await db.execute_fetchall(
        "SELECT job_type, status FROM jobs WHERE note_id = ? AND job_type = 'generate_links'",
        (note_id,),
    )
    assert jobs == [("generate_links", "queued")]
    await db.close()


async def test_mid_flight_deletion_discards_job_result(tmp_path):
    db = await _fresh_db(tmp_path)
    note_id = await _insert_note(db, note_type="text", title="t", body="b")

    class FakeVector:
        def tolist(self):
            return [0.0] * 768

    class FakeEmbedder:
        def encode(self, text):
            return FakeVector()

    chroma = _FakeChroma()
    app = SimpleNamespace(
        state=SimpleNamespace(
            db=db, embedding_model=FakeEmbedder(), chroma_collection=chroma
        )
    )

    job_id = await _insert_job(db, note_id=note_id, job_type="embed")
    job = await _claim_next_job(db)  # marks 'running'

    # Simulate the note being soft-deleted WHILE this job is still running.
    await db.execute("UPDATE notes SET is_deleted = 1 WHERE id = ?", (note_id,))
    await db.commit()

    await _run_job(app, job)

    cursor = await db.execute(
        "SELECT status, error_message FROM jobs WHERE id = ?", (job_id,)
    )
    status, error_message = await cursor.fetchone()
    assert status == "discarded"
    assert error_message is not None

    # No embedding should have been written to Chroma or SQLite.
    assert note_id not in chroma.store
    cursor = await db.execute(
        "SELECT embedding_status FROM notes WHERE id = ?", (note_id,)
    )
    (embedding_status,) = await cursor.fetchone()
    assert embedding_status == "pending"

    # No generate_links chaining should have happened for a discarded job.
    chained = await db.execute_fetchall(
        "SELECT id FROM jobs WHERE note_id = ? AND job_type = 'generate_links'",
        (note_id,),
    )
    assert chained == []
    await db.close()


async def test_mid_flight_cancel_discards_job_result(tmp_path):
    db = await _fresh_db(tmp_path)
    note_id = await _insert_note(db, note_type="text", title="t", body="b")

    class FakeVector:
        def tolist(self):
            return [0.0] * 768

    class FakeEmbedder:
        def encode(self, text):
            return FakeVector()

    chroma = _FakeChroma()
    app = SimpleNamespace(
        state=SimpleNamespace(
            db=db, embedding_model=FakeEmbedder(), chroma_collection=chroma
        )
    )

    job_id = await _insert_job(db, note_id=note_id, job_type="embed")
    job = await _claim_next_job(db)  # marks 'running'

    # Simulate a cancel request arriving WHILE this job is still running
    await db.execute("UPDATE jobs SET status = 'discarded' WHERE id = ?", (job_id,))
    await db.commit()

    await _run_job(app, job)

    cursor = await db.execute(
        "SELECT status, error_message, completed_at FROM jobs WHERE id = ?", (job_id,)
    )
    status, error_message, completed_at = await cursor.fetchone()
    assert status == "discarded"
    assert error_message == "Cancelled while running"
    assert completed_at is not None

    # No embedding should have been written to Chroma or SQLite
    assert note_id not in chroma.store
    cursor = await db.execute(
        "SELECT embedding_status FROM notes WHERE id = ?", (note_id,)
    )
    (embedding_status,) = await cursor.fetchone()
    assert embedding_status == "pending"

    # No generate_links chaining should have happened
    chained = await db.execute_fetchall(
        "SELECT id FROM jobs WHERE note_id = ? AND job_type = 'generate_links'",
        (note_id,),
    )
    assert chained == []
    await db.close()


async def test_cancel_does_not_overwrite_an_existing_error_message(tmp_path):
    db = await _fresh_db(tmp_path)
    note_id = await _insert_note(db, note_type="text", title="t", body="b")

    class FakeVector:
        def tolist(self):
            return [0.0] * 768

    class FakeEmbedder:
        def encode(self, text):
            return FakeVector()

    app = SimpleNamespace(
        state=SimpleNamespace(
            db=db, embedding_model=FakeEmbedder(), chroma_collection=_FakeChroma()
        )
    )

    job_id = await _insert_job(db, note_id=note_id, job_type="embed")
    job = await _claim_next_job(db)

    await db.execute(
        "UPDATE jobs SET status = 'discarded', error_message = 'pre-existing note' "
        "WHERE id = ?",
        (job_id,),
    )
    await db.commit()

    await _run_job(app, job)

    cursor = await db.execute("SELECT error_message FROM jobs WHERE id = ?", (job_id,))
    (error_message,) = await cursor.fetchone()
    assert error_message == "pre-existing note"
    await db.close()


async def test_queued_job_never_claimed_after_being_discarded(tmp_path):
    db = await _fresh_db(tmp_path)
    note_id = await _insert_note(db, note_type="text")
    job_id = await _insert_job(db, note_id=note_id, job_type="embed")

    await db.execute("UPDATE jobs SET status = 'discarded' WHERE id = ?", (job_id,))
    await db.commit()

    assert await _claim_next_job(db) is None
    await db.close()


async def test_mid_flight_delete_discards_job_result(tmp_path):
    db = await _fresh_db(tmp_path)
    note_id = await _insert_note(db, note_type="text", title="t", body="b")

    class FakeVector:
        def tolist(self):
            return [0.0] * 768

    class FakeEmbedder:
        def encode(self, text):
            return FakeVector()

    chroma = _FakeChroma()
    app = SimpleNamespace(
        state=SimpleNamespace(
            db=db, embedding_model=FakeEmbedder(), chroma_collection=chroma
        )
    )

    job_id = await _insert_job(db, note_id=note_id, job_type="embed")
    job = await _claim_next_job(db)  # marks 'running'

    # Simulate the job's row being hard-deleted WHILE it's still running.
    await db.execute("DELETE FROM jobs WHERE id = ?", (job_id,))
    await db.commit()

    await _run_job(app, job)

    assert note_id not in chroma.store
    cursor = await db.execute(
        "SELECT embedding_status FROM notes WHERE id = ?", (note_id,)
    )
    (embedding_status,) = await cursor.fetchone()
    assert embedding_status == "pending"

    # No generate_links chaining should have happened
    chained = await db.execute_fetchall(
        "SELECT id FROM jobs WHERE note_id = ? AND job_type = 'generate_links'",
        (note_id,),
    )
    assert chained == []

    remaining = await db.execute_fetchall("SELECT id FROM jobs WHERE id = ?", (job_id,))
    assert remaining == []
    await db.close()


async def test_recover_orphaned_jobs_resets_running_to_queued(tmp_path):
    db = await _fresh_db(tmp_path)
    note_id = await _insert_note(db)
    job_id = await _insert_job(db, note_id=note_id, job_type="embed")
    await _claim_next_job(db)  # marks 'running', sets started_at

    recovered_count = await recover_orphaned_jobs(db)

    assert recovered_count == 1
    cursor = await db.execute(
        "SELECT status, started_at FROM jobs WHERE id = ?", (job_id,)
    )
    status, started_at = await cursor.fetchone()
    assert status == "queued"
    assert started_at is None
    await db.close()


async def test_recover_orphaned_jobs_does_not_touch_retry_count(tmp_path):
    db = await _fresh_db(tmp_path)
    note_id = await _insert_note(db)
    job_id = await _insert_job(db, note_id=note_id, job_type="embed")
    await _claim_next_job(db)

    await recover_orphaned_jobs(db)

    cursor = await db.execute("SELECT retry_count FROM jobs WHERE id = ?", (job_id,))
    (retry_count,) = await cursor.fetchone()
    assert retry_count == 0
    await db.close()


async def test_recover_orphaned_jobs_leaves_other_statuses_alone(tmp_path):
    db = await _fresh_db(tmp_path)
    note_id = await _insert_note(db)
    queued_id = await _insert_job(db, note_id=note_id, status="queued")
    failed_id = await _insert_job(db, note_id=note_id, status="failed")
    complete_id = await _insert_job(db, note_id=note_id, status="complete")
    discarded_id = await _insert_job(db, note_id=note_id, status="discarded")

    recovered_count = await recover_orphaned_jobs(db)

    assert recovered_count == 0
    for job_id, expected_status in (
        (queued_id, "queued"),
        (failed_id, "failed"),
        (complete_id, "complete"),
        (discarded_id, "discarded"),
    ):
        cursor = await db.execute("SELECT status FROM jobs WHERE id = ?", (job_id,))
        (status,) = await cursor.fetchone()
        assert status == expected_status
    await db.close()


async def test_recover_orphaned_jobs_recovered_job_can_be_claimed_again(tmp_path):
    db = await _fresh_db(tmp_path)
    note_id = await _insert_note(db)
    job_id = await _insert_job(db, note_id=note_id, job_type="embed")
    await _claim_next_job(db)  # crash here

    await recover_orphaned_jobs(db)
    claimed = await _claim_next_job(db)

    assert claimed is not None
    assert claimed["id"] == job_id
    await db.close()


def _recent_timestamp():
    now = datetime.now(timezone.utc)
    return now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"


def _old_timestamp():
    old = datetime.now(timezone.utc) - timedelta(days=8)
    return old.strftime("%Y-%m-%dT%H:%M:%S.") + f"{old.microsecond // 1000:03d}Z"


async def test_cleanup_old_jobs_deletes_old_complete_jobs(tmp_path):
    db = await _fresh_db(tmp_path)
    note_id = await _insert_note(db)
    job_id = await _insert_job(
        db, note_id=note_id, status="complete", created_at=_old_timestamp()
    )

    removed_count = await cleanup_old_jobs(db)

    assert removed_count == 1
    remaining = await db.execute_fetchall("SELECT id FROM jobs WHERE id = ?", (job_id,))
    assert remaining == []
    await db.close()


async def test_cleanup_old_jobs_deletes_old_discarded_jobs(tmp_path):
    db = await _fresh_db(tmp_path)
    note_id = await _insert_note(db)
    job_id = await _insert_job(
        db, note_id=note_id, status="discarded", created_at=_old_timestamp()
    )

    removed_count = await cleanup_old_jobs(db)

    assert removed_count == 1
    remaining = await db.execute_fetchall("SELECT id FROM jobs WHERE id = ?", (job_id,))
    assert remaining == []
    await db.close()


async def test_cleanup_old_jobs_leaves_recent_complete_and_discarded_jobs_alone(
    tmp_path,
):
    db = await _fresh_db(tmp_path)
    note_id = await _insert_note(db)
    complete_id = await _insert_job(
        db, note_id=note_id, status="complete", created_at=_recent_timestamp()
    )
    discarded_id = await _insert_job(
        db, note_id=note_id, status="discarded", created_at=_recent_timestamp()
    )

    removed_count = await cleanup_old_jobs(db)

    assert removed_count == 0
    for job_id in (complete_id, discarded_id):
        remaining = await db.execute_fetchall(
            "SELECT id FROM jobs WHERE id = ?", (job_id,)
        )
        assert remaining != []
    await db.close()


async def test_cleanup_old_jobs_never_deletes_failed_jobs_regardless_of_age(tmp_path):
    # A failed job needs to stay visible until it has beem retried
    db = await _fresh_db(tmp_path)
    note_id = await _insert_note(db)
    job_id = await _insert_job(
        db, note_id=note_id, status="failed", created_at=_old_timestamp()
    )

    removed_count = await cleanup_old_jobs(db)

    assert removed_count == 0
    remaining = await db.execute_fetchall("SELECT id FROM jobs WHERE id = ?", (job_id,))
    assert remaining != []
    await db.close()


async def test_cleanup_old_jobs_never_deletes_queued_or_running_jobs_regardless_of_age(
    tmp_path,
):
    db = await _fresh_db(tmp_path)
    note_id = await _insert_note(db)
    queued_id = await _insert_job(
        db,
        note_id=note_id,
        job_type="embed",
        status="queued",
        created_at=_old_timestamp(),
    )
    running_id = await _insert_job(
        db,
        note_id=note_id,
        job_type="generate_links",
        status="running",
        created_at=_old_timestamp(),
    )

    removed_count = await cleanup_old_jobs(db)

    assert removed_count == 0
    for job_id in (queued_id, running_id):
        remaining = await db.execute_fetchall(
            "SELECT id FROM jobs WHERE id = ?", (job_id,)
        )
        assert remaining != []
    await db.close()


async def test_cleanup_old_jobs_handles_a_mix_of_eligible_and_ineligible_jobs(tmp_path):
    db = await _fresh_db(tmp_path)
    note_id = await _insert_note(db)
    old_complete = await _insert_job(
        db, note_id=note_id, status="complete", created_at=_old_timestamp()
    )
    recent_complete = await _insert_job(
        db, note_id=note_id, status="complete", created_at=_recent_timestamp()
    )
    old_failed = await _insert_job(
        db, note_id=note_id, status="failed", created_at=_old_timestamp()
    )

    removed_count = await cleanup_old_jobs(db)

    assert removed_count == 1
    remaining_ids = {row[0] for row in await db.execute_fetchall("SELECT id FROM jobs")}
    assert old_complete not in remaining_ids
    assert recent_complete in remaining_ids
    assert old_failed in remaining_ids
    await db.close()
