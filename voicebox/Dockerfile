# Reuse the existing, separately licensed Voicebox audio service.
# The published upstream image is English-only. Bake multilingual German models.
FROM ghcr.io/agjs/voicebox:0.2.16
ENV VOICEBOX_STT_MODEL=Systran/faster-whisper-small \
    VOICEBOX_STT_MODEL_REVISION=main \
    VOICEBOX_PIPER_VOICE=de_DE-thorsten-medium \
    VOICEBOX_TTS_ENGINE=piper \
    HF_HUB_OFFLINE=0
# As the upstream non-root voicebox user; downloads models at build time.
RUN python scripts/fetch_models.py
ENV HF_HUB_OFFLINE=1
