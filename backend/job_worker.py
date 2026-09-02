import aiosqlite
import asyncio
import functools
import uuid
from datetime import datetime, timedelta, timezone

from PIL import Image

from backend.dependencies import LINK_SIMILARITY_THRESHOLD

POLL_INTERVAL_SECONDS = 2


def _now_iso() -> str:
    now = datetime.now(timezone.utc)
    return now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"


def _new_id() -> str:
    return str(uuid.uuid4())


async def _enqueue_job(
    db, job_type: str, note_id: str | None = None, attachment_id: str | None = None
) -> None:
    """Idempotent job initialiser."""

    try:
        await db.execute(
            "INSERT INTO jobs (id, note_id, attachment_id, job_type, status, created_at) "
            "VALUES (?, ?, ?, ?, 'queued', ?)",
            (_new_id(), note_id, attachment_id, job_type, _now_iso()),
        )
    except aiosqlite.IntegrityError:
        pass


async def _claim_next_job(db: aiosqlite.Connection) -> dict | None:
    """Claims the oldest queued job, marks it as running and returns its details."""

    cursor = await db.execute(
        "SELECT id, note_id, attachment_id, job_type FROM jobs "
        "WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1"
    )
    row = await cursor.fetchone()
    if row is None:
        return None

    job_id, note_id, attachment_id, job_type = row
    now = _now_iso()
    await db.execute(
        "UPDATE jobs SET status = 'running', started_at = ? WHERE id = ?", (now, job_id)
    )
    await db.commit()
    return {
        "id": job_id,
        "note_id": note_id,
        "attachment_id": attachment_id,
        "job_type": job_type,
    }


async def _note_id_for_job(db, job: dict) -> str | None:
    """Resolves the note a job ultimately belongs to."""

    if job.get("note_id"):
        return job["note_id"]
    if job.get("attachment_id"):
        cursor = await db.execute(
            "SELECT note_id FROM attachments WHERE id = ?", (job["attachment_id"],)
        )
        row = await cursor.fetchone()
        return row[0] if row else None
    return None


async def _run_job(app, job: dict) -> None:
    """Runs the job in a worker thread, then updates the result or error back to the DB."""

    db = app.state.db
    handler = JOB_HANDLERS.get(job["job_type"])
    now = _now_iso()

    try:
        if handler is None:
            raise NotImplementedError(
                f"No handler registered for job_type={job['job_type']!r}"
            )

        context = await _load_job_context(db, job)

        loop = asyncio.get_running_loop()
        # Offloads ML models to a worker thread so they don't freeze the asyncio event loop that's also serving API requests.
        result = await loop.run_in_executor(
            None, functools.partial(handler, app, context)
        )

        # Note/job could have changed state while the handler was running in the worker thread
        # If the parent note was soft-deleted while this job was running, discard the result rather than applying it.
        parent_note_id = await _note_id_for_job(db, job)
        if parent_note_id:
            cursor = await db.execute(
                "SELECT is_deleted FROM notes WHERE id = ?", (parent_note_id,)
            )
            row = await cursor.fetchone()
            if row and row[0]:
                await db.execute(
                    "UPDATE jobs SET status = 'discarded', completed_at = ?, "
                    "error_message = 'Parent note was soft-deleted while this job was running' "
                    "WHERE id = ?",
                    (now, job["id"]),
                )
                await db.commit()
                return

        # Cancelling a job while it's running.
        cursor = await db.execute("SELECT status FROM jobs WHERE id = ?", (job["id"],))
        row = await cursor.fetchone()
        if row is None or row[0] == "discarded":
            await db.execute(
                "UPDATE jobs SET completed_at = ?, "
                "error_message = COALESCE(error_message, 'Cancelled while running') "
                "WHERE id = ?",
                (now, job["id"]),
            )
            await db.commit()
            return

        await _apply_job_result(app, job, result)

        await db.execute(
            "UPDATE jobs SET status = 'complete', completed_at = ? WHERE id = ?",
            (now, job["id"]),
        )

        # Completing an embed job automatically enqueues generate_links.
        if job["job_type"] == "embed":
            await _enqueue_job(db, "generate_links", note_id=job["note_id"])

    except Exception as exc:
        await db.execute(
            "UPDATE jobs SET status = 'failed', completed_at = ?, error_message = ?, "
            "retry_count = retry_count + 1 WHERE id = ?",
            (now, str(exc), job["id"]),
        )
    await db.commit()


async def _load_job_context(db: aiosqlite.Connection, job: dict) -> dict:
    """Fetches whatever the handler will need from the database, BEFORE crossing into the worker thread."""

    if job["job_type"] == "embed":
        cursor = await db.execute(
            "SELECT title, body, note_type, is_deleted FROM notes WHERE id = ?",
            (job["note_id"],),
        )
        title, body, note_type, is_deleted = await cursor.fetchone()

        # Aggregate across ALL attachments on this note, not just the most recent one.
        captions, ocr_texts, transcripts = [], [], []
        if note_type == "text":
            cursor = await db.execute(
                "SELECT generated_caption, generated_ocr_text, generated_transcript "
                "FROM attachments WHERE note_id = ? ORDER BY created_at ASC",
                (job["note_id"],),
            )
            rows = await cursor.fetchall()
            for caption, ocr_text, transcript in rows:
                if caption:
                    captions.append(caption)
                if ocr_text:
                    ocr_texts.append(ocr_text)
                if transcript:
                    transcripts.append(transcript)

        return {
            "note_type": note_type,
            "is_deleted": bool(is_deleted),
            "title": title,
            "body": body,
            "captions": captions,
            "ocr_texts": ocr_texts,
            "transcripts": transcripts,
        }

    if job["job_type"] in ("caption", "ocr", "transcribe"):
        cursor = await db.execute(
            "SELECT file_path FROM attachments WHERE id = ?", (job["attachment_id"],)
        )
        (file_path,) = await cursor.fetchone()
        return {"file_path": file_path}

    if job["job_type"] == "generate_links":
        note_id = job["note_id"]
        cursor = await db.execute(
            "SELECT source_note_id, target_note_id FROM links "
            "WHERE source_note_id = ? OR target_note_id = ?",
            (note_id, note_id),
        )
        rows = await cursor.fetchall()
        existing_linked_ids = {
            (target if source == note_id else source) for source, target in rows
        }
        return {"note_id": note_id, "existing_linked_note_ids": existing_linked_ids}

    raise NotImplementedError(
        f"context loader not written for job_type={job['job_type']!r}"
    )


def _handle_embed(app, context: dict) -> dict:
    """Pure computation for the embedding thread."""

    embedding_text = build_embedding_text(
        note_type=context["note_type"],
        title=context["title"],
        body=context["body"],
        captions=context["captions"],
        ocr_texts=context["ocr_texts"],
        transcripts=context["transcripts"],
    )

    # Convert from NumPy array to a plain Python list for JSON serialisation.
    vector = app.state.embedding_model.encode(embedding_text).tolist()
    return {"embedding_text": embedding_text, "vector": vector}


def _handle_caption(app, context: dict) -> dict:
    """BLIP captioning thread."""

    image = Image.open(context["file_path"]).convert("RGB")
    inputs = app.state.blip_processor(image, return_tensors="pt")
    output = app.state.blip_model.generate(**inputs)
    caption = app.state.blip_processor.decode(output[0], skip_special_tokens=True)
    return {"caption": caption}


def _handle_ocr(app, context: dict) -> dict:
    """Surya OCR thread."""

    image = Image.open(context["file_path"]).convert("RGB")
    predictions = app.state.surya_recognizer(
        [image], det_predictor=app.state.surya_detector
    )
    text_lines = [line.text for line in predictions[0].text_lines]
    return {"ocr_text": "\n".join(text_lines)}


def _handle_transcribe(app, context: dict) -> dict:
    """Whisper transcription thread."""

    result = app.state.whisper_model.transcribe(context["file_path"])
    return {"transcript": result["text"].strip()}


def _handle_generate_links(app, context: dict) -> dict:
    """Thread for generating links between notes."""

    note_id = context["note_id"]
    stored = app.state.chroma_collection.get(ids=[note_id], include=["embeddings"])
    if not stored["ids"]:
        return {"note_id": note_id, "candidates": []}

    query_vector = stored["embeddings"][0]
    results = app.state.chroma_collection.query(
        query_embeddings=[query_vector], n_results=6, where={"is_deleted": False}
    )

    existing = context["existing_linked_note_ids"]
    candidates = []
    for candidate_id, distance in zip(results["ids"][0], results["distances"][0]):
        if candidate_id == note_id or candidate_id in existing:
            continue
        similarity = max(0.0, min(1.0, 1 - distance))
        if similarity >= LINK_SIMILARITY_THRESHOLD:
            candidates.append((candidate_id, similarity))

    return {"note_id": note_id, "candidates": candidates}


async def _apply_job_result(app, job: dict, result: dict) -> None:
    """Updates the database and Chroma collection with the result of a completed job."""

    db = app.state.db

    if job["job_type"] == "embed":
        await db.execute(
            "UPDATE notes SET embedding_text = ?, embedding_status = 'complete' WHERE id = ?",
            (result["embedding_text"], job["note_id"]),
        )
        app.state.chroma_collection.upsert(
            ids=[job["note_id"]],
            embeddings=[result["vector"]],
            documents=[result["embedding_text"]],
            metadatas=[
                {
                    "note_type": job.get("note_type", "text"),
                    "is_deleted": job.get("is_deleted", False),
                }
            ],
        )

    elif job["job_type"] == "caption":
        await db.execute(
            "UPDATE attachments SET generated_caption = ?, processing_status = 'complete' "
            "WHERE id = ?",
            (result["caption"], job["attachment_id"]),
        )

    elif job["job_type"] == "ocr":
        await db.execute(
            "UPDATE attachments SET generated_ocr_text = ?, processing_status = 'complete' "
            "WHERE id = ?",
            (result["ocr_text"], job["attachment_id"]),
        )

    elif job["job_type"] == "transcribe":
        await db.execute(
            "UPDATE attachments SET generated_transcript = ?, processing_status = 'complete' "
            "WHERE id = ?",
            (result["transcript"], job["attachment_id"]),
        )

    elif job["job_type"] == "generate_links":
        note_id = result["note_id"]
        for candidate_id, similarity in result["candidates"]:
            # Ensuring the pair is always stored in the same order regardless of which note initiated the link.
            source, target = sorted([note_id, candidate_id])
            try:
                await db.execute(
                    "INSERT INTO links (id, source_note_id, target_note_id, link_type, "
                    "similarity_score, status, created_at) "
                    "VALUES (?, ?, ?, 'automatic', ?, 'pending_approval', ?)",
                    (_new_id(), source, target, similarity, _now_iso()),
                )
            except aiosqlite.IntegrityError:
                pass  # a link between this pair already exists in some state


async def recover_orphaned_jobs(db: aiosqlite.Connection) -> int:
    """Resets any job stuck at 'running' back to 'queued'."""

    cursor = await db.execute(
        "UPDATE jobs SET status = 'queued', started_at = NULL WHERE status = 'running'"
    )
    await db.commit()
    return cursor.rowcount


JOB_CLEANUP_AGE_THRESHOLD = timedelta(days=7)


def _parse_created_at(value: str) -> datetime:
    return datetime.strptime(value, "%Y-%m-%dT%H:%M:%S.%fZ").replace(
        tzinfo=timezone.utc
    )


async def cleanup_old_jobs(db: aiosqlite.Connection) -> int:
    """Automatically deletes 'complete' and 'discarded' jobs whose created_at is 7+ days old."""

    cursor = await db.execute(
        "SELECT id, created_at FROM jobs WHERE status IN ('complete', 'discarded')"
    )
    rows = await cursor.fetchall()

    now = datetime.now(timezone.utc)
    stale_ids = [
        job_id
        for job_id, created_at in rows
        if now - _parse_created_at(created_at) >= JOB_CLEANUP_AGE_THRESHOLD
    ]
    if not stale_ids:
        return 0

    placeholders = ",".join("?" for _ in stale_ids)
    await db.execute(f"DELETE FROM jobs WHERE id IN ({placeholders})", stale_ids)
    await db.commit()
    return len(stale_ids)


async def job_worker_loop(app):
    """Runs forever until cancelled at shutdown. One job at a time, oldest first."""

    while True:
        job = await _claim_next_job(app.state.db)
        if job is None:
            # Yield control back to the event loop
            await asyncio.sleep(POLL_INTERVAL_SECONDS)
            continue
        await _run_job(app, job)


def build_embedding_text(
    note_type: str,
    title: str | None,
    body: str | None,
    captions: list[str] | None = None,
    ocr_texts: list[str] | None = None,
    transcripts: list[str] | None = None,
) -> str:
    """Only build embedding text from non-canvas notes."""
    if note_type == "canvas":
        raise ValueError("Canvas notes cannot be embedded")
    if note_type != "text":
        raise ValueError(f"Unknown note_type: {note_type!r}")

    parts = (
        [title, body]
        + list(captions or [])
        + list(ocr_texts or [])
        + list(transcripts or [])
    )
    return " ".join(p for p in parts if p)


JOB_HANDLERS = {
    "embed": _handle_embed,
    "caption": _handle_caption,
    "ocr": _handle_ocr,
    "transcribe": _handle_transcribe,
    "generate_links": _handle_generate_links,
}
