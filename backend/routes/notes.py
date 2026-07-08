from fastapi import APIRouter
router = APIRouter()

@router.get("/notes")
def list_notes():
    return