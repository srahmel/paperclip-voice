# Paperclip Voice

**Hands-free conversations with your existing [Paperclip](https://github.com/paperclipai/paperclip) agents — using local Whisper STT and Piper TTS.**

**Status: experimental alpha (v0.1.1).** Cross-platform unit tests and build checks run in GitHub Actions; real Paperclip installation, microphone, Bluetooth and mobile tests are still required.

**No Paperclip core patch is needed by this implementation.** The plugin uses Paperclip's official `appShellOverlay` slot, authenticated plugin action bridge, and standard issue/chat comment API. Voice does **not** create a separate agent session, task database or conversation history. The whole answer stays in Paperclip; only its spoken version is shortened.

[Deutsche Anleitung](README.de.md) · [Architecture](docs/DESIGN.md) · [Live acceptance checklist](docs/ACCEPTANCE.md) · [Security](SECURITY.md)

## What it does

- An optional floating **Voice** panel on existing Paperclip pages.
- Speak German or English. Silence detection ends a recording, then local Whisper transcribes it.
- Sends a **normal human-attributed Paperclip comment** to the selected native agent chat or issue.
- Reads **existing agent comments**, including later replies, and speaks them with local Piper.
- Optionally continues listening after each answer. Transcripts can also be reviewed before submission.
- Speech processing runs on the Paperclip host, not a paid API. Normal agent/LLM usage and hardware costs remain.
- Portable: Node.js plugin + Linux Docker image. Works with Linux Docker Engine or Windows Docker Desktop in Linux-container mode.

**Important:** A browser can suspend audio and microphone access with the phone locked, or while backgrounded. This is a turn-based conversation, not a guaranteed hands-free Android Auto/CarPlay service. Always test while parked.

## Requirements

1. Paperclip with the **plugin SDK v1**, `appShellOverlay`, an authenticated operator session, and Agent Chat enabled when using existing agent conversations.
2. Node.js **24.11+**, npm and Git.
3. Docker Engine (Linux) or Docker Desktop (Windows, Linux containers), with enough memory for CPU Whisper and Piper.
4. Chrome or Edge (or a compatible browser) with microphone permissions on a secure origin (`https://` or `localhost`).
5. For remote-phone access, your existing **Tailscale Serve HTTPS** can expose Paperclip privately. Tailscale Funnel and public Voicebox ingress are unnecessary.

Do not apply any of the legacy patches in `dictation/` to install this standalone plugin. If your installed Paperclip version cannot load an ordinary plugin on Windows, treat that as a separate compatibility issue and verify the host before considering changes.

## Installation (Paperclip core untouched)

### 1. Clone and verify the plugin

```bash
git clone https://github.com/srahmel/paperclip-voice.git
cd paperclip-voice
npm install
npm run check
```

### 2. Start the local audio engine

```bash
docker compose -f voicebox/compose.yaml up -d --build
docker compose -f voicebox/compose.yaml ps
curl http://127.0.0.1:8790/health
```

On Windows PowerShell, use `curl.exe http://127.0.0.1:8790/health`. The health response should report `status: "ok"` and `models_loaded: true`. The first Docker build downloads the multilingual Whisper model and Piper voices, and may take significant disk space and CPU time.

The Voicebox endpoint must remain on **127.0.0.1:8790 on the Paperclip server**. The included Compose file binds only that host loopback address. Never expose the audio engine via Funnel or a router port forward.

### 3. Confirm the correct Paperclip instance and install

```bash
npx paperclipai plugin target
npx paperclipai plugin install --local /absolute/path/to/paperclip-voice
npx paperclipai plugin list
```

PowerShell (from the cloned project folder):

```powershell
npx paperclipai plugin target
npx paperclipai plugin install --local (Get-Location).Path
npx paperclipai plugin list
```

Stop if `plugin target` points to the wrong instance. Installation should report the plugin as `ready`. Plugin configuration is company-scoped; `voiceboxUrl` defaults to `http://127.0.0.1:8790`. This assumes **Paperclip runs on the Docker host**, not inside another container. Containerized Paperclip needs an explicitly configured private service network instead of the host-loopback default.

If a Windows loader error occurs, do **not** apply the archived Windows patch blindly. First capture the installed Paperclip revision and the exact loader error; the host may need a compatibility fix or a supported upstream version.

### 4. Test in Paperclip

Open an **existing agent chat** or task. Click **Voice**, select the target, and start the voice mode. Speak a harmless test request, then pause. Confirm the transcript appears as a normal comment in **the same Paperclip chat**. The response should be present in that chat and read aloud. The UI should show the local Voicebox health status.

By default voice messages are automatically sent and include a **visible** short-answer request. Disable auto-send if you want to inspect transcriptions before submitting. This plugin never changes agent system prompts, budgets or approval policies.

## Architecture

```text
Browser mic / speaker
     ↕ authenticated Paperclip plugin action bridge (base64 audio, bounded)
Paperclip plugin worker ───→ Voicebox 127.0.0.1:8790
                               faster-whisper STT / Piper TTS
     ↕ ordinary authenticated Paperclip issue/chat API
Existing agent chats, issues, comments and approvals
```

Paperclip's plugin bridge has a 30-second default RPC deadline. Audio inference runs as asynchronous, bounded jobs in the plugin worker; the browser polls their status. No separate external API, LLM session or unprotected speech webhook is created.

**Security and limitations:** voice and transcript bytes are not intentionally persisted or logged by the plugin; submitted text **is** persisted as normal Paperclip comments. The plugin limits audio size, output length, requests and concurrent inference. A failed/ambiguous comment submission is never silently retried. The browser still requires a user gesture to unlock the microphone and speakers. See [SECURITY.md](SECURITY.md).

## Updates and rollback

Build and check in the plugin directory, then use the Paperclip plugin manager for update, disable or uninstall. These operations must not delete existing Paperclip issues or chats. Stop Voicebox with `docker compose -f voicebox/compose.yaml down` once nothing uses it. Do not reset or overwrite an existing Paperclip checkout.

The old `dictation/` directory is retained only as a **legacy alternative for separately patched hosts**. It is not needed or recommended for this independent plugin.

## License

The plugin code is MIT. Voicebox, faster-whisper, Piper and their model assets have independent license terms. See [THIRD_PARTY.md](THIRD_PARTY.md) before shipping prebuilt images.

## Development

```bash
npm test
npm run typecheck
npm run build
npm run check
```

Windows/Linux CI verifies compilation and unit behavior only. Actual microphone, real-time processing, speaker playback and native Paperclip persistence require an installation-level acceptance run; see [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md).
