from fastapi import APIRouter

from backend.dependencies import (
    Error400,
    Error404,
    Error500
)
from backend.schemas.link import Link

router = APIRouter(prefix="/links", tags=["Links"])


@router.post("/{link_id}/confirm", response_model=Link, responses={400: {"model": Error400}, 404: {"model": Error404}, 500: {"model": Error500}})
async def confirm_link(link_id: str):
    '''Pending_approval, later confirmed. 400 if not currently pending.'''
    return 0


@router.post("/{link_id}/reject", response_model=Link, responses={400: {"model": Error400}, 404: {"model": Error404}, 500: {"model": Error500}})
async def reject_link(link_id: str):
    '''Pending_approval, later rejected. 400 if not currently pending.'''
    return 0
