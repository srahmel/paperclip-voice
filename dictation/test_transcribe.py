import io
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest
import wave

WORKER = Path(__file__).with_name("transcribe.py")


def wav(seconds):
    output = io.BytesIO()
    with wave.open(output, "wb") as audio:
        audio.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
        audio.writeframes(b"\0\0" * (16000 * seconds))
    return output.getvalue()


class WorkerTest(unittest.TestCase):
    def run_worker(self, data, *args):
        return subprocess.run([sys.executable, str(WORKER), *args], input=data, capture_output=True, timeout=30, env=os.environ)

    def test_silence_returns_empty_without_logs(self):
        result = self.run_worker(wav(1), "de", "wav")
        self.assertEqual(result.returncode, 0)
        self.assertEqual(json.loads(result.stdout), {"text": ""})
        self.assertEqual(result.stderr, b"")

    def test_invalid_format_size_and_duration_are_rejected(self):
        for data, args in [(b"bad", ("de", "mov")), (b"x" * (5 * 1024 * 1024 + 1), ("en", "wav")), (wav(91), ("de", "wav")), (b"x", ("de", "hls"))]:
            result = self.run_worker(data, *args)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(result.stdout, b"")
            self.assertEqual(result.stderr, b"")


if __name__ == "__main__":
    unittest.main()
