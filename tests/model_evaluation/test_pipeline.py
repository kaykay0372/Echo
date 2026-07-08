# Unit tests for pipeline.py.

import pytest
from unittest.mock import MagicMock
from tests.embedding_model_evaluation.pipeline import query_top_k, store_embeddings


@pytest.fixture
def mock_collection(notes):
    """Fresh mock collection for each test."""

    ids = [n["id"] for n in notes]
    col = MagicMock()
    col.get.return_value = {"embeddings": [[0.1] * 384]}
    col.query.return_value = {
        "ids": [ids[:6]],
        "distances": [[0.0, 0.1, 0.2, 0.3, 0.4, 0.5]],
    }
    return col, ids


@pytest.fixture(scope="module")
def live_collection(notes):
    """Real collection with embeddings stored."""

    import chromadb
    from sentence_transformers import SentenceTransformer
    from tests.embedding_model_evaluation.pipeline import compute_embeddings, store_embeddings

    model = SentenceTransformer("all-MiniLM-L6-v2")
    texts = [n["embedding_text"] for n in notes]
    ids = [n["id"] for n in notes]
    emb, _, _ = compute_embeddings(texts, model, warmup_size=2, timing_runs=1)

    client = chromadb.Client()
    col = client.create_collection("echo_test", metadata={"hnsw:space": "cosine"})
    store_embeddings(ids, emb, texts, col)
    return col


class TestQueryTopK:

    def test_returns_k_results(self, mock_collection):
        """Returns exactly k results."""

        col, ids = mock_collection
        assert len(query_top_k(ids[0], col, k=5)) == 5

    def test_excludes_self(self, mock_collection):
        """Excludes the query id from the results."""

        col, ids = mock_collection
        query_id = ids[0]
        col.query.return_value = {
            "ids": [[query_id] + ids[1:6]],
            "distances": [[0.0, 0.1, 0.2, 0.3, 0.4, 0.5]],
        }
        returned_ids = [r[0] for r in query_top_k(query_id, col, k=5)]
        assert query_id not in returned_ids

    def test_distance_to_similarity(self, mock_collection):
        """Converts distances to similarities."""

        col, ids = mock_collection
        col.query.return_value = {
            "ids": [ids[1:7]],
            "distances": [[0.0, 0.5, 1.0, 1.5, 2.0, 0.25]],
        }
        results = query_top_k(ids[0], col, k=5)
        assert results[0][1] == pytest.approx(1.0)
        assert results[2][1] == pytest.approx(0.5)

    def test_fetches_embedding_before_query(self, mock_collection):
        """Fetches the embedding of the query note before performing the query."""

        col, ids = mock_collection
        query_top_k(ids[0], col, k=5)
        col.get.assert_called_once_with(ids=[ids[0]], include=["embeddings"])

    def test_scores_bounded(self, mock_collection):
        """Ensures that all returned scores are bounded between 0-1."""

        col, ids = mock_collection
        for _, score in query_top_k(ids[0], col, k=5):
            assert 0.0 <= score <= 1.0


class TestStoreEmbeddings:

    def test_calls_collection_add(self, notes):
        """Ensures that store_embeddings calls collection.add with the correct arguments."""
        col = MagicMock()
        ids = [n["id"] for n in notes[:3]]
        emb = [[0.1] * 384] * 3
        docs = ["a", "b", "c"]
        store_embeddings(ids, emb, docs, col)
        col.add.assert_called_once_with(ids=ids, embeddings=emb, documents=docs)


# INTEGRATION TESTS (run the real dataset + model)


class TestFullPipeline:

    def test_retrieved_count_equals_k(self, notes, live_collection):
        """Ensures that the number of retrieved results equals k."""
        assert len(query_top_k(notes[0]["id"], live_collection, k=5)) == 5

    def test_no_self_in_retrieved(self, notes, live_collection):
        """Ensures that the query id is not in the retrieved results."""
        for note in notes[:5]:
            ids = [r[0] for r in query_top_k(note["id"], live_collection, k=5)]
            assert note["id"] not in ids

    def test_lenient_conne_strict(
        self, notes, live_collection, strict_conn, lenient_conn
    ):
        """Ensures that lenient connections are at least as good as strict connections."""

        from tests.embedding_model_evaluation.metrics import precision_at_k, aggregate_scores

        per_note = []
        for note in notes:
            retrieved = [r[0] for r in query_top_k(note["id"], live_collection, k=5)]
            per_note.append(
                {
                    "p_strict": precision_at_k(note["id"], retrieved, strict_conn),
                    "p_lenient": precision_at_k(note["id"], retrieved, lenient_conn),
                }
            )
        s, l = aggregate_scores(per_note)
        assert l >= s
