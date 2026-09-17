import hashlib
import json
import os
import random
import string
import tempfile

import numpy as np
import pyttsx3
from PIL import Image, ImageDraw, ImageFont
from scipy.io import wavfile
from scipy.signal import resample

OUTPUT_DIR = "test_assets"
SAMPLE_RATE = 16000  # matches Whisper's expected input rate

AUDIO_DURATIONS_S = [5, 15, 30, 60, 120, 300]
IMAGE_RESOLUTIONS = [(512, 512), (1024, 1024), (1600, 1200), (2048, 2048)]
N_VARIANTS_PER_SIZE = 5

TTS_RATE_WPM = 175
FADE_OUT_S = 0.05  # short fade at the end of each audio clip
_WORDS = (
    "random sentence words for testing whisper model performance and latency "
    "meeting notes project deadline coffee delectable morning walk grocery list call "
    "mother remember buy milk scarce bread eggs finish report before friday sent "
    "email client update schedule appointment doctor next week plan trip "
    "visit family friends weekend weather forecast rain appaling sunny cloudy cold "
    "warm burn remember pick up dry cleaning pay rent check bank account balance"
).split()


def _stable_seed(*parts) -> int:
    """A replacement for Python's built-in hash(), so the same "random" seed is generated per input."""

    key = "-".join(str(p) for p in parts).encode()
    return int(hashlib.sha256(key).hexdigest(), 16) % (2**32)


def _random_sentence(random_number: random.Random, n_words: int) -> str:
    """Returns a string of randomised WORDS."""

    words = random_number.choices(_WORDS, k=n_words)
    return " ".join(words).capitalize() + "."


def _generate_speech_text(random_number: random.Random, target_words: int) -> str:
    """Returns a string of randomised WORDS, at least target_words long."""

    sentences = []
    words_so_far = 0
    while words_so_far < target_words:
        n = random_number.randint(6, 14)
        sentences.append(_random_sentence(random_number, n))
        words_so_far += n
    return " ".join(sentences)


def _synthesize_speech(
    text: str, tmp_wav_path: str, max_attempts: int = 3
) -> tuple[int, np.ndarray]:
    """Renders text to speech with a fresh pyttsx3 engine instance per attempt (prevent errors) and reads the WAV back."""

    last_error = None
    for _ in range(max_attempts):
        try:
            engine = pyttsx3.init()
            engine.setProperty("rate", TTS_RATE_WPM)
            engine.save_to_file(text, tmp_wav_path)
            engine.runAndWait()
            return wavfile.read(tmp_wav_path)
        except Exception as e:
            last_error = e
    raise RuntimeError(
        f"pyttsx3 failed to synthesize speech after {max_attempts} attempts: {last_error}"
    )


def _build_master_clip(seed: int, min_duration_s: float) -> np.ndarray:
    """One long synthesized speech clip, resampled to SAMPLE_RATE, at least min_duration_s long."""

    random_number = random.Random(seed)
    words_per_second = TTS_RATE_WPM / 60
    target_words = int(min_duration_s * words_per_second * 1.3)  # 30% safety margin

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_wav = os.path.join(tmp_dir, "speech.wav")
        attempt_words = target_words
        rate, samples = None, np.array([], dtype=np.int16)
        # Regenerate with more text if the actual TTS output came in shorter than the rate-based estimate suggests
        while True:
            text = _generate_speech_text(random_number, attempt_words)
            rate, samples = _synthesize_speech(text, tmp_wav)
            if (
                len(samples) / rate >= min_duration_s
                or attempt_words > target_words * 4
            ):
                break
            attempt_words = int(attempt_words * 1.5)

    if rate != SAMPLE_RATE:
        n_target_samples = int(len(samples) * SAMPLE_RATE / rate)
        samples = np.clip(resample(samples, n_target_samples), -32768, 32767).astype(
            np.int16
        )

    return samples


def _fade_out(samples: np.ndarray, fade_samples: int) -> np.ndarray:
    """Short linear fade at the end of an audio clip, to avoid abrupt cutoff."""

    samples = samples.copy()
    fade_samples = min(fade_samples, len(samples))
    ramp = np.linspace(1.0, 0.0, fade_samples)
    samples[-fade_samples:] = (samples[-fade_samples:] * ramp).astype(samples.dtype)
    return samples


def generate_audio_variant(durations_s: list, output_paths: dict, seed: int) -> None:
    """Builds a speech clip long enough for the longest requested duration, then saves one file per duration."""

    master = _build_master_clip(seed, min_duration_s=max(durations_s))
    for duration_s in durations_s:
        n_samples = int(duration_s * SAMPLE_RATE)
        clip = _fade_out(master[:n_samples], fade_samples=int(FADE_OUT_S * SAMPLE_RATE))
        wavfile.write(output_paths[duration_s], SAMPLE_RATE, clip)


def generate_image(size: tuple, path: str, seed: int) -> None:
    """Generates a random image with rectangles and text."""

    random.seed(seed)
    img = Image.new("RGB", size, color=(255, 255, 255))
    draw = ImageDraw.Draw(img)

    for _ in range(8):
        x0, y0 = random.randint(0, size[0]), random.randint(0, size[1])
        x1, y1 = x0 + random.randint(20, 200), y0 + random.randint(20, 200)
        color = tuple(random.randint(0, 255) for _ in range(3))
        draw.rectangle([x0, y0, x1, y1], outline=color, width=3)

    try:
        font = ImageFont.load_default()
    except Exception:
        font = None
    for _ in range(5):
        text = "".join(
            random.choices(string.ascii_letters + " ", k=random.randint(10, 40))
        )
        x, y = random.randint(0, max(1, size[0] - 100)), random.randint(
            0, max(1, size[1] - 30)
        )
        draw.text((x, y), text, fill=(0, 0, 0), font=font)

    img.save(path)


def main() -> None:
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    audio_dir = os.path.join(OUTPUT_DIR, "audio")
    image_dir = os.path.join(OUTPUT_DIR, "images")
    os.makedirs(audio_dir, exist_ok=True)
    os.makedirs(image_dir, exist_ok=True)

    manifest = []

    for i in range(N_VARIANTS_PER_SIZE):
        output_paths = {
            duration: os.path.join(audio_dir, f"audio_{duration}s_v{i}.wav")
            for duration in AUDIO_DURATIONS_S
        }
        generate_audio_variant(
            AUDIO_DURATIONS_S, output_paths, seed=_stable_seed("audio", i)
        )
        for duration, path in output_paths.items():
            manifest.append({"type": "audio", "path": path, "duration_s": duration})

    for res in IMAGE_RESOLUTIONS:
        for i in range(N_VARIANTS_PER_SIZE):
            fname = f"image_{res[0]}x{res[1]}_v{i}.png"
            path = os.path.join(image_dir, fname)
            generate_image(res, path, seed=_stable_seed(res, i))
            manifest.append({"type": "image", "path": path, "resolution": list(res)})

    with open(os.path.join(OUTPUT_DIR, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2)

    print(f"Finished generating {len(manifest)} test assets in {OUTPUT_DIR}/ !")


if __name__ == "__main__":
    main()
