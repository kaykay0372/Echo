# Infrastructure pipeline for ChromaDB embedding.
# All input and output comes from this file.

import json
import statistics
import time
from dataclasses import dataclass, field
import chromadb
from sentence_transformers import SentenceTransformer
from tests.embedding_model_evaluation.metrics import (
    build_connection_maps,
    precision_at_k,
    aggregate_scores,
    find_failure_cases,
    summarise_by_cluster,
)

# CONFIGURATION


@dataclass
class EvalConfig:
    k: int = 5
    dataset_path: str = "./data/40_notes.json"
    # Can't pass a mutable object to the class def
    models: list[str] = field(
        default_factory=lambda: [
            "all-MiniLM-L6-v2",  # smallest, but fastest model
            "all-mpnet-base-v2",  # more accurate, but slower model
            "paraphrase-multilingual-mpnet-base-v2",  # multilingual model
        ]
    )
    batch_size: int = 16
    warmup_size: int = 2
    timing_runs: int = 3


# LOAD DATASET


def load_dataset(path: str) -> tuple[list[dict], list[dict]]:
    """Loads notes and annotations"""

    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return data["notes"], data["annotations"]


# INTERACTIONS WITH CHROMADB


def compute_embeddings(
    texts: list[str],
    model,
    batch_size: int = 16,
    warmup_size: int = 2,
    timing_runs: int = 3,
) -> tuple[list, float, float]:
    """
    Encode texts, discards warmup runs and returns mean and stdev latency in milliseconds per note, averaged across the specified number of timing runs. Uses batch encoding for efficiency.
    """

    # Warmup to exclude initial overhead from timing
    model.encode(texts[:warmup_size], show_progress_bar=True)

    run_times = []
    embeddings = None
    for _ in range(timing_runs):
        t0 = time.perf_counter()  # Get precise start time
        embeddings = model.encode(texts, show_progress_bar=True, batch_size=batch_size)
        run_times.append((time.perf_counter() - t0) * 1000)

    per_note = [t / len(texts) for t in run_times]
    return (
        embeddings.tolist(),  # Convert to plain list for ChromaDB storage
        statistics.mean(per_note),
        statistics.stdev(per_note) if len(per_note) > 1 else 0.0,
    )


def store_embeddings(
    ids: list[str],
    embeddings: list[list[float]],
    documents: list[str],
    collection,
) -> None:
    """Stores embeddings in the ChromaDB collection."""

    collection.add(ids=ids, embeddings=embeddings, documents=documents)


def query_top_k(note_id: str, collection, k: int) -> list[tuple[str, float]]:
    """
    Fetch stored embedding based on note_id, then query for top-K neighbours.
    Converts cosine distance to similarity: sim = 1 - (dist / 2).
    """

    stored = collection.get(ids=[note_id], include=["embeddings"])
    # Get the first and only embedding in the case that there are multiple
    query_embedding = stored["embeddings"][0]

    results = collection.query(
        query_embeddings=[query_embedding],
        n_results=k + 1,  # +1 to exclude itself
        include=["distances"],
    )
    # Match the ids to distances and return as a list of tuples
    pairs = [
        (n_id, round(1 - (dist / 2), 4))
        for n_id, dist in zip(results["ids"][0], results["distances"][0])
        if n_id != note_id
    ]
    return pairs[:k]


# RESULTS


def print_results_table(all_results: dict, k: int) -> None:
    """Prints a summary table of all results from the evaluation, sorted by strict precision@K."""

    print("\n" + "=" * 72)
    print("ECHO MODEL EVALUATION RESULTS")
    print(f"  Metric: Precision@{k}")
    print("=" * 72)
    print(
        f" {'Model':<45} {'P@K (strict)':>12} {'P@K (lenient)':>14} {'Latency':>9} {'±':>8}"
    )
    print("  " + "-" * 70)
    for model_name, res in all_results.items():
        short = model_name.replace("paraphrase-multilingual-", "ml-")
        print(
            f" {short:<45}"
            f" {res['mean_precision_strict']:>11.3f}"
            f" {res['mean_precision_lenient']:>12.3f}"
            f" {res['mean_latency_ms']:>6.1f}ms"
            f" ±{res['stdev_latency_ms']:>5.2f}"
        )
    print("=" * 72)
    print("Strict = STRONG only  |  Lenient = STRONG + WEAK\n")


def print_failure_cases(model_name: str, failures: list[dict], k: int) -> None:
    """Prints the worst-performing notes"""

    print(f"\n !!Failure cases: {model_name}!!")
    for f in failures:
        print(f" Note {f['note_id']} [{f['note_type']}] \"{f['title'][:50]}\"")
        print(
            f" P@{k}: {f['p_strict']:.2f}  |  expected: {f['conn_strict']}  |  got: {f['retrieved']}"
        )


def save_results(
    all_results: dict, k: int, dataset_path: str, output_path: str
) -> None:
    """Saves all results to a JSON file."""

    output = {
        "k": k,
        "dataset_path": dataset_path,
        "selected_model": max(
            all_results, key=lambda m: all_results[m]["mean_precision_strict"]
        ),
        "models": {
            # Iterate through each model and its results, excluding the cluster summary
            name: {k2: v for k2, v in r.items() if k2 != "cluster_summary"}
            for name, r in all_results.items()
        },
    }
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2)
    print(f"  Results saved to {output_path}")


# MAIN


def run_evaluation(config: EvalConfig) -> dict:
    """Main pipeline to evaluate all models on the dataset"""

    notes, annotations = load_dataset(config.dataset_path)
    strict_conn, lenient_conn = build_connection_maps(annotations)

    print(f"  {len(notes)} notes  |  {len(annotations)} annotated pairs")
    print(
        f"  STRONG connections: {len(strict_conn)}  |  STRONG+WEAK: {len(lenient_conn)}"
    )

    all_results = {}

    for model_name in config.models:
        print(f"\nEvaluating: {model_name}")
        t0 = time.perf_counter()
        model = SentenceTransformer(model_name)
        print(f" Model loaded in {time.perf_counter() - t0:.1f}s")

        client = chromadb.Client()
        collection = client.create_collection(
            name=f"echo_{model_name.replace('/', '_')}",
            metadata={
                "hnsw:space": "cosine"
            },  # Hierarchical Navigable Small World indesxing algorithm
        )

        texts = [n["embedding_text"] for n in notes]
        ids = [n["id"] for n in notes]

        embeddings, mean_lat, stdev_lat = compute_embeddings(
            texts,
            model,
            batch_size=config.batch_size,
            warmup_size=config.warmup_size,
            timing_runs=config.timing_runs,
        )
        store_embeddings(ids, embeddings, texts, collection)
        print(f" Embedded: {mean_lat:.1f}ms ±{stdev_lat:.2f} per note")

        per_note = []
        for note in notes:
            retrieved = query_top_k(note["id"], collection, config.k)
            retrieved_ids = [r[0] for r in retrieved]
            per_note.append(
                {
                    "note_id": note["id"],
                    "title": note["title"],
                    "note_type": note["note_type"],
                    "cluster": note["cluster"],
                    "retrieved": retrieved_ids,
                    "top_scores": [r[1] for r in retrieved],
                    "p_strict": precision_at_k(note["id"], retrieved_ids, strict_conn),
                    "p_lenient": precision_at_k(
                        note["id"], retrieved_ids, lenient_conn
                    ),
                    "conn_strict": list(strict_conn.get(note["id"], [])),
                    "conn_lenient": list(lenient_conn.get(note["id"], [])),
                }
            )

        strict_mean, lenient_mean = aggregate_scores(per_note)
        all_results[model_name] = {
            "mean_precision_strict": strict_mean,
            "mean_precision_lenient": lenient_mean,
            "mean_latency_ms": mean_lat,
            "stdev_latency_ms": stdev_lat,
            "notes_with_conn_strict": sum(
                1 for r in per_note if r["p_strict"] is not None
            ),
            "notes_with_conn_lenient": sum(
                1 for r in per_note if r["p_lenient"] is not None
            ),
            "per_note": per_note,
            "cluster_summary": summarise_by_cluster(per_note),
        }
        print_failure_cases(model_name, find_failure_cases(per_note, n=3), config.k)

    print_results_table(all_results, config.k)

    winner = max(all_results, key=lambda m: all_results[m]["mean_precision_strict"])
    print(
        f" Selected: {winner}  |  Strict P@{config.k}: {all_results[winner]['mean_precision_strict']:.3f}\n"
    )

    save_results(all_results, config.k, config.dataset_path, "evaluation_results.json")
    return all_results


if __name__ == "__main__":
    run_evaluation(EvalConfig())
