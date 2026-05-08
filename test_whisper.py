# Transcribes an audio file using OpenAI Whisper running entirely locally.

import whisper
import time
import os

AUDIO_FILE = "test_audio.mp4"

# STEP 1: Check the file exists 
print("\n STEP 1: Checking audio file ")

if not os.path.exists(AUDIO_FILE):
    print(f"\n ERROR: Could not find '{AUDIO_FILE}' in the current directory.")
    exit(1)

file_size_mb = os.path.getsize(AUDIO_FILE) / (1024 * 1024)
print(f"Found: {AUDIO_FILE} ({file_size_mb:.1f} MB)")

# STEP 2: Load Whisper model
print("\n STEP 2: Loading Whisper 'base' model ") #fast, okay accuracy compared to "tiny" and "small" models

start = time.time()
model = whisper.load_model("base")
load_time = time.time() - start
print(f"Model loaded in {load_time:.1f} seconds")

# STEP 3: Transcribe the audio
print(f"\n STEP 3: Transcribing '{AUDIO_FILE}' ")

start = time.time()

result = whisper.transcribe(model, AUDIO_FILE, fp16=False, verbose=False)

transcription_time = time.time() - start

# STEP 4: Print the results
print(f"\n STEP 4: Transcription result ")
print(f"Time taken: {transcription_time:.1f} seconds")
print(f"Language detected: {result['language']}")
print(f"\nTranscribed text:\n")
print("─" * 60)
print(result["text"].strip())
print("─" * 60)

# STEP 5: Check segment-level detail
print(f"\n STEP 5: Segment breakdown (timestamps) ")

for segment in result["segments"][:5]:  # show first 5 segments only
    start_ts = segment["start"]
    end_ts = segment["end"]
    text = segment["text"].strip()
    print(f"  [{start_ts:.1f}s → {end_ts:.1f}s] {text}")

if len(result["segments"]) > 5:
    print(f"  ... and {len(result['segments']) - 5} more segments")

# STEP 6: Simulate what Echo will do with this transcript
print(f"\n STEP 6: What Echo would do with this transcript ")

word_count = len(result["text"].split())
char_count = len(result["text"])
print(f"Transcript stats:")
print(f"  Words: {word_count}")
print(f"  Characters: {char_count}")
print(f"  Ready to embed: {'Yes' if word_count > 3 else 'Too short - record a longer memo'}")

# STEP 7: Record your findings ─
print(f"\n STEP 7: Test Results ")
print(f"  Audio file:          {AUDIO_FILE} ({file_size_mb:.1f}MB)")
print(f"  Whisper model:       base")
print(f"  Load time:           {load_time:.1f}s")
print(f"  Transcription time:  {transcription_time:.1f}s")
print(f"  Language detected:   {result['language']}")
print(f"  Word count:          {word_count}")