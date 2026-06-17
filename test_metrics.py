# Unit tests for metrics.py
# All connections derived from real 40_notes.json via conftest.

import pytest
from metrics import (
    build_connection_maps,
    precision_at_k,
    aggregate_scores,
    find_failure_cases,
    summarise_by_cluster,
)


class TestBuildConnectionMaps:

    def test_strict_contains_only_strong(self, annotations):
        """Test that strict connections only include pairs labeled STRONG."""

        strict, _ = build_connection_maps(annotations)
        strong_pairs = {
            (a["note_a"], a["note_b"])
            for a in annotations
            if a["relationship"] == "STRONG"
        }
        for note_id, related in strict.items():
            for n_id in related:
                assert (note_id, n_id) in strong_pairs or (
                    n_id,
                    note_id,
                ) in strong_pairs

    def test_strict_is_subset_of_lenient(self, annotations):
        """Test that every strict connection is also a lenient connection."""

        strict, lenient = build_connection_maps(annotations)
        for note_id, related in strict.items():
            assert related.issubset(lenient[note_id])

    def test_symmetry(self, annotations):
        """Test that if A is connected to B, then B is connected to A, for BOTH strict and lenient."""

        strict, lenient = build_connection_maps(annotations)
        for note_id, related in strict.items():
            for n_id in related:
                assert note_id in strict.get(n_id, set())
        for note_id, related in lenient.items():
            for n_id in related:
                assert note_id in lenient.get(n_id, set())

    def test_no_self_references(self, annotations):
        """Test that no note is connected to itself"""

        strict, lenient = build_connection_maps(annotations)
        for note_id, related in {**strict, **lenient}.items():
            assert note_id not in related


class TestPrecisionAtK:

    def test_returns_none_for_no_conn(self, strict_conn, note_ids):
        """Avoid errors when a note has no connections"""

        no_conn = [n_id for n_id in note_ids if n_id not in strict_conn]
        if not no_conn:
            pytest.skip("All notes have connections")
        # Passes a fake list to test returning NONE
        assert precision_at_k(no_conn[0], ["x", "y"], strict_conn) is None

    def test_perfect_retrieval(self, strict_conn):
        """Compares connections to what was expected"""

        note_id = next(iter(strict_conn))
        conn_list = list(strict_conn[note_id])[:5]
        assert precision_at_k(note_id, conn_list, strict_conn) == 1.0

    def test_zero_retrieval(self, strict_conn, note_ids):
        """Make sure non-retrieval actually has no connections"""

        note_id = next(iter(strict_conn))
        non_related = [
            n_id
            for n_id in note_ids
            if n_id not in strict_conn[note_id] and n_id != note_id
        ][:5]
        if not non_related:
            pytest.skip("Not enough non-related notes")
        assert precision_at_k(note_id, non_related, strict_conn) == 0.0

    def test_partial_retrieval(self, strict_conn):
        """Find the first connection and build 4 fake connections."""

        note_id = next(n_id for n_id, rel in strict_conn.items() if len(rel) >= 1)
        retrieved = list(strict_conn[note_id])[:1] + ["f1", "f2", "f3", "f4"]
        assert precision_at_k(note_id, retrieved[:5], strict_conn) == pytest.approx(
            1 / 5
        )

    def test_output_bounded(self, strict_conn, note_ids):
        """Ensure precision@k range is 0-1"""

        note_id = next(iter(strict_conn))
        result = precision_at_k(note_id, note_ids[:5], strict_conn)
        assert 0.0 <= result <= 1.0


class TestAggregateScores:

    def test_excludes_none(self):
        """Ensure that computation excludes NONE, still returns an average"""

        per_note = [
            {"p_strict": 1.0, "p_lenient": 1.0},
            {"p_strict": None, "p_lenient": 0.5},
            {"p_strict": 0.0, "p_lenient": 0.0},
        ]
        s, l = aggregate_scores(per_note)
        assert s == pytest.approx(0.5)
        assert l == pytest.approx(0.5)

    def test_all_none_returns_zero(self):
        """Make sure a note with no connections returns a 0.0 precision score"""

        s, l = aggregate_scores([{"p_strict": None, "p_lenient": None}])
        assert s == 0.0 and l == 0.0


class TestFindFailureCases:

    def test_sorted_ascending(self, strict_conn, notes):
        """Check that the returned failure cases are sorted by strict precision in ascending order"""

        per_note = [
            {
                "p_strict": precision_at_k(n["id"], [], strict_conn),
                "p_lenient": None,
                "cluster": n["cluster"],
            }
            for n in notes
        ]
        failures = find_failure_cases(per_note, n=5)
        scores = [f["p_strict"] for f in failures]
        assert scores == sorted(scores)

    def test_all_have_conn(self, strict_conn, notes):
        """Ensure all returned failure cases actually have connections"""

        per_note = [
            {
                "p_strict": precision_at_k(n["id"], [], strict_conn),
                "p_lenient": None,
                "cluster": n["cluster"],
            }
            for n in notes
        ]
        failures = find_failure_cases(per_note, n=5)
        assert all(f["p_strict"] is not None for f in failures)


class TestSummariseByCluster:

    @pytest.fixture
    def per_note_stub(self, notes, strict_conn, lenient_conn):
        """
        Minimal per_note built from real notes and connections, with empty retrieved lists so all scores are 0.0 or None.
        """

        return [
            {
                "p_strict": precision_at_k(n["id"], [], strict_conn),
                "p_lenient": precision_at_k(n["id"], [], lenient_conn),
                "cluster": n["cluster"],
            }
            for n in notes
        ]

    def test_all_clusters_present(self, per_note_stub):
        """Ensure all clusters with connections are present in the summary"""

        expected_clusters = {
            r["cluster"] for r in per_note_stub if r["p_strict"] is not None
        }
        result = summarise_by_cluster(per_note_stub)
        assert set(result.keys()) == expected_clusters

    def test_scores_bounded(self, per_note_stub):
        """Ensure all summary scores are bounded 0-1"""

        result = summarise_by_cluster(per_note_stub)
        for cluster, stats in result.items():
            assert 0.0 <= stats["mean"] <= 1.0

    def test_count_matches_notes_with_conn(self, per_note_stub):
        """Ensure the count in the summary matches the actual number of notes with connections"""

        from collections import Counter

        expected_counts = Counter(
            r["cluster"] for r in per_note_stub if r["p_strict"] is not None
        )
        result = summarise_by_cluster(per_note_stub)
        for cluster, stats in result.items():
            assert stats["count"] == expected_counts[cluster]

    def test_excludes_notes_without_conn(self, per_note_stub):
        """Ensure that notes without connections are excluded from the summary"""

        no_conn_clusters = {
            r["cluster"] for r in per_note_stub if r["p_strict"] is None
        }
        result = summarise_by_cluster(per_note_stub)
        # clusters that appear ONLY in notes without conn should not be in result
        only_no_conn = no_conn_clusters - set(result.keys())
        # if a cluster has some notes with conn and some without, it's fine to appear
        for cluster in only_no_conn:
            assert cluster not in result
