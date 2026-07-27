import pytest

from backend.chroma_store import COLLECTION_NAME, check_chroma_alive, init_chroma

EMBEDDING_DIM = 768


def test_init_chroma_creates_collection(tmp_path):
    collection = init_chroma(path=str(tmp_path / "chroma_data"))
    assert collection.name == COLLECTION_NAME
    assert collection.count() == 0


def test_init_chroma_is_idempotent(tmp_path):
    path = str(tmp_path / "chroma_data")
    first = init_chroma(path=path)
    second = init_chroma(path=path)
    assert first.name == second.name == COLLECTION_NAME


def test_check_chroma_alive_true_for_real_collection(tmp_path):
    collection = init_chroma(path=str(tmp_path / "chroma_data"))
    assert check_chroma_alive(collection) is True


def test_check_chroma_alive_false_for_broken_collection():
    class BrokenCollection:
        def count(self):
            raise RuntimeError("simulated failure")

    assert check_chroma_alive(BrokenCollection()) is False
