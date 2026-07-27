from pydantic import BaseModel

from backend.dependencies import EmbeddingStatus, LinkStatus, LinkType, NoteType


class GraphNode(BaseModel):
    id: str
    title: str | None = None
    note_type: NoteType
    embedding_status: EmbeddingStatus
    is_favourite: bool | None = None
    word_count: int | None = None


class GraphEdge(BaseModel):
    source: str
    target: str
    link_type: LinkType
    similarity_score: float | None = None
    status: LinkStatus


class GraphStats(BaseModel):
    total_notes: int
    total_links: int
    total_embeddings: int


class GraphResponse(BaseModel):
    nodes: list[GraphNode]
    edges: list[GraphEdge]
    stats: GraphStats | None = None
