from fastapi import APIRouter, Response, status

from backend.dependencies import (
    Error400,
    Error404,
    Error500
)
from backend.schemas.tag import AssignTagRequest, Tag, TagCreate, TagUpdate

router = APIRouter(tags=["Tags"])


@router.post("/tags", response_model=Tag, status_code=status.HTTP_201_CREATED, responses={400: {"model": Error400}, 500: {"model": Error500}})
async def create_tag(payload: TagCreate):
    '''Always tag_type='manual'; 400 if caller requests 'automatic'.'''
    return 0


@router.get("/tags", response_model=list[Tag], responses={500: {"model": Error500}})
async def list_tags():
    '''Flat list, manual and automatic.'''
    return 0


@router.patch("/tags/{tag_id}", response_model=Tag, responses={400: {"model": Error400}, 404: {"model": Error404}, 500: {"model": Error500}})
async def update_tag(tag_id: str, payload: TagUpdate):
    '''Rename and/or re-parent.'''
    return 0


@router.delete("/tags/{tag_id}", status_code=status.HTTP_204_NO_CONTENT, responses={404: {"model": Error404}, 500: {"model": Error500}})
async def delete_tag(tag_id: str):
    '''Child tags orphaned to top level, not deleted.'''
    return 0


@router.post("/notes/{note_id}/tags", status_code=status.HTTP_201_CREATED, responses={404: {"model": Error404}, 500: {"model": Error500}})
async def assign_tag(note_id: str, payload: AssignTagRequest, response: Response):
    '''
    200 if already assigned (no-op), 201 if newly assigned. 
    status_code must be set on `response` inside the handler body once wired, since it isn't fixed at decoration time.
    '''
    return 0


@router.delete("/notes/{note_id}/tags/{tag_id}", status_code=status.HTTP_204_NO_CONTENT, responses={404: {"model": Error404}, 500: {"model": Error500}})
async def remove_tag(note_id: str, tag_id: str):
    '''Remove a tag from a note.'''
    return 0
