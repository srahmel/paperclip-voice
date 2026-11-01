"""Bounded, offline, one-shot faster-whisper worker. Audio is stdin only."""
import io
import json
import os
import sys

MAX_BYTES = 5 * 1024 * 1024
MAX_SAMPLES = 90 * 16000


def main():
    if len(sys.argv) != 3:
        raise ValueError("arguments")
    language, container_format = sys.argv[1:]
    if language not in ("auto", "de", "en"):
        raise ValueError("language")
    if container_format not in ("matroska", "ogg", "mov", "wav"):
        raise ValueError("format")
    audio = sys.stdin.buffer.read(MAX_BYTES + 1)
    if not audio or len(audio) > MAX_BYTES:
        raise ValueError("audio size")
    model_path = os.environ["PAPERCLIP_VOICE_MODEL"]
    if not os.path.isdir(model_path):
        raise ValueError("model unavailable")

    import av
    import numpy as np
    from faster_whisper import WhisperModel

    chunks = []
    count = 0
    # Force an audio container demuxer; do not auto-detect playlist protocols.
    with av.open(io.BytesIO(audio), mode="r", format=container_format) as container:
        resampler = av.AudioResampler(format="s16", layout="mono", rate=16000)
        for frame in container.decode(audio=0):
            for converted in resampler.resample(frame):
                samples = converted.to_ndarray().reshape(-1)
                count += samples.size
                if count > MAX_SAMPLES:
                    raise ValueError("audio duration")
                chunks.append(samples)
        for converted in resampler.resample(None):
            samples = converted.to_ndarray().reshape(-1)
            count += samples.size
            if count > MAX_SAMPLES:
                raise ValueError("audio duration")
            chunks.append(samples)
    if not chunks:
        raise ValueError("empty audio")
    pcm = np.concatenate(chunks).astype(np.float32) / 32768.0
    if np.max(np.abs(pcm)) < 0.001:
        print(json.dumps({"text": ""}))
        return
    model = WhisperModel(model_path, device="cpu", compute_type="int8", cpu_threads=4, local_files_only=True)
    segments, _ = model.transcribe(pcm, language=None if language == "auto" else language, vad_filter=True, beam_size=1)
    text = " ".join(segment.text.strip() for segment in segments).strip()
    print(json.dumps({"text": text}, ensure_ascii=True))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Never expose audio, transcript or library error details to logs.
        sys.exit(1)
