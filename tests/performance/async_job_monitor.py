# Load test for the asynchronous job worker.

import asyncio
import json
import random
import shutil
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import aiosqlite
import httpx

import sys, os  # To import from main later

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from backend import chroma_store, database
from stats import (
    environment_snapshot,
    fifo_burst_wait_predictions,
    fit_linear,
    mg1_expected_wait,
    summarise_latencies,
)

TIMESTAMP_FORMAT = "%Y-%m-%dT%H:%M:%S.%fZ"
TERMINAL_STATUSES = {"complete", "failed", "discarded"}


# CONFIGURATION


@dataclass
class LoadTestConfig:
    manifest_path: str = "test_assets/manifest.json"
    concurrency_levels: list[int] = field(default_factory=lambda: [1, 2, 5, 10, 20])
    repeats_per_level: int = 3
    poll_interval_s: float = 0.5
    db_path: Path = Path("tests/performance/results/perf_test.db")
    chroma_path: Path = Path("tests/performance/results/perf_test_chroma")
    log_path: str = "load_test_log.jsonl"
    summary_path: str = "load_test_summary.json"
    random_seed: int = 42


def _parse_ts(value: str | None) -> datetime | None:
    if value is None:
        return None
    return datetime.strptime(value, TIMESTAMP_FORMAT).replace(tzinfo=timezone.utc)


# HTTP DRIVER (real requests through the app, no mocking)


async def create_note(client: httpx.AsyncClient) -> str:
    response = await client.post(
        "/notes", json={"note_type": "text", "title": "load test note"}
    )
    response.raise_for_status()
    return response.json()["id"]


async def upload_attachment(client: httpx.AsyncClient, note_id: str, item: dict) -> str:
    path = Path(item["path"])
    content_type = "image/png" if item["type"] == "image" else "audio/wav"
    response = await client.post(
        f"/notes/{note_id}/attachments",
        files={"file": (path.name, path.read_bytes(), content_type)},
    )
    response.raise_for_status()
    return response.json()["id"]


# JOB TABLE POLLING


async def fetch_jobs_for_attachments(
    db_path: Path, attachment_ids: list[str]
) -> list[dict]:
    placeholders = ",".join("?" for _ in attachment_ids)
    async with aiosqlite.connect(db_path) as db:
        cursor = await db.execute(
            "SELECT attachment_id, job_type, status, created_at, started_at, completed_at "
            f"FROM jobs WHERE attachment_id IN ({placeholders})",
            attachment_ids,
        )
        rows = await cursor.fetchall()
    columns = [
        "attachment_id",
        "job_type",
        "status",
        "created_at",
        "started_at",
        "completed_at",
    ]
    return [dict(zip(columns, row)) for row in rows]


async def wait_for_batch_completion(
    db_path: Path, attachment_ids: list[str], poll_interval_s: float
) -> list[dict]:
    """Polls until every job tied to this batch's attachments has reached a terminal status."""

    expected_min_jobs = len(attachment_ids)
    while True:
        jobs = await fetch_jobs_for_attachments(db_path, attachment_ids)
        if len(jobs) >= expected_min_jobs and all(
            job["status"] in TERMINAL_STATUSES for job in jobs
        ):
            return jobs
        await asyncio.sleep(poll_interval_s)


# ONE BATCH AT ONE CONCURRENCY LEVEL


def log_record(log_path: str, record: dict) -> None:
    with open(log_path, "a") as f:
        f.write(json.dumps(record) + "\n")


async def run_batch(
    client: httpx.AsyncClient,
    db_path: Path,
    items: list[dict],
    concurrency: int,
    repeat: int,
    poll_interval_s: float,
    log_path: str,
) -> list[dict]:
    note_id = await create_note(client)
    # gather() submits all the jobs near-simultaneously
    attachment_ids = await asyncio.gather(
        *[upload_attachment(client, note_id, item) for item in items]
    )
    jobs = await wait_for_batch_completion(
        db_path, list(attachment_ids), poll_interval_s
    )

    records = []
    for job in jobs:
        created = _parse_ts(job["created_at"])
        started = _parse_ts(job["started_at"])
        completed = _parse_ts(job["completed_at"])
        record = {
            "concurrency": concurrency,
            "repeat": repeat,
            "job_type": job["job_type"],
            "status": job["status"],
            "created_at": job["created_at"],
            "started_at": job["started_at"],
            "completed_at": job["completed_at"],
            "queue_wait_s": (started - created).total_seconds() if started else None,
            "processing_s": (
                (completed - started).total_seconds() if started and completed else None
            ),
            "total_s": (completed - created).total_seconds() if completed else None,
        }
        log_record(log_path, record)
        records.append(record)
    return records


# QUEUEING MODEL COMPARISON


def compute_fifo_comparison(
    batch_records: list[dict],
) -> tuple[list[float], list[float]]:
    """Predicted vs. observed queueing times for a batch of jobs."""

    complete = [
        r
        for r in batch_records
        if r["processing_s"] is not None and r["queue_wait_s"] is not None
    ]
    ordered = sorted(complete, key=lambda r: r["started_at"])
    predicted = fifo_burst_wait_predictions([r["processing_s"] for r in ordered])
    observed = [r["queue_wait_s"] for r in ordered]
    return predicted, observed


def approximate_mg1_wait(batch_records: list[dict], wall_time_s: float) -> float | None:
    """Compute the approximate M/G/1 expected wait time for a batch of jobs."""

    processing_times = [
        r["processing_s"] for r in batch_records if r["processing_s"] is not None
    ]
    if not processing_times or wall_time_s <= 0:
        return None
    arrival_rate = len(processing_times) / wall_time_s
    return mg1_expected_wait(arrival_rate, processing_times)


# LOAD TEST DRIVER


async def load_test(config: LoadTestConfig, manifest: list[dict]) -> list[dict]:
    from main import app  # lazy import to avoid circular import issues

    if config.db_path.exists():
        config.db_path.unlink()
    if config.chroma_path.exists():
        shutil.rmtree(config.chroma_path)
    config.db_path.parent.mkdir(parents=True, exist_ok=True)

    # Redirects the app's storage to a dedicated, disposable location
    database.DB_PATH = config.db_path
    chroma_store.CHROMA_PATH = str(config.chroma_path)

    rng = random.Random(config.random_seed)
    all_records = []

    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://loadtest"
        ) as client:
            for concurrency in config.concurrency_levels:
                if concurrency > len(manifest):
                    raise ValueError(
                        f"concurrency={concurrency} exceeds the {len(manifest)} available test assets."
                    )
                for repeat in range(config.repeats_per_level):
                    items = rng.sample(manifest, k=concurrency)
                    print(
                        f"concurrency={concurrency} repeat={repeat + 1}/{config.repeats_per_level}..."
                    )

                    wall_start = time.time()
                    batch_records = await run_batch(
                        client,
                        config.db_path,
                        items,
                        concurrency,
                        repeat,
                        config.poll_interval_s,
                        config.log_path,
                    )
                    wall_elapsed = time.time() - wall_start

                    predicted, observed = compute_fifo_comparison(batch_records)
                    for record, pred in zip(
                        sorted(
                            (
                                r
                                for r in batch_records
                                if r["processing_s"] is not None
                                and r["queue_wait_s"] is not None
                            ),
                            key=lambda r: r["started_at"],
                        ),
                        predicted,
                    ):
                        record["fifo_predicted_wait_s"] = pred
                    approx_mg1 = approximate_mg1_wait(batch_records, wall_elapsed)
                    for record in batch_records:
                        record["approx_mg1_predicted_wait_s"] = approx_mg1

                    all_records.extend(batch_records)

    return all_records


# SUMMARY


def build_summary(records: list[dict], environment: dict) -> dict:
    by_concurrency: dict[int, list[dict]] = {}
    for record in records:
        by_concurrency.setdefault(record["concurrency"], []).append(record)

    concurrency_summaries = {}
    for concurrency, level_records in sorted(by_concurrency.items()):
        by_job_type: dict[str, list[dict]] = {}
        for record in level_records:
            by_job_type.setdefault(record["job_type"], []).append(record)

        job_type_summaries = {}
        for job_type, type_records in by_job_type.items():
            ok = [r for r in type_records if r["status"] == "complete"]
            job_type_summaries[job_type] = {
                "n_ok": len(ok),
                "n_errors": len(type_records) - len(ok),
                "queue_wait": summarise_latencies(
                    [r["queue_wait_s"] for r in ok if r["queue_wait_s"] is not None]
                ),
                "processing": summarise_latencies(
                    [r["processing_s"] for r in ok if r["processing_s"] is not None]
                ),
                "total": summarise_latencies(
                    [r["total_s"] for r in ok if r["total_s"] is not None]
                ),
            }

        predicted = [
            r["fifo_predicted_wait_s"]
            for r in level_records
            if r.get("fifo_predicted_wait_s") is not None
        ]
        observed = [
            r["queue_wait_s"]
            for r in level_records
            if r.get("fifo_predicted_wait_s") is not None
            and r["queue_wait_s"] is not None
        ]

        concurrency_summaries[concurrency] = {
            "job_types": job_type_summaries,
            "fifo_model_fit": fit_linear(predicted, observed),
        }

    all_predicted = [
        r["fifo_predicted_wait_s"]
        for r in records
        if r.get("fifo_predicted_wait_s") is not None
    ]
    all_observed = [
        r["queue_wait_s"]
        for r in records
        if r.get("fifo_predicted_wait_s") is not None and r["queue_wait_s"] is not None
    ]

    return {
        "environment": environment,
        "concurrency_levels": concurrency_summaries,
        "overall_fifo_model_fit": fit_linear(all_predicted, all_observed),
    }


def print_summary(summary: dict) -> None:
    print("\n Queue-wait / processing time by concurrency level and job type: ")
    for concurrency, level in summary["concurrency_levels"].items():
        print(f"\nConcurrency = {concurrency}")
        for job_type, stats in level["job_types"].items():
            qw = stats["queue_wait"]
            proc = stats["processing"]
            print(
                f"  {job_type:12s} n_ok={stats['n_ok']:3d}  "
                f"queue_wait median={qw['median_s']}  p95={qw['p95_s']}  "
                f"processing median={proc['median_s']}"
            )
        fit = level["fifo_model_fit"]
        if fit:
            print(
                f"  FIFO burst model fit: slope={fit['slope']:.3f} r2={fit['r_squared']:.3f}"
            )

    overall = summary["overall_fifo_model_fit"]
    if overall:
        print(
            f"\nOverall FIFO single-worker model fit (predicted vs. observed): "
            f"slope={overall['slope']:.3f}, intercept={overall['intercept']:.3f}s, "
            f"R^2={overall['r_squared']:.3f}"
        )

    print("\nEnvironment:")
    print(json.dumps(summary["environment"], indent=2))


# MAIN


def main() -> None:
    config = LoadTestConfig()
    manifest = json.load(open(config.manifest_path))
    environment = environment_snapshot()

    Path(config.log_path).touch(exist_ok=True)
    records = asyncio.run(load_test(config, manifest))

    summary = build_summary(records, environment)
    with open(config.summary_path, "w") as f:
        json.dump(summary, f, indent=2)

    print(f"\nDone. Results in {config.log_path}, summary in {config.summary_path}")
    print_summary(summary)


if __name__ == "__main__":
    main()
