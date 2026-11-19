# Architecture and deliberate limitations

This document records the original Voicebox architecture and its limitations.
For the current default Python backend and plugin-only installation, see the
[README](../README.md) and [migration verification record](VERIFICATION.md).

## One source of data

- Paperclip `GET/POST /api/companies/:companyId/chats/:agentRef` opens/creates a **normal** agent-chat issue only on the first submission.
- Paperclip `POST /api/issues/:issueId/comments` writes voice input as a normal human-authenticated comment, including the idempotency `clientRequestId`.
- Paperclip `GET /api/issues/:issueId/comments` or SDK `ctx.issues.listComments` reads the **same** original agent replies.
- No `ctx.agents.sessions.create` and no separate history backend. The agent chat remains visible in the main UI.

## Audio stays on the host

```text
Smartphone/PC -- Tailscale HTTPS --> Paperclip UI (plugin slot)
  MediaRecorder + audio RMS silence detection
         | base64 JSON, max 2 MiB, signed-in user
         v
  Paperclip Plugin Worker (validates company, audio, issue)
         | HTTP localhost:8790
         v
    Voicebox (faster-whisper multilingual, Piper German)
         | transcription TEXT
         v
  Native Paperclip issues/comments API <-- auth browser cookie
         | durable normal issue, normal agent reply
         v
  Plugin reads verified agent comment --> local Voicebox TTS
         | WAV base64 via authenticated bridge
         v
  Browser WebAudio playback
```

## Concise speech, complete work

The optional concise-answer instruction is **visible at the end of the user's
comment**. There is no global prompt change or hidden agent message. Speech
output shortens the spoken text deterministically, without an additional LLM,
while retaining the complete Paperclip result in the chat. This deliberately
has different semantics from a concise system prompt.

## Windows/Linux

The plugin code uses no OS paths or shell calls. Voicebox runs in an isolated
Linux container under both Docker Desktop (Windows) and Docker Engine (Linux).
There is no CUDA/NVIDIA dependency. The first Docker image build requires
Internet access for models; subsequent use can operate offline.

## Known risks

1. **Alpha SDK:** `appShellOverlay` and the bridge version must be revalidated after Paperclip updates.
2. **Provider model:** the upstream Voicebox image is English-only; our Dockerfile adds German/multilingual models. The build has not yet been verified live.
3. **Audio bandwidth:** base64 WAV travels through Paperclip's JSON bridge for short replies. Long podcasts are outside the scope.
4. **Background browser:** locking the screen can interrupt AudioContext and MediaRecorder.
5. **VAD while driving:** simple RMS is used instead of neural VAD; actual driving noise can disrupt detection.
6. **Polling:** approximately every 1.8–2.5 seconds; it may slow down or stop after a long session or navigation. A complete event stream would be a subsequent optimization.
7. **Long-running tasks:** multiple later comments are observed, but a new reply received while the user is speaking is considered only after the current turn.
8. **Automatic submission:** transcription errors may become instructions in Paperclip. Disable auto-send for high-risk tasks; enforce approval rules separately.

## Public development roadmap

First test on the unchanged local Paperclip instance. Next: native SDK permissions
and authentication tests, better VAD, UI localization, optional browser-local
speech synthesis, buffered status replies, and Android background operation as a
separate client scope. Before release: a license matrix, an open-source security
audit, and no confidential private-company data or paths in published code.
