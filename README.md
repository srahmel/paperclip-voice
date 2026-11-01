# Paperclip Voice

**Local speech-to-text and text-to-speech for existing [Paperclip](https://github.com/paperclipai/paperclip) agent chats and issues.** A separate, open-source plugin for Windows and Linux.

> **Status: alpha prototype.** The 18 isolated Node tests pass. A live Paperclip installation, a browser microphone, and a German Voicebox container have **not** yet been tested together. The Paperclip plugin SDK is evolving. This project is not currently a verified, production-ready release.

[Deutsch / German README](README.de.md) · [Architecture](docs/DESIGN.md) · [Acceptance checklist](docs/ACCEPTANCE.md) · [Verification](docs/VERIFICATION.md) · [Security](SECURITY.md) · [Publish](PUBLISH.md)

## The problem

Paperclip has durable agent chats and tasks. Existing voice integrations do not yet provide the required combination of automatic German/English dictation, local audio generation, **native Paperclip chat/task persistence**, and spoken follow-up replies. This project does not create a second chat database or independent LLM conversation.

## What works in the prototype

- An always-available **Voice** panel using the official `appShellOverlay` plugin slot; no Paperclip core fork.
- Microphone recording with automatic silence detection using Web Audio RMS thresholds (not speaker recognition).
- Local transcription through [agjs/voicebox](https://github.com/agjs/voicebox), configured with multilingual `faster-whisper-small` rather than upstream's English-only model.
- The transcribed message is submitted via Paperclip's **existing authenticated chat/issue comment API**. The agent receives it in the normal conversation and can continue its regular work.
- Native Paperclip agent replies are read from the **same existing issue comments**, then spoken through the local Piper TTS engine; additional comments arriving later can be spoken too.
- Auto-send, optional review-before-send, auto-listen-after-reply, stop, noise threshold, German/English transcription.
- Optional *visible, per-message* request for concise agent replies, while preserving the full original Paperclip comments. Speech output is also shortened without another LLM call.
- Docker-based local STT/TTS service, compatible with Linux hosts and Windows Docker Desktop (Linux container mode). CPU-only by default.

No per-minute STT/TTS API charges or Speko account. **Normal Paperclip LLM/agent costs, hardware, and electricity still apply.** A phone sends audio to the self-hosted Paperclip server over HTTPS (e.g., Tailscale Serve): “local” means the speech server is yours, not that the phone runs Whisper.

## How it works

```text
Phone / desktop browser (existing Paperclip UI)
      |
      | MediaRecorder -> silence detection -> audio over the authenticated Paperclip bridge
      v
Paperclip Voice plugin worker
      |       <-------> Voicebox on 127.0.0.1:8790
      |                  faster-whisper (STT) + Piper (TTS)
      v
Existing Paperclip Agent Chat issue / task
      |  POST /api/issues/:id/comments  (existing user session)
      |  GET  /api/issues/:id/comments  (same source of truth)
      v
Existing agent executes work -> same issue receives normal agent replies
      |
      +-> Voicebox TTS -> browser playback
```

**Important:** The plugin uses normal Paperclip issue comments, *not* `ctx.agents.sessions.create()`. This is deliberate: commands and progress remain visible in the standard web interface. The plugin does **not** grant special permissions, silently approve actions, or alter agent instruction files.

## Requirements

- Self-hosted Paperclip installation exposing the alpha plugin SDK and `appShellOverlay` slot. The bundled build targets SDK `2026.1023.0`, but your **installed** host version must be checked.
- Paperclip **Agent Chat** feature enabled when using the normal agent-chat route.
- Node.js **24.11+**, npm, Git and a working Paperclip plugin CLI.
- Docker Desktop **Windows with Linux containers** or Docker Engine on Linux. Docker isn't required by the TypeScript plugin itself; it runs the audio server.
- Browser with `MediaRecorder`, `getUserMedia`, and `AudioContext`. Microphone access requires HTTPS or `localhost`.
- Optional private mobile access: **Tailscale Serve HTTPS**. **Tailscale Funnel is not required.** Never expose Voicebox directly through Funnel.

## Start local speech server (Linux and Windows)

The upstream Voicebox image's default STT model is **English-only**. The supplied Dockerfile extends its published pinned image and adds multilingual Whisper and the German Piper voice.

Linux:

```bash
docker compose -f voicebox/compose.yaml up -d --build
curl -fsS http://127.0.0.1:8790/health
```

Windows PowerShell (Docker Desktop running Linux containers):

```powershell
docker compose -f voicebox/compose.yaml up -d --build
curl.exe http://127.0.0.1:8790/health
```

Expected when ready: `{"status":"ok","models_loaded":true}`. The build downloads speech model assets; plan enough disk and RAM. Audio processing works offline *after* the models are available. The audio API binds to the host's **127.0.0.1 only**; Paperclip and Voicebox must be on the same host for the default configuration. If Paperclip itself is containerized, adapt its internal networking without exposing the audio API.

## Install plugin

Run in the cloned `paperclip-voice` folder on the **Paperclip host**:

```bash
npm install
npm run check
npx paperclipai plugin target  # verify the target instance first
npx paperclipai plugin install --local /absolute/path/to/paperclip-voice
npx paperclipai plugin list
```

Windows PowerShell, example path:

```powershell
cd C:\Projects\paperclip-voice
npm install
npm run check
npx paperclipai plugin target
npx paperclipai plugin install --local "C:\Projects\paperclip-voice"
```

**Do not install against a live customized instance before taking a backup and checking SDK compatibility.** This plugin modifies neither Paperclip core code nor agent prompts, databases or the existing service/watchdog configuration. Plugin config defaults: audio server `http://127.0.0.1:8790`, language `de`, Piper voice `de_DE-thorsten-medium`, spoken reply limit `380` characters.

## Use

1. Open an existing agent chat or issue in Paperclip, or open the floating **Voice** panel and choose an agent.
2. Start voice mode, grant microphone access, speak and pause. After ~1.25 seconds of silence, the audio is transcribed locally and optionally auto-submitted as a **normal Paperclip comment**.
3. Paperclip's existing agent does the work. The voice panel speaks relevant newly appearing agent comments and can return to listening for a follow-up.
4. You can open the same chat and issue from any standard Paperclip browser session; the durable text history is unchanged.
5. Press **Stop** to close capture and stop playback. Disabling auto-send lets you review/edit the recognized text before it is committed.

For voice instructions to be concise, enable **Request concise replies**. The request is an explicit *visible suffix* on the submitted comment. There is no invisible per-run system-prompt injection. Full work output is still available in Paperclip; the spoken version is deterministically abbreviated. Some detailed task output may need to be read manually.

## Security / privacy

- The client only sends recorded audio through the authenticated Paperclip origin. The plugin worker contacts a service restricted to `localhost` or `127.0.0.1`, using a guarded URL and upload size.
- Transient audio and speech synthesis are not intentionally persisted or logged by this plugin. Normal **text comments** are persisted by Paperclip, as intended.
- The UI forwards the current authenticated user's request, not a privileged background agent identity. Existing Paperclip authorization, auditing, budgets and approval rules remain in force.
- A failed/unknown response after a submitted comment must **not** cause automatic re-submission.
- **No claim of Android lock-screen support:** mobile browsers may suspend capture/playback after backgrounding. This needs separate validation (or a native app).
- Loud vehicle noise can confuse RMS silence detection. Test only while parked; never rely on the system for safety-critical interactions.

See [SECURITY.md](SECURITY.md) for threat boundaries and responsible disclosures.

## Development

```bash
npm test           # isolated Node tests; no Paperclip or Docker
npm run typecheck  # requires installed SDK/React/typescript dependencies
npm run build      # creates dist/manifest.js, dist/worker.js, dist/ui/index.js
npm run check      # all three
```

CI validates builds/tests on both `ubuntu-latest` and `windows-latest` with Node 24. This is **not** a substitute for full hardware/browser live tests. Follow [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md) before claiming an operational release.

## Existing related projects / prior art

- [denour/paperclip-plugin-tts](https://github.com/denour/paperclip-plugin-tts) — manual TTS playback of existing issues/comments; not full bidirectional automatic voice chat.
- [agjs/voicebox](https://github.com/agjs/voicebox) — local OpenAI-compatible faster-whisper STT + Piper/Kokoro TTS server. **Reused**, not copied into this repo.
- [mvanhorn/paperclip-plugin-slack](https://github.com/mvanhorn/paperclip-plugin-slack) — voice-message transcription through Slack workflows; not integrated browser dialogue.
- [paperclipai/paperclip](https://github.com/paperclipai/paperclip) — core platform and official plugin SDK.

## Roadmap / known gaps

- Run the live SDK/browser/audio acceptance matrix; add Playwright end-to-end tests with a real Paperclip fixture.
- Better vehicle-noise-resistant VAD; smarter buffering of simultaneous replies.
- Speech playback for meaningful progress versus every long comment; optional voice selection per locale.
- Android display-off/background mode (would likely require a dedicated native client).
- Publish npm package **only after** compatibility and license checks. For now the repository can be public, while `package.json`'s `"private": true` deliberately prevents premature npm publication. This flag does **not** make the GitHub repository private.

## License

This plugin's original source is MIT-licensed. Third-party model, runtime and container licensing is **independent**; specifically `piper-tts` in the separate audio-server image is GPL-3.0. Consult [THIRD_PARTY.md](THIRD_PARTY.md) before redistributing a Docker image. No model weights, recordings or proprietary user data are stored in this repository.
