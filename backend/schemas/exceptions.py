from fastapi import Request
from fastapi.responses import JSONResponse


class AppError(Exception):
    status_code = 500
    error_code = "internal_error"

    def __init__(self, detail: str):
        self.detail = detail


class ValidationError(AppError):
    status_code = 400
    error_code = "validation_error"


class NotFoundError(AppError):
    status_code = 404
    error_code = "not_found"


class ConflictError(AppError):
    status_code = 409
    error_code = "duplicate_content"

    def __init__(self, detail: str, existing_note_id: str | None = None):
        super().__init__(detail)
        self.existing_note_id = existing_note_id


async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
    body = {"error": exc.error_code, "detail": exc.detail}
    if isinstance(exc, ConflictError) and exc.existing_note_id:
        body["existing_note_id"] = exc.existing_note_id
    return JSONResponse(status_code=exc.status_code, content=body)