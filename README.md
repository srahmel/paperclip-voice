# Paperclip Voice

Local Whisper transcription and Piper speech for existing Paperclip tasks and
agent chats. Version 0.2 uses the public plugin action bridge, task toolbar,
global toolbar and app overlay. No Paperclip core patch or private composer
DOM structure is required.

## Use

Open a task or existing agent chat and select **Sprachmodus** in the toolbar.
The panel is bound to that conversation. Navigating away stops recording and
playback. Closing the panel, stopping or disabling the plugin releases audio
resources and cancels pending audio jobs.

- Start the microphone, speak, then pause. By default, review and edit the text
  before selecting **Transkript absenden**.
- Enable automatic submission only for a continuing voice conversation.
- The concise-answer instruction stays visible in each submitted comment.
- Existing agent answers stay in Paperclip and can be spoken with local Piper.
- Under **Optionen**, import a recording for transcription and text review.
  Imported recordings are never submitted automatically. After manual submission,
  dictation finishes; follow the answer in Paperclip or start a microphone session.
- Agent conversations require Paperclip's Agent Chat setting. Normal task/chat
  authorization applies. A submitted comment can wake its assigned agent.

The native Paperclip composer and gallery are not modified. Microphone access
requires HTTPS or localhost and a compatible browser. A suspended or locked
mobile browser can interrupt audio.

## Local audio engine

The default `python` backend reuses installed faster-whisper and Piper runtimes.
The plugin owns the Python workers under `dictation/`. They receive pipe input,
run offline with bounded output and timeouts, and have no network listener.
Audio and transcripts are not written to logs.

Configure these company-scoped plugin settings. The host filters plugin process
environments, so host-level settings alone may not be visible. Environment
fallbacks apply only when explicitly supplied to the plugin worker:

| Plugin setting | Host environment fallback |
| --- | --- |
| `sttPython` | `PAPERCLIP_VOICE_PYTHON` |
| `sttModelDir` | `PAPERCLIP_VOICE_MODEL` |
| `ttsPython` | `PAPERCLIP_TTS_PYTHON` |
| `ttsModelDir` | `PAPERCLIP_TTS_MODEL_DIR` |
| `windowsSystemRoot` | `SystemRoot` / `WINDIR` |

Existing Windows setup helpers are in `dictation/`. Model/Python installation is
an explicit deployment step. Opening Voice does not download models. Whisper,
Piper and voices retain their separate licenses.

The optional `voicebox` backend supports an existing loopback service. The old
Docker recipe is not a prerequisite: its upstream image rejected anonymous
pulling during migration and is not a verified installation path.

## Build and install

Use Node.js 24.11+ in the existing plugin checkout:

```sh
npm test
npm run typecheck
npm run build
paperclipai plugin target
paperclipai plugin install --local /absolute/path/to/paperclip-voice
```

For verification without replacing an installed `dist`, set
`PAPERCLIP_PLUGIN_OUTDIR=.cache/build` before `npm run build`. The build refuses
output outside the project. Use the normal `dist` for installation.
Plugin ID: `paperclip-plugin-voice`.

Do not apply legacy audio/core patches. Plugin actions handle audio jobs;
ordinary Paperclip APIs handle comments. Disable/uninstall through Plugin Manager.
Existing conversations, attachments and model installations remain.

## Verification

See [the verification record](docs/VERIFICATION.md) and
[acceptance checklist](docs/ACCEPTANCE.md). A build or synthetic speech roundtrip
does not prove microphone capture, human speech quality, Bluetooth or mobile
background operation.
