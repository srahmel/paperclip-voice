"""One-shot local Piper TTS. JSON in, WAV out; neither is persisted or logged."""
import io
import json
import os
import re
import sys
import wave
from pathlib import Path

MODELS = {
    "de": "de/de_DE/thorsten/medium/de_DE-thorsten-medium.onnx",
    "en": "en/en_US/lessac/medium/en_US-lessac-medium.onnx",
    "nl": "nl/nl_NL/alex/medium/nl_NL-alex-medium.onnx",
    "no": "no/no_NO/talesyntese/medium/no_NO-talesyntese-medium.onnx",
}


def main():
    request = json.loads(sys.stdin.buffer.read(32769))
    text, language = request["text"], request["language"]
    if not isinstance(text, str) or not text.strip() or len(text) > 4000 or language not in MODELS:
        raise ValueError("invalid request")
    voice_id = request.get("voice")
    speed = request.get("speed", 1.0)
    if not isinstance(speed, (int, float)) or not 0.7 <= speed <= 1.5:
        raise ValueError("invalid speed")
    model_relative = MODELS[language]
    if voice_id:
        match = re.fullmatch(r"([a-z]{2})_([A-Z]{2})-([a-zA-Z0-9_]+)-(low|medium|high|x_low)", voice_id)
        if not match or match[1] != language:
            raise ValueError("invalid voice")
        model_relative = f"{match[1]}/{match[1]}_{match[2]}/{match[3]}/{match[4]}/{voice_id}.onnx"
    model = Path(os.environ["PAPERCLIP_TTS_MODEL_DIR"]) / model_relative
    if not model.is_file() or not Path(str(model) + ".json").is_file():
        raise ValueError("model unavailable")
    from piper import PiperVoice, SynthesisConfig

    voice = PiperVoice.load(model, use_cuda=False)
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        voice.synthesize_wav(text, wav, syn_config=SynthesisConfig(length_scale=1.0 / speed))
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
