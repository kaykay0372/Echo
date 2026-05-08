# Loads the BLIP image captioning model and generates a natural language 
# description of an image. That description is then embedded and stored
# exactly like a text note - making images semantically searchable.

from transformers import BlipProcessor, BlipForConditionalGeneration
from PIL import Image
from sentence_transformers import SentenceTransformer
import time
import os
import sys

IMAGE_FILE = "test_image.png"

# STEP 1: Check the image file exists
print("\nSTEP 1: Checking image file")

if not os.path.exists(IMAGE_FILE):
    print(f"\n Could not find '{IMAGE_FILE}' in the current directory.")
    sys.exit(1)

img = Image.open(IMAGE_FILE).convert("RGB")
print(f"Found: {IMAGE_FILE} — size: {img.size[0]}x{img.size[1]} pixels")

# STEP 2: Load BLIP model
print("\n STEP 2: Loading BLIP image captioning model ")

start = time.time()

try:
    processor = BlipProcessor.from_pretrained("Salesforce/blip-image-captioning-base")
    blip_model = BlipForConditionalGeneration.from_pretrained(
        "Salesforce/blip-image-captioning-base"
    )
    load_time = time.time() - start
    print(f"BLIP loaded in {load_time:.1f} seconds")

except Exception as e:
    print(f"\n BLIP failed to load: {e}")
    sys.exit(1)

# STEP 3: Generate a caption 
print(f"\n STEP 3: Generating caption for '{IMAGE_FILE}' ")

start = time.time()

# Unconditional captioning - model describes what it sees freely
inputs = processor(img, return_tensors="pt")
output = blip_model.generate(**inputs, max_new_tokens=50)
caption = processor.decode(output[0], skip_special_tokens=True)
caption_time = time.time() - start

print(f"\nCaption generated in {caption_time:.1f} seconds")
print(f"\nCaption: \"{caption}\"")

# STEP 4: Generate a conditional caption 
# Prompt the model with a starting phrase. EG: "what creative elements are in this image?"
print(f"\n STEP 4: Conditional caption (prompted) ")

prompt = "a photograph of"
inputs_conditional = processor(img, prompt, return_tensors="pt")
output_conditional = blip_model.generate(**inputs_conditional, max_new_tokens=50)
caption_conditional = processor.decode(output_conditional[0], skip_special_tokens=True)

print(f"Prompted with: \"{prompt}\"")
print(f"Result: \"{caption_conditional}\"")

# STEP 5: Embed the caption
print(f"\n STEP 5: Embedding the caption (same pipeline as text notes) ")

embed_model = SentenceTransformer("all-MiniLM-L6-v2")
embedding = embed_model.encode([caption])

print(f"Caption: \"{caption}\"")
print(f"Embedding shape: {embedding.shape}")

# STEP 6: Record findings ───
print(f"\n STEP 6: Test Results ")
print(f"  Image model:         BLIP (blip-image-captioning-base)")
print(f"  Image file:          {IMAGE_FILE} ({img.size[0]}x{img.size[1]})")
print(f"  Model load time:     {load_time:.1f}s")
print(f"  Caption time:        {caption_time:.1f}s")
print(f"  Generated caption:   \"{caption}\"")
print(f"  Embedding shape:     {embedding.shape}")

# Test CLIP
#  pip install ftfy regex tqdm
#  pip install git+https://github.com/openai/CLIP.git
#
# import clip
# import torch
# from PIL import Image
# from sentence_transformers import SentenceTransformer
#
# IMAGE_FILE = "test_image.jpg"  # update this
#
# model, preprocess = clip.load("ViT-B/32", device="cpu")
# image = preprocess(Image.open(IMAGE_FILE)).unsqueeze(0)
#
# with torch.no_grad():
#     image_features = model.encode_image(image)
#     image_features = image_features / image_features.norm(dim=-1, keepdim=True)
#
# print(f"Image embedding shape: {image_features.shape}")