from pathlib import Path
from uuid import uuid4

import aiosqlite
import pytest

from backend.database import check_sqlite_alive, init_sqlite, recover_interrupted_jobs

SCHEMA_PATH = Path(__file__).resolve().parents[2] / "backend" / "sql_schema.sql"
TEST_TIMESTAMP = "2026-01-01T00:00:00.000Z"


async def _fresh_db(tmp_path, db_name: str = "test.db") -> aiosqlite.Connection:
    return await init_sqlite(db_path=tmp_path / db_name, schema_path=SCHEMA_PATH)


async def _insert_note(
    db,
    note_id=None,
    note_type="text",
    title="t",
    body="b",
    created_at=TEST_TIMESTAMP,
    updated_at=TEST_TIMESTAMP,
):
    note_id = note_id or str(uuid4())
    await db.execute(
        "INSERT INTO notes (id, note_type, title, body, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (note_id, note_type, title, body, created_at, updated_at),
    )
    await db.commit()
    return note_id


async def test_init_sqlite_creates_all_tables_on_fresh_db(tmp_path):
    db = await _fresh_db(tmp_path, "fresh.db")
    cursor = await db.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = {row[0] for row in await cursor.fetchall()}
    expected = {
        "notes",
        "attachments",
        "jobs",
        "links",
        "tags",
        "note_tags",
        "canvas_items",
        "canvas_elements",
    }
    assert expected.issubset(tables)
    await db.close()


async def test_init_sqlite_does_not_rerun_schema_on_existing_db(tmp_path):
    db_name = "existing.db"

    db = await _fresh_db(tmp_path, db_name)
    await _insert_note(db, note_id="n1")
    await db.close()

    # Test data persistance
    db2 = await _fresh_db(tmp_path, db_name)
    cursor = await db2.execute("SELECT COUNT(*) FROM notes")
    (count,) = await cursor.fetchone()
    assert count == 1
    await db2.close()


async def test_check_sqlite_alive_true_for_open_connection(tmp_path):
    db = await _fresh_db(tmp_path)
    assert await check_sqlite_alive(db) is True
    await db.close()


async def test_check_sqlite_alive_false_for_closed_connection(tmp_path):
    db = await _fresh_db(tmp_path)
    await db.close()
    assert await check_sqlite_alive(db) is False


async def test_recover_interrupted_jobs_marks_running_jobs_failed(tmp_path):
    db = await _fresh_db(tmp_path)
    await _insert_note(db, note_id="n1")

    now = TEST_TIMESTAMP
    await db.execute(
        "INSERT INTO jobs (id, note_id, job_type, status, created_at, started_at) "
        "VALUES ('j1', 'n1', 'embed', 'running', ?, ?)",
        (now, now),
    )
    await db.commit()

    recovered_count = await recover_interrupted_jobs(db)
    assert recovered_count == 1

    cursor = await db.execute("SELECT status, error_message FROM jobs WHERE id = 'j1'")
    status, error_message = await cursor.fetchone()
    assert status == "failed"
    assert error_message == "Interrupted by application restart"
    await db.close()


async def test_recover_interrupted_jobs_leaves_other_statuses_untouched(tmp_path):
    db = await _fresh_db(tmp_path)
    await _insert_note(db, note_id="n1")

    now = TEST_TIMESTAMP
    for job_id, job_status in [("j1", "queued"), ("j2", "complete"), ("j3", "failed")]:
        await db.execute(
            "INSERT INTO jobs (id, note_id, job_type, status, created_at) "
            "VALUES (?, 'n1', 'embed', ?, ?)",
            (job_id, job_status, now),
        )
    await db.commit()

    recovered_count = await recover_interrupted_jobs(db)
    assert recovered_count == 0

    rows = await db.execute_fetchall("SELECT id, status FROM jobs ORDER BY id")
    assert rows == [("j1", "queued"), ("j2", "complete"), ("j3", "failed")]
    await db.close()


async def test_updated_at_trigger_fires_on_note_update(tmp_path):
    db = await _fresh_db(tmp_path)
    note_id = await _insert_note(db)

    cursor = await db.execute("SELECT updated_at FROM notes WHERE id = ?", (note_id,))
    (original_updated_at,) = await cursor.fetchone()

    # Deliberately NOT setting updated_at here.
    await db.execute("UPDATE notes SET title = ? WHERE id = ?", ("new title", note_id))
    await db.commit()

    cursor = await db.execute("SELECT updated_at FROM notes WHERE id = ?", (note_id,))
    (new_updated_at,) = await cursor.fetchone()

    assert new_updated_at != original_updated_at
    assert new_updated_at > original_updated_at
    await db.close()


async def test_similarity_score_out_of_range_rejected(tmp_path):
    db = await _fresh_db(tmp_path)
    note_a, note_b = str(uuid4()), str(uuid4())
    # Ensure source < target so this fails on the score check specifically, not the ordering check.
    source, target = sorted([note_a, note_b])
    for nid in (source, target):
        await _insert_note(db, note_id=nid)

    with pytest.raises(aiosqlite.IntegrityError):
        await db.execute(
            "INSERT INTO links (id, source_note_id, target_note_id, link_type, "
            "similarity_score, created_at) VALUES (?, ?, ?, 'automatic', 1.5, ?)",
            (str(uuid4()), source, target, TEST_TIMESTAMP),
        )
    await db.close()


async def test_link_wrong_order_rejected(tmp_path):
    db = await _fresh_db(tmp_path)
    note_a, note_b = str(uuid4()), str(uuid4())
    source, target = sorted([note_a, note_b])
    for nid in (source, target):
        await _insert_note(db, note_id=nid)

    with pytest.raises(aiosqlite.IntegrityError):
        # target > source deliberately reversed
        await db.execute(
            "INSERT INTO links (id, source_note_id, target_note_id, link_type, created_at) "
            "VALUES (?, ?, ?, 'manual', ?)",
            (str(uuid4()), target, source, TEST_TIMESTAMP),
        )
    await db.close()


async def test_duplicate_link_pair_rejected(tmp_path):
    db = await _fresh_db(tmp_path)
    note_a, note_b = str(uuid4()), str(uuid4())
    source, target = sorted([note_a, note_b])
    for nid in (source, target):
        await _insert_note(db, note_id=nid)

    await db.execute(
        "INSERT INTO links (id, source_note_id, target_note_id, link_type, created_at) "
        "VALUES (?, ?, ?, 'manual', ?)",
        (str(uuid4()), source, target, TEST_TIMESTAMP),
    )
    await db.commit()

    with pytest.raises(aiosqlite.IntegrityError):
        await db.execute(
            "INSERT INTO links (id, source_note_id, target_note_id, link_type, created_at) "
            "VALUES (?, ?, ?, 'manual', ?)",
            (str(uuid4()), source, target, TEST_TIMESTAMP),
        )
    await db.close()


async def test_duplicate_active_job_rejected(tmp_path):
    db = await _fresh_db(tmp_path)
    note_id = await _insert_note(db)

    await db.execute(
        "INSERT INTO jobs (id, note_id, job_type, status, created_at) "
        "VALUES (?, ?, 'embed', 'queued', '2026-01-01T00:00:00Z')",
        (str(uuid4()), note_id),
    )
    await db.commit()

    with pytest.raises(aiosqlite.IntegrityError):
        await db.execute(
            "INSERT INTO jobs (id, note_id, job_type, status, created_at) "
            "VALUES (?, ?, 'embed', 'queued', '2026-01-01T00:00:01Z')",
            (str(uuid4()), note_id),
        )
    await db.close()


async def test_new_job_allowed_after_previous_reaches_terminal_state(tmp_path):
    db = await _fresh_db(tmp_path)
    note_id = await _insert_note(db)

    first_job_id = str(uuid4())
    await db.execute(
        "INSERT INTO jobs (id, note_id, job_type, status, created_at) "
        "VALUES (?, ?, 'embed', 'queued', '2026-01-01T00:00:00Z')",
        (first_job_id, note_id),
    )
    await db.commit()
    await db.execute(
        "UPDATE jobs SET status = 'complete' WHERE id = ?", (first_job_id,)
    )
    await db.commit()

    # Previous job already reached a terminal state, shouldn't raise an error.
    await db.execute(
        "INSERT INTO jobs (id, note_id, job_type, status, created_at) "
        "VALUES (?, ?, 'embed', 'queued', '2026-01-01T00:00:01Z')",
        (str(uuid4()), note_id),
    )
    await db.commit()
    await db.close()


async def test_deleting_parent_tag_orphans_children(tmp_path):
    db = await _fresh_db(tmp_path)
    parent_id, child_a, child_b = str(uuid4()), str(uuid4()), str(uuid4())

    await db.execute(
        "INSERT INTO tags (id, name, created_at) VALUES (?, 'parent', ?)",
        (parent_id, TEST_TIMESTAMP),
    )
    for cid, name in ((child_a, "child-a"), (child_b, "child-b")):
        await db.execute(
            "INSERT INTO tags (id, name, parent_id, created_at) " "VALUES (?, ?, ?, ?)",
            (cid, name, parent_id, TEST_TIMESTAMP),
        )
    await db.commit()

    await db.execute("DELETE FROM tags WHERE id = ?", (parent_id,))
    await db.commit()

    cursor = await db.execute(
        "SELECT id, parent_id FROM tags WHERE id IN (?, ?)", (child_a, child_b)
    )
    rows = await cursor.fetchall()
    assert len(rows) == 2
    assert all(parent_id_val is None for _, parent_id_val in rows)
    await db.close()
