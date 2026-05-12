# Testing Surya for text extraction from images with mixed content (text, diagrams, photos).
# See if it can run without the same errors as easyOCR.

from surya.foundation import FoundationPredictor
from surya.recognition import RecognitionPredictor
from surya.detection import DetectionPredictor
from PIL import Image
import time

IMAGE_PATH = "test_image.png"
CONFIDENCE_THRESHOLD = 0.5
MIN_TEXT_LENGTH = 3
MIN_MEANINGFUL_LENGTH = 15

# Load models
start = time.time()
foundation_predictor = FoundationPredictor()
rec_predictor = RecognitionPredictor(foundation_predictor)
det_predictor = DetectionPredictor()
print(f"Loaded in {round(time.time() - start, 2)}s\n")

# Open image
image = Image.open(IMAGE_PATH).convert("RGB")
width, height = image.size

# Run model
start = time.time()
predictions = rec_predictor([image], det_predictor=det_predictor) # rec_predictor handles both detection and recognition internally
latency_ms = round((time.time() - start) * 1000)

# Parse results
lines = []
skipped = 0
for line in predictions[0].text_lines:
    text = line.text.strip()
    confidence = line.confidence
    if confidence >= CONFIDENCE_THRESHOLD and len(text) > MIN_TEXT_LENGTH:
        lines.append(text)
    else:
        skipped += 1

extracted = "\n".join(lines)
has_meaningful_text = len(extracted) >= MIN_MEANINGFUL_LENGTH

# Results
print(f"Image:      {IMAGE_PATH}  ({width}x{height}px)")
print(f"Latency:    {latency_ms}ms")
print(f"Lines kept: {len(lines)}  |  Lines skipped (low confidence / too short): {skipped}")
print(f"Output:\n{extracted if extracted else '(none)'}")
print("\n--- Evaluation log ---")
print(f"Model:      Surya v0.17+ (auto-detect lang, confidence>={CONFIDENCE_THRESHOLD}, min_len>{MIN_TEXT_LENGTH})")
print(f"Latency:    {latency_ms}ms")
print(f"Lines kept: {len(lines)}, skipped: {skipped}")
print(f"Output:     '{extracted}'")
print(f"Has meaningful text: {has_meaningful_text}")