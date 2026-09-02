import os
from pathlib import Path

DEFAULT_CACHE_DIR = Path(__file__).resolve().parent.parent / "data" / "model_cache"
CACHE_DIR = Path(os.environ.get("ECHO_MODEL_CACHE_DIR", str(DEFAULT_CACHE_DIR)))
HF_CACHE_DIR = CACHE_DIR / "huggingface"
WHISPER_CACHE_DIR = CACHE_DIR / "whisper"

os.environ["HF_HOME"] = str(HF_CACHE_DIR)
# Force Hugging Face / transformers to only ever read from the local cache.
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"

import whisper
from sentence_transformers import SentenceTransformer
from surya.foundation import FoundationPredictor
from surya.detection import DetectionPredictor
from surya.recognition import RecognitionPredictor
from transformers import BlipForConditionalGeneration, BlipProcessor

WHISPER_MODEL_NAME = "base"
BLIP_MODEL_ID = "Salesforce/blip-image-captioning-base"
EMBEDDING_MODEL_ID = "BAAI/bge-base-en-v1.5"


def load_all_models() -> dict:
    """Returns every loaded model/processor, keyed by the app.state attribute name health check expects."""

    embedding_model = SentenceTransformer(EMBEDDING_MODEL_ID)

    whisper_model = whisper.load_model(
        WHISPER_MODEL_NAME, download_root=str(WHISPER_CACHE_DIR)
    )

    blip_processor = BlipProcessor.from_pretrained(BLIP_MODEL_ID)
    blip_model = BlipForConditionalGeneration.from_pretrained(BLIP_MODEL_ID)

    surya_detector = DetectionPredictor()
    surya_foundation = FoundationPredictor()
    surya_recognizer = RecognitionPredictor(surya_foundation)

    return {
        "embedding_model": embedding_model,
        "whisper_model": whisper_model,
        "blip_processor": blip_processor,
        "blip_model": blip_model,
        "surya_detector": surya_detector,
        "surya_recognizer": surya_recognizer,
    }
