"""One local Moonshine model per session. PCM and transcripts cross stdin/stdout only."""

import base64
import json
import os
import sys

SAMPLE_RATE = 16000
MAX_LINE_BYTES = 44000
MAX_CHUNK_BYTES = SAMPLE_RATE * 2
MAX_TURN_SAMPLES = 30 * SAMPLE_RATE


def respond(result):
    print(json.dumps(result, ensure_ascii=True), flush=True)


def run():
    import numpy as np
    from moonshine_voice import ModelArch, Transcriber

    # An explicit filesystem path avoids the SDK's download helpers at runtime.
    with Transcriber(
        model_path=os.environ["PAPERCLIP_MOONSHINE_MODEL"],
        model_arch=ModelArch.SMALL_STREAMING,
        update_interval=0.3,
    ) as transcriber:
        stream = None
        samples = 0
        try:
            while line := sys.stdin.buffer.readline(MAX_LINE_BYTES + 1):
                if len(line) > MAX_LINE_BYTES or not line.endswith(b"\n"):
                    raise ValueError("invalid command size")
                request = json.loads(line)
                command = request["command"]
                if command == "ready":
                    respond({"ready": True})
                elif command == "audio":
                    pcm = base64.b64decode(request["audio"], validate=True)
                    if not 0 < len(pcm) <= MAX_CHUNK_BYTES or len(pcm) % 2:
                        raise ValueError("invalid audio chunk")
                    samples += len(pcm) // 2
                    if samples > MAX_TURN_SAMPLES:
                        raise ValueError("utterance too long")
                    if stream is None:
                        stream = transcriber.create_stream()
                        stream.start()
                    audio = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768.0
                    stream.add_audio(audio, SAMPLE_RATE)
                    respond({"accepted": True})
                elif command == "finish" and stream is not None:
                    transcript = stream.stop()
                    text = " ".join(line.text.strip() for line in transcript.lines).strip()
                    stream.close()
                    stream = None
                    samples = 0
                    if len(text) > 5000:
                        raise ValueError("transcript too long")
                    respond({"text": text})
                else:
                    raise ValueError("invalid command")
        finally:
            if stream is not None:
                stream.close()


if __name__ == "__main__":
    try:
        run()
    except Exception:
        sys.exit(1)
