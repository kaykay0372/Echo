"""Setup ffmpeg for whisper's subprocess calls before the app is run and can call it."""

import os
import shutil
import stat
import sys

import imageio_ffmpeg


def ensure_ffmpeg_available() -> None:
    """Make the bundled ffmpeg binary discoverable under the exact name whisper's call expects."""
    ffmpeg_original = imageio_ffmpeg.get_ffmpeg_exe()
    ffmpeg_dir = os.path.dirname(ffmpeg_original)
    expected_name = "ffmpeg.exe" if sys.platform == "win32" else "ffmpeg"
    expected_path = os.path.join(ffmpeg_dir, expected_name)

    if not os.path.exists(expected_path):
        shutil.copy2(ffmpeg_original, expected_path)
        if sys.platform != "win32":
            st = os.stat(expected_path)
            os.chmod(expected_path, st.st_mode | stat.S_IEXEC)

    os.environ["PATH"] = ffmpeg_dir + os.pathsep + os.environ["PATH"]
