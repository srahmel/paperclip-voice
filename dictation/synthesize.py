"""One-shot local Piper TTS. JSON in, WAV out; neither is persisted or logged."""
import io
import json
import os
import sys
import wave
from pathlib import Path

MODELS = {
    "de": "de/de_DE/thorsten/medium/de_DE-thorsten-medium.onnx",
    "en": "en/en_US/lessac/medium/en_US-lessac-medium.onnx",
}


def main():
    request = json.loads(sys.stdin.buffer.read(32769))
    text, language = request["text"], request["language"]
    if not isinstance(text, str) or not text.strip() or len(text) > 4000 or language not in MODELS:
        raise ValueError("invalid request")
    model = Path(os.environ["PAPERCLIP_TTS_MODEL_DIR"]) / MODELS[language]
    if not model.is_file() or not Path(str(model) + ".json").is_file():
        raise ValueError("model unavailable")
    from piper import PiperVoice

    voice = PiperVoice.load(model, use_cuda=False)
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        voice.synthesize_wav(text, wav)
    data = output.getvalue()
    if len(data) > 16 * 1024 * 1024:
        raise ValueError("audio too large")
    sys.stdout.buffer.write(data)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Never expose user text or third-party exception details to logs.
        sys.exit(1)
