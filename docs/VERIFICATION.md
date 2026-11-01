# Verification log — 1 November 2026

## What is verified

- On the core-free plugin branch, all **25 isolated Node.js unit tests** pass.
- The standalone TypeScript/React plugin compiles and builds on **Windows and Linux** using Node.js 24 in GitHub Actions.
- The plugin uses authenticated Paperclip plugin actions and standard native issue/chat comment APIs. It does not require the legacy core audio routes.
- Long inference runs asynchronously inside the plugin worker, avoiding the usual 30-second synchronous bridge limit.

[Cross-platform green CI run](https://github.com/srahmel/paperclip-voice/actions/runs/41340666001) for source commit `c2c3a3d83ad5e87612e10871960e0ba8af658c69`.

## Not verified (do not claim success)

- A real Voicebox Docker image build, model download and runtime STT/TTS health check on the user's Windows computer or on Linux.
- Plugin registration and loading on the user's locally customized Paperclip version.
- Real microphone capture, German transcription, audio output, task wakeup and reply playback on a signed-in Paperclip browser session.
- Mobile Tailscale HTTPS, microphone and Bluetooth behavior; particularly locked-screen/background recording.
- The legacy Windows plugin-loader patch is not automatically applied. Compatibility has to be checked on the installed Paperclip revision.

**Only the actual live acceptance checklist can establish end-to-end usability.** See [ACCEPTANCE.md](ACCEPTANCE.md).
