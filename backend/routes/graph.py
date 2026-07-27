from fastapi import APIRouter, Depends

from backend.dependencies import Error500, get_db
from backend.schemas.graph import GraphEdge, GraphNode, GraphResponse, GraphStats

router = APIRouter(tags=["Graph"])


@router.get(
    "/graph", response_model=GraphResponse, responses={500: {"model": Error500}}
)
async def get_graph(db=Depends(get_db)):
    """Retrieves all non-canvas notes and links"""

    node_cursor = await db.execute(
        "SELECT id, title, note_type, embedding_status, is_favourite, word_count "
        "FROM notes WHERE is_deleted = 0 AND note_type != 'canvas'"
    )
    node_rows = await node_cursor.fetchall()
    nodes = [
        GraphNode(
            id=row[0],
            title=row[1],
            note_type=row[2],
            embedding_status=row[3],
            is_favourite=bool(row[4]),
            word_count=row[5],
        )
        for row in node_rows
    ]

    edge_cursor = await db.execute(
        "SELECT l.source_note_id, l.target_note_id, l.link_type, l.similarity_score, l.status "
        "FROM links l "
        "JOIN notes s ON s.id = l.source_note_id "
        "JOIN notes t ON t.id = l.target_note_id "
        "WHERE l.status = 'confirmed' AND s.is_deleted = 0 AND t.is_deleted = 0"
    )
    edge_rows = await edge_cursor.fetchall()
    edges = [
        GraphEdge(
            source=row[0],
            target=row[1],
            link_type=row[2],
            similarity_score=row[3],
            status=row[4],
        )
        for row in edge_rows
    ]

    embedding_count_cursor = await db.execute(
        "SELECT COUNT(*) FROM notes "
        "WHERE is_deleted = 0 AND note_type != 'canvas' AND embedding_status = 'complete'"
    )
    (total_embeddings,) = await embedding_count_cursor.fetchone()

    stats = GraphStats(
        total_notes=len(nodes),
        total_links=len(edges),
        total_embeddings=total_embeddings,
    )

    return GraphResponse(nodes=nodes, edges=edges, stats=stats)
