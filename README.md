# Paperclip Voice

Paperclip Voice offers general conversations with OpenAI Realtime and local
Whisper dictation and Piper speech for Paperclip tasks and chats. The plugin
uses the Paperclip action bridge, app overlay, and native task API.

## Use

Select the microphone beside the composer's **+** to open dictation for that
exact input. Start recording or import an audio file, review the transcript and
select **In Eingabe übernehmen**. Existing draft text is preserved and the
normal Send/Create task button remains the only way to submit it. This also
works in **New Task**. The adjacent speaker reads the latest accessible agent
reply; reading never creates a new conversation.

For a continuing voice conversation, select **Voice mode** directly below
**Chat** in the left navigation. Voice remembers the last selected agent for
each company in the current browser tab. Close the panel or select **Stoppen**
to end the conversation and release the microphone. Navigating away also stops
recording and playback.

### OpenAI Realtime

In the Voice plugin configuration select **openai** under **General voice mode**,
bind **OpenAI Realtime API key** to a Paperclip company secret, and select the
region matching the OpenAI project. **eu** is the default and requires an
eligible EU project. **OpenAI Realtime voice** selects the conversation voice.
The API key stays on the server. The browser streams live microphone audio to
OpenAI over WebRTC, using billed OpenAI API usage. A call is limited to ten minutes.

Select the agent for tasks and choose **Gespräch starten**. Discuss the work
or ask questions in German, English, Dutch, or Norwegian Bokmål. Voice can
create a task through the signed-in user's normal Paperclip permissions when
the intended work is clear. The selected agent receives that task. Voice cites
the Paperclip task number after the save succeeds. Ordinary conversation does
not create a Paperclip chat or task. Voice has no access to agent chat history
or existing tasks in a Realtime session.

### Local conversations

With **General voice mode** set to **local**, choose an agent chat or a recent
task as the destination. Opening Voice from a task also uses the local flow.

- Choose **Freisprechen starten**, then speak and pause. Voice reads back the
  transcript before sending a question or task. Say **Ja** or **Ja, senden**
  to send, **Nein** to discard, or **Korrektur** followed by the replacement
  message. A confirmation expires after 30 seconds.
  German can use streaming Moonshine. English, Dutch and Norwegian Bokmål use
  local Whisper after each pause and then resume listening after the reply.
  The panel shows the microphone level and indicates when speech is detected.
- Choose **Aufnahme mit Vorschau starten** to review and edit the text before
  selecting **Transkript absenden**.
- The concise-answer instruction stays visible in each submitted comment.
- Existing agent answers stay in Paperclip and can be spoken with local Piper.
- Under **Optionen**, import a recording for transcription and text review.
  Imported recordings are never submitted automatically. After manual submission,
  dictation finishes; follow the answer in Paperclip or start a microphone session.
- Agent conversations require Paperclip's Agent Chat setting. Normal task/chat
  authorization applies. A submitted comment can wake its assigned agent.

The native Paperclip source and gallery are not modified. Microphone access
requires HTTPS or localhost and a compatible browser. A suspended or locked
mobile browser can interrupt audio.

## Composer and navigation adapter

The host currently has no composer-control slot or sidebar insertion-order API.
At the operator's request, a small plugin-owned DOM adapter locates the exact
composer Add button and binds only its own unique editable input. It also mounts
the general Voice button after the company's Chat link. It does not inspect
React/Lexical internals, overwrite native controls, or read arbitrary page text.
If the structure is absent or ambiguous, it leaves native UI alone and retains
the official toolbar fallback. Mutation scans are throttled and all mounts are
removed on company/navigation changes or plugin unmount.

Plain-text insertion follows the browser editing path and was verified with
native Undo/Redo. The rich-editor path uses
[`execCommand('insertText')`](https://developer.mozilla.org/en-US/docs/Web/API/Document/execCommand),
which is deprecated but retains browser edit history. Unsupported insertion
keeps the editable transcript rather than guessing another input. Check this
adapter after host/browser upgrades; physical microphone/mobile acceptance is
separate from this UI integration check.

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

In **Paperclip Voice (Local) → Configuration**, choose a Piper voice for each
language. **Default language** sets the initial selection in **Voice mode**,
where you can switch languages for dictation and spoken replies.

| Language | Voices |
| --- | --- |
| German | Thorsten, Kerstin, or **Use saved voice ID** |
| English | Lessac (US), Cori (UK) |
| Dutch | Alex (Netherlands), Nathalie (Belgium) |
| Norwegian Bokmål | Talesyntese, NVCC |

**Use saved voice ID** preserves the existing German Piper voice or defaults
to Thorsten. The Windows Piper setup helper installs the model and configuration
file for every preset. Install missing models before selecting them on an
existing host. Runtime paths and the saved German Piper voice ID are under
**Advanced options**. The Moonshine hands-free pilot uses a German streaming model.

The optional `voicebox` backend supports an existing loopback service. The old
Docker recipe is not a prerequisite: its upstream image rejected anonymous
pulling during migration and is not a verified installation path.

### German hands-free pilot

Set `moonshinePython` to a separate Python environment containing
`dictation/requirements-streaming.txt`, and set `moonshineModelDir` to the German
Small Streaming model directory emitted by the Moonshine downloader. For example,
run this once in the dedicated environment:

```sh
python -m pip install -r dictation/requirements-streaming.txt
python -m moonshine_voice.download --stt --language de --model-arch 4 --root /path/to/local/model-cache
```

Moonshine's 0.1.6 Python downloader prints a generic Community License notice
for every language other than English. The project's [0.1.6 release license][moonshine-license]
and [model list][moonshine-models] identify German Small Streaming as MIT-licensed.

With German selected and Moonshine configured, hands-free mode sends speech in
chunks over authenticated Paperclip plugin actions. An in-memory recognizer
stays active between turns. If it returns an empty transcript, the plugin
passes the current turn to local Whisper using the audio already received.
After spoken confirmation, Voice can play a preloaded Piper clip once while
Paperclip is still saving the message or while the agent reply is pending. It
plays the submission acknowledgment once Paperclip accepts the message. Voice
reads back agent replies and adds a task-creation acknowledgment when the agent
supplies a task receipt that can be verified against Paperclip. The microphone
resumes after the spoken reply.

The runtime reads preinstalled model files and has no separate network listener,
cloud speech service, or audio recording store. The accepted text is posted as
a normal Paperclip comment and follows the assigned agent's existing execution
and data processing configuration. The browser requires a secure origin.
Streaming requires AudioWorklet support, and recording with local Whisper uses
MediaRecorder. The pilot is browser-based, so validate background capture,
Bluetooth, road noise, and screen lock on the target device before mobile use.

[moonshine-license]: https://github.com/moonshine-ai/moonshine/blob/v0.1.6/docs/license.md
[moonshine-models]: https://github.com/moonshine-ai/moonshine/blob/v0.1.6/docs/models/available-models.md

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

## Repository language

Write all Markdown documentation and source-code comments in English, including
architecture and design documents. Localized user-interface strings and test
fixtures may remain in their intended language; documentation may quote exact
UI labels to help users identify controls.
