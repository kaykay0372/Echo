"""
Collection contents:
    id
    embedding
    document
    metadata.note_type
    metadata.is_deleted
    metadata.created_at
"""

import chromadb

COLLECTION_NAME = "echo_note_embeddings"
CHROMA_PATH = "./data/chroma_data"


def init_chroma(path: str = CHROMA_PATH):
    """Creates or connects to the persistent client and returns the collection."""

    client = chromadb.PersistentClient(path=path)
    return client.get_or_create_collection(
        name=COLLECTION_NAME, metadata={"hnsw:space": "cosine"}
    )


def check_chroma_alive(collection) -> bool:
    """Triggers a simple query to check if the collection is alive."""

    try:
        collection.count()
        return True
    except Exception:
        return False
