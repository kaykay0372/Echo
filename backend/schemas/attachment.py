from datetime import datetime

from pydantic import BaseModel, ConfigDict


class Attachment(BaseModel):
    # !!!drop it once you know for certain you'll always build Note from dict(row).
    # model_config = ConfigDict(from_attributes=True)

    id: str
    note_id: str
    file_path: str
    file_type: str  # "image" | "audio"
    content_hash: str
    generated_caption: str | None = None
    generated_ocr_text: str | None = None
    generated_transcript: str | None = None
    processing_status: str
    created_at: datetime
