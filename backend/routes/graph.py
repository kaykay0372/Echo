from fastapi import APIRouter

from backend.schemas.graph import GraphResponse
from backend.dependencies import Error500

router = APIRouter(tags=["Graph"])


@router.get("/graph", response_model=GraphResponse, responses={500: {"model": Error500}})
async def get_graph():
    '''Non-deleted, regular and canvas notes as nodes; confirmed links as edges.'''
    return 0
