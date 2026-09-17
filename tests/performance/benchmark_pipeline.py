# Model latency benchmarking

import json
import random
import time
from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace

import sys, os
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from bootstrap import ensure_ffmpeg_available

from backend.job_worker import (
    _handle_caption,
    _handle_embed,
    _handle_ocr,
    _handle_transcribe,
    build_embedding_text,
)
from stats import (
    environment_snapshot,
    fit_linear,
    summarise_latencies,
)
from backend.models import load_all_models

# CONFIGURATION


@dataclass
class BenchmarkConfig:
    manifest_path: str = "test_assets/manifest.json"
    runs_per_file: int = 10
    random_seed: int = 42
    log_path: str = "pipeline_benchmark_log.jsonl"
    summary_path: str = "pipeline_benchmark_summary.json"


# MODEL SETUP


def build_fake_app(models: dict) -> SimpleNamespace:
    """Unpack the models without a FastAPI app, so the real handlers can be called directly."""

    return SimpleNamespace(state=SimpleNamespace(**models))


def warmup(app, manifest: list[dict]) -> None:
    """One real call per stage, discarded before any timing starts (Reddi et al., 2020, "MLPerf Inference Benchmark", ISCA 2020)."""

    audio_item = next(item for item in manifest if item["type"] == "audio")
    image_item = next(item for item in manifest if item["type"] == "image")

    ensure_ffmpeg_available()
    _handle_transcribe(app, {"file_path": audio_item["path"]})
    _handle_ocr(app, {"file_path": image_item["path"]})
    _handle_caption(app, {"file_path": image_item["path"]})
    _handle_embed(
        app,
        {
            "note_type": "text",
            "title": None,
            "body": None,
            "captions": ["warmup"],
            "ocr_texts": [],
            "transcripts": [],
        },
    )


# TIMED STAGES


def timed_stage(fn, *args, **kwargs) -> tuple[dict | None, float, str | None]:
    """Run a stage and return details."""

    start = time.perf_counter()
    error, result = None, None
    try:
        result = fn(*args, **kwargs)
    except Exception as e:
        error = str(e)
    duration_ms = (time.perf_counter() - start) * 1000
    return result, duration_ms, error


def log_record(log_path: str, record: dict) -> None:
    with open(log_path, "a") as f:
        f.write(json.dumps(record) + "\n")


def run_audio_item(app, item: dict, run_idx: int, log_path: str) -> list[dict]:
    """Run the full audio pipeline for one item."""

    records = []

    result, ms, err = timed_stage(_handle_transcribe, app, {"file_path": item["path"]})
    record = {
        "stage": "whisper_transcribe",
        "file": item["path"],
        "run": run_idx,
        "input_size": item["duration_s"],
        "duration_ms": ms,
        "error": err,
    }
    log_record(log_path, record)
    records.append(record)

    if result and not err:
        embed_context = {
            "note_type": "text",
            "title": None,
            "body": None,
            "captions": [],
            "ocr_texts": [],
            "transcripts": [result["transcript"]],
        }
        _, embed_ms, embed_err = timed_stage(_handle_embed, app, embed_context)
        embed_record = {
            "stage": "bge_embed",
            "file": item["path"],
            "run": run_idx,
            "input_size": len(build_embedding_text(**embed_context)),
            "duration_ms": embed_ms,
            "error": embed_err,
        }
        log_record(log_path, embed_record)
        records.append(embed_record)

    return records


def run_image_item(app, item: dict, run_idx: int, log_path: str) -> list[dict]:
    """Run the full image pipeline for one item."""

    records = []
    resolution = tuple(item["resolution"])
    pixel_count = resolution[0] * resolution[1]

    ocr_result, ocr_ms, ocr_err = timed_stage(
        _handle_ocr, app, {"file_path": item["path"]}
    )
    ocr_record = {
        "stage": "surya_ocr",
        "file": item["path"],
        "run": run_idx,
        "input_size": pixel_count,
        "duration_ms": ocr_ms,
        "error": ocr_err,
    }
    log_record(log_path, ocr_record)
    records.append(ocr_record)

    caption_result, caption_ms, caption_err = timed_stage(
        _handle_caption, app, {"file_path": item["path"]}
    )
    caption_record = {
        "stage": "blip_caption",
        "file": item["path"],
        "run": run_idx,
        "input_size": pixel_count,
        "duration_ms": caption_ms,
        "error": caption_err,
    }
    log_record(log_path, caption_record)
    records.append(caption_record)

    ocr_text = ocr_result["ocr_text"] if ocr_result and not ocr_err else None
    caption = caption_result["caption"] if caption_result and not caption_err else None
    if ocr_text or caption:
        embed_context = {
            "note_type": "text",
            "title": None,
            "body": None,
            "captions": [caption] if caption else [],
            "ocr_texts": [ocr_text] if ocr_text else [],
            "transcripts": [],
        }
        _, embed_ms, embed_err = timed_stage(_handle_embed, app, embed_context)
        embed_record = {
            "stage": "bge_embed",
            "file": item["path"],
            "run": run_idx,
            "input_size": len(build_embedding_text(**embed_context)),
            "duration_ms": embed_ms,
            "error": embed_err,
        }
        log_record(log_path, embed_record)
        records.append(embed_record)

    return records


# RESULTS


def build_summary(records: list[dict], environment: dict) -> dict:
    by_stage: dict[str, list[dict]] = {}
    for record in records:
        by_stage.setdefault(record["stage"], []).append(record)

    stage_summaries = {}
    for stage, stage_records in by_stage.items():
        ok = [r for r in stage_records if not r["error"]]
        durations_s = [r["duration_ms"] / 1000 for r in ok]
        sizes = [r["input_size"] for r in ok]

        stage_summaries[stage] = {
            "n_ok": len(ok),
            "n_errors": len(stage_records) - len(ok),
            "latency": summarise_latencies(durations_s),
            "latency_vs_input_size_fit": fit_linear(sizes, durations_s),
        }

    return {"environment": environment, "stages": stage_summaries}


def print_summary(summary: dict) -> None:
    import pandas as pd

    rows = []
    for stage, stats in summary["stages"].items():
        latency = stats["latency"]
        fit = stats["latency_vs_input_size_fit"]
        rows.append(
            {
                "stage": stage,
                "n_ok": stats["n_ok"],
                "n_errors": stats["n_errors"],
                "median_s": latency["median_s"],
                "p95_s": latency["p95_s"],
                "p99_s": latency["p99_s"],
                "median_ci95_s": latency["median_ci95_s"],
                "size_vs_latency_r2": fit["r_squared"] if fit else None,
            }
        )

    print("\nPer-stage summary (seconds)")
    print(pd.DataFrame(rows).round(4).to_string(index=False))
    print("\nEnvironment:")
    print(json.dumps(summary["environment"], indent=2))


# MAIN


def main() -> None:
    config = BenchmarkConfig()
    manifest = json.load(open(config.manifest_path))

    models = load_all_models()
    app = build_fake_app(models)

    environment = environment_snapshot()

    print("Warming up...")
    warmup(app, manifest)

    # Shuffle the work items to avoid bias
    work_items = [
        (item, run_idx) for item in manifest for run_idx in range(config.runs_per_file)
    ]
    random.Random(config.random_seed).shuffle(work_items)

    Path(config.log_path).touch(exist_ok=True)
    all_records = []
    for i, (item, run_idx) in enumerate(work_items):
        if item["type"] == "audio":
            all_records.extend(run_audio_item(app, item, run_idx, config.log_path))
        else:
            all_records.extend(run_image_item(app, item, run_idx, config.log_path))
        if (i + 1) % 10 == 0:
            print(f"  {i + 1}/{len(work_items)} runs done")

    summary = build_summary(all_records, environment)
    with open(config.summary_path, "w") as f:
        json.dump(summary, f, indent=2)

    print(f"\nDone. Results in {config.log_path}, summary in {config.summary_path}")
    print_summary(summary)


if __name__ == "__main__":
    main()
