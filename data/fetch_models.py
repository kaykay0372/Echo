"""Pre-download the models to be bundled into the app later."""

import os
from pathlib import Path

CACHE_DIR = Path("./model_cache").resolve()
HF_CACHE_DIR = CACHE_DIR / "huggingface"
WHISPER_CACHE_DIR = CACHE_DIR / "whisper"

os.environ["HF_HOME"] = str(HF_CACHE_DIR)

import whisper
from sentence_transformers import SentenceTransformer
from surya.detection import DetectionPredictor
from surya.foundation import FoundationPredictor
from surya.recognition import RecognitionPredictor
from transformers import BlipForConditionalGeneration, BlipProcessor

WHISPER_MODEL_NAME = "base"
BLIP_MODEL_ID = "Salesforce/blip-image-captioning-base"
EMBEDDING_MODEL_ID = "BAAI/bge-base-en-v1.5"


def main() -> None:
    HF_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    WHISPER_CACHE_DIR.mkdir(parents=True, exist_ok=True)

    print(f"Downloading models into {CACHE_DIR} ...")

    print("  [1/4] bge-base-en-v1.5 ...")
    SentenceTransformer(EMBEDDING_MODEL_ID)

    print("  [2/4] whisper base ...")
    whisper.load_model(WHISPER_MODEL_NAME, download_root=str(WHISPER_CACHE_DIR))

    print("  [3/4] BLIP ...")
    BlipProcessor.from_pretrained(BLIP_MODEL_ID)
    BlipForConditionalGeneration.from_pretrained(BLIP_MODEL_ID)

    print("  [4/4] Surya ...")
    DetectionPredictor()
    RecognitionPredictor(FoundationPredictor())

    print(f"Done.")


if __name__ == "__main__":
    main()
