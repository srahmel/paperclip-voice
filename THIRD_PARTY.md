# Third-party components and model licensing

This repository's **plugin code** is MIT. It does not vendor Voicebox source, model weights or Piper binaries. Installing and building `voicebox/compose.yaml` pulls/downloads separate third-party material whose license obligations must be honored independently.

| Component | Upstream | License / caution |
|---|---|---|
| Voicebox audio server | https://github.com/agjs/voicebox | MIT for the project's own code; review dependencies |
| faster-whisper | https://github.com/SYSTRAN/faster-whisper | MIT; check model weights separately |
| OpenAI Whisper models converted by SYSTRAN | https://huggingface.co/Systran/faster-whisper-small | Verify model terms before redistribution |
| Piper TTS engine | https://github.com/rhasspy/piper | `piper-tts` distribution uses GPL-3.0; binary image redistribution carries obligations |
| German voice `de_DE-thorsten-medium` | https://huggingface.co/rhasspy/piper-voices/tree/main/de/de_DE/thorsten/medium | Voice model card states training dataset CC0; inspect any additional terms |

**Important:** Do not publish/re-distribute a prebuilt combined Docker image as “MIT-only”. Source-only release is the default until legal review and license/notice completeness have been checked. The Dockerfile is provided as a local build recipe, not a license waiver.
