# Testing Microsoft TrOCR for text extraction from images rather than just captioning.

from transformers import TrOCRProcessor, VisionEncoderDecoderModel
from PIL import Image
import time

IMAGE_PATH = "ex_image.png"
MODEL_NAME = "microsoft/trocr-base-printed"

# Text shorter than this is treated as "no text found"
MIN_MEANINGFUL_LENGTH = 15

# Load model
start = time.time()
processor = TrOCRProcessor.from_pretrained(MODEL_NAME)
model = VisionEncoderDecoderModel.from_pretrained(MODEL_NAME)
print(f"Loaded in {round(time.time() - start, 2)}s\n")

# Open image
image = Image.open(IMAGE_PATH).convert("RGB")

# Run model
start = time.time()
pixel_values = processor(images=image, return_tensors="pt").pixel_values
generated_ids = model.generate(pixel_values)
extracted = processor.batch_decode(generated_ids, skip_special_tokens=True)[0].strip()
latency_ms = round((time.time() - start) * 1000)

# Results
has_meaningful_text = len(extracted) >= MIN_MEANINGFUL_LENGTH

print(f"Image:    {IMAGE_PATH}")
print(f"Latency:  {latency_ms}ms")
print(f"Output:   '{extracted}'")
print(
    f"Decision: {'USE this text as the note content' if has_meaningful_text else 'NO text found — fall back to image captioning'}"
)

print("\n--- Evaluation log ---")
print(f"Model:   {MODEL_NAME}")
print(f"Latency: {latency_ms}ms")
print(f"Output:  '{extracted}'")
print(f"Has meaningful text: {has_meaningful_text}")
