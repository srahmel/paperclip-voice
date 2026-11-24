# Third-party components and model licensing

This repository's **plugin code** is MIT. It does not vendor Voicebox source, model weights or Piper binaries. Installing and building `voicebox/compose.yaml` pulls/downloads separate third-party material whose license obligations must be honored independently.

| Component | Upstream | License / caution |
|---|---|---|
| Voicebox audio server | https://github.com/agjs/voicebox | MIT for the project's own code; review dependencies |
| faster-whisper | https://github.com/SYSTRAN/faster-whisper | MIT; check model weights separately |
| OpenAI Whisper models converted by SYSTRAN | https://huggingface.co/Systran/faster-whisper-small | Verify model terms before redistribution |
| Piper TTS engine | https://github.com/rhasspy/piper | `piper-tts` distribution uses GPL-3.0; binary image redistribution carries obligations |
| German voice `de_DE-thorsten-medium` | https://huggingface.co/rhasspy/piper-voices/tree/main/de/de_DE/thorsten/medium | Voice model card states training dataset CC0; inspect any additional terms |
| German voice `de_DE-kerstin-low` | [Piper model card](https://huggingface.co/rhasspy/piper-voices/blob/v1.0.0/de/de_DE/kerstin/low/MODEL_CARD) | Voice model card states training dataset CC0 |
| English voice `en_GB-cori-medium` | [Piper model card](https://huggingface.co/rhasspy/piper-voices/blob/b4e358ffcb232591bf73a540e70f7de528e4174a/en/en_GB/cori/medium/MODEL_CARD) | Model card identifies public-domain training data |
| Dutch voices `nl_NL-alex-medium` and `nl_BE-nathalie-medium` | [Alex model card](https://huggingface.co/rhasspy/piper-voices/blob/b4e358ffcb232591bf73a540e70f7de528e4174a/nl/nl_NL/alex/medium/MODEL_CARD), [Nathalie model card](https://huggingface.co/rhasspy/piper-voices/blob/b4e358ffcb232591bf73a540e70f7de528e4174a/nl/nl_BE/nathalie/medium/MODEL_CARD) | Model cards state training dataset CC0 |
| Norwegian voices `no_NO-talesyntese-medium` and `no_NO-nvcc-medium` | [Talesyntese model card](https://huggingface.co/rhasspy/piper-voices/blob/b4e358ffcb232591bf73a540e70f7de528e4174a/no/no_NO/talesyntese/medium/MODEL_CARD), [NVCC model card](https://huggingface.co/rhasspy/piper-voices/blob/b4e358ffcb232591bf73a540e70f7de528e4174a/no/no_NO/nvcc/medium/MODEL_CARD) | Model cards state training dataset CC0 |
| Moonshine runtime and German Small Streaming model | [Moonshine v0.1.6 license](https://github.com/moonshine-ai/moonshine/blob/v0.1.6/docs/license.md) | MIT for this streaming model; installed separately |

**Important:** Do not publish/re-distribute a prebuilt combined Docker image as “MIT-only”. Source-only release is the default until legal review and license/notice completeness have been checked. The Dockerfile is provided as a local build recipe, not a license waiver.
