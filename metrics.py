# Helper functions for connection construction, precision@K scoring and analysis.
# No input, output or external dependencies.

import statistics
from collections import defaultdict


def build_connection_maps(
    embedding: list[dict],
) -> tuple[dict[str, set[str]], dict[str, set[str]]]:
    """
    Build strict (STRONG only) and lenient (STRONG + WEAK) connection maps. Both maps are symmetric.
    """

    strict: dict[str, set[str]] = {}
    lenient: dict[str, set[str]] = {}

    for embed in embedding:
        a, b, rel = embed["note_a"], embed["note_b"], embed["relationship"]
        # Use sets for easy membership testing
        if rel in ("STRONG", "WEAK"):
            lenient.setdefault(a, set()).add(b)
            lenient.setdefault(b, set()).add(a)
        # STRONG connections go in both maps, WEAK only in lenient
        if rel == "STRONG":
            strict.setdefault(a, set()).add(b)
            strict.setdefault(b, set()).add(a)

    return strict, lenient


def precision_at_k(
    note_id: str,
    retrieved_ids: list[str],
    connection_map: dict[str, set[str]],
) -> float | None:
    """
    Precision@K for a single query note following Manning et al. (2008), Introduction to Information Retrieval.
    Returns None if note has no connection and excludes it from mean.
    """

    relevant = connection_map.get(note_id, set())
    if not relevant:
        return None
    # Prevent ZeroDivisionError if retrieved_ids is empty, and define precision as 0 in that case
    if not retrieved_ids:
        return 0.0
    return sum(1 for retrieved_id in retrieved_ids if retrieved_id in relevant) / len(
        retrieved_ids
    )


def aggregate_scores(connections: list[dict]) -> tuple[float, float]:
    """Mean strict and lenient precision, excluding notes with no connection."""

    strict_scores = [connection["p_strict"] for connection in connections if connection["p_strict"] is not None]
    lenient_scores = [connection["p_lenient"] for connection in connections if connection["p_lenient"] is not None]
    return (
        statistics.mean(strict_scores) if strict_scores else 0.0,
        statistics.mean(lenient_scores) if lenient_scores else 0.0,
    )


def find_failure_cases(connections: list[dict], n: int = 3) -> list[dict]:
    """N worst-performing notes by strict precision among notes with connections."""
    
    has_score = [connection for connection in connections if connection["p_strict"] is not None]
    return sorted(has_score, key=lambda x: x["p_strict"])[:n]


def summarise_by_cluster(connections: list[dict]) -> dict[str, dict]:
    """Mean strict precision grouped by cluster, for notes with connections."""
    
    cluster_scores: dict[str, list[float]] = defaultdict(list)
    for connection in connections:
        if connection["p_strict"] is not None:
            cluster_scores[connection["cluster"]].append(connection["p_strict"])
    return {
        cluster: {"mean": round(statistics.mean(scores), 4), "count": len(scores)}
        for cluster, scores in cluster_scores.items()
    }
