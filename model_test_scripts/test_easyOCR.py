# Tests EasyOCR for text extraction since TrOCR wasn't working well. 

from PIL import Image
import easyocr
import time

IMAGE_PATH = "test_image.png"
LANGS = ["en"]
CONFIDENCE_THRESHOLD = 0.3
# Text shorter than this is treated as "no text found"
MIN_MEANINGFUL_LENGTH = 15

# Load model
start = time.time()
reader = easyocr.Reader(LANGS, gpu=False)
print(f"Loaded in {round(time.time() - start, 2)}s\n")

# Open image to get dimensions
image = Image.open(IMAGE_PATH).convert("RGB")
width, height = image.size

# Run model
start = time.time()
raw_results = reader.readtext(IMAGE_PATH, detail=1, paragraph=False)
latency_ms = round((time.time() - start) * 1000)

# Parse results
lines = []
skipped = 0
for _, text, confidence in raw_results:
    if confidence >= CONFIDENCE_THRESHOLD:
        lines.append(text.strip())
    else:
        skipped += 1

extracted = "\n".join(lines)
has_meaningful_text = len(extracted) >= MIN_MEANINGFUL_LENGTH

# Results
print(f"Image:      {IMAGE_PATH}  ({width}x{height}px)")
print(f"Latency:    {latency_ms}ms")
print(f"Lines kept: {len(lines)}  |  Lines skipped (low confidence): {skipped}")
print(f"Output:\n{extracted if extracted else '(none)'}")
print("\n--- Evaluation log ---")
print(
    f"Model:      EasyOCR (langs={LANGS}, gpu=False, confidence>={CONFIDENCE_THRESHOLD})"
)
print(f"Latency:    {latency_ms}ms")
print(f"Lines kept: {len(lines)}, skipped: {skipped}")
print(f"Output:     '{extracted}'")
print(f"Has meaningful text: {has_meaningful_text}")
