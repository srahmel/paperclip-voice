# Companion bridge development pilot

The candidate extends the existing local Voice UI. It is a tested development
build, not an installed/released Companion or a production acceptance result.
No extra runtime dependency, worker API, capability, voice identity or backend
was added. No production conversation, routine or setting is changed by tests.

## Run locally

Use Node.js 24.11 or newer and the existing repository toolchain:

```powershell
npm install --no-audit --no-fund
npm run check
```

For the optional synthetic browser path, use a Paperclip checkout that already
provides `@playwright/test`, React and React DOM and an installed Edge browser:

```powershell
node tests/browser/voice-state.browser.mjs C:/dev/paperclip msedge
```

The script builds the actual `VoiceOverlay` with a minimal fake host-location
adapter, serves it on an ephemeral loopback port, and closes both server and
browser afterwards. It uses a generated MediaStream and WAV output, real
MediaRecorder/Web Audio, and fake authenticated API responses. It opens no
microphone, sends no real messages, and contacts no external service. A request
outside the fixture origin is blocked. The host's plugin loader and SDK bridge
are not exercised by this harness. Browser dependencies are optional and are
not installed by the test. The ordinary CI check does not run this browser path.

Optionally check a supplied Companion receiver's exported `createVoiceReceiver`
and `voiceState` directly, without changing its files or using any backend:

```powershell
node tests/browser/check-consumer.mjs C:/dev/companion/src/ui/voice.ts
```

This executes the supplied module locally and prints its source SHA-256 so the
result can be tied to the exact receiver source, even during parallel development.

## Recorded local verification

Environment: Windows, Node.js 26.13.0, installed Edge 157.0.4341.46,
Playwright 1.62.1, synthetic fixture at 390 x 844 CSS pixels.

- `npm run check`: 37 tests, TypeScript check and official plugin bundler pass.
- Unit cases cover terminal snapshots, exact context matching, stale sessions,
  bounded energy, late decode/resume, late ended/timer callbacks, output failure,
  suspension, stop and context invalidation.
- Browser cases cover actual pause detection/transcription/native comment/reply
  flow with fake endpoints, output analyser energy, microphone-energy exclusion,
  snapshot, stop, a delayed TTS response after a new session, conversation and
  company navigation, audio failure, navigation during output, pagehide,
  host language changes and narrow layout.
- Source-level integration with a supplied Companion receiver passes context,
  snapshot, state mapping, sequence, retired-session and stop/error checks.
  Receiver SHA-256: `ea84b3e002c60f2754569f680503f22179d049f381836476e703bcd11e883455`.
  This is one source snapshot, not live host/renderer coexistence acceptance.
- Startup reads canonical context and historical comment IDs. Browser assertions
  reject settings writes, chat creation and reading historical replies aloud.
- Comments still use native endpoints and ordinary idempotency keys; unknown
  POST outcomes still are not retried automatically.

See [the event contract](VOICE_STATE_V1.md) for integration and
[the continuity contract](CONVERSATION_CONTINUITY.md) for source-bound agreements.

## Review, install and rollback

Build in an isolated checkout/worktree. The installed local path can serve
`dist` directly, so building in a running installation may replace its assets;
do not use a production checkout for candidate builds. Installation, reload,
review and deployment are separate from these passing development tests.

Before release, review the exact candidate commit for functional regressions,
privacy and operating risks through the project's required independent
reviewers. This pilot does not claim those reviews. Confirm compatibility with
the target host plugin loader, existing audio patches and plugin SDK. The
manifest retains the same slots and capability; its static task label is now
English, and runtime controls follow the host document language (English
fallback; German supported). Speech language remains a separate choice.

On a reviewed, authorized **test instance**, install the built local plugin
through Paperclip's normal plugin manager or CLI. Open an existing conversation,
choose **Voice mode** beside the composer and **Start voice mode**. Agent Chat
must already be enabled by an authorized administrator. Voice checks that
setting without changing it. Start/Stop and speech submission retain existing
permissions. Use editable transcript review when automatic send is unsuitable.
Closing the panel keeps voice active; its composer control remains marked active,
and reopening returns to its controls. Stop
releases capture/playback, and navigation stops the session.

Rollback by disabling the plugin and restoring/rebuilding the previously
reviewed plugin revision, then reloading the host. There is no migration,
persisted bridge state or new permission to undo. Native conversations and
already submitted comments remain; stop does not cancel agent jobs or retract
messages. Do not rewrite a running checkout or revert somebody else's work.

## Still unverified

- Physical Windows microphone, speakers/headset, echo cancellation, Bluetooth
  and the complete local Whisper/Piper service path on a test instance.
- Physical Android: HTTPS access and permission, real microphone/playback,
  background/lock screen, audio interruptions, Bluetooth, network changes and
  return to the same conversation after an interruption.
- Apple Safari/iOS/macOS audio lifecycle and actual Linux browser behavior.
- Coexistence with the real Companion consumer/renderer and the running host's
  plugin loader. The test fixture is not a complete deployed Paperclip host.
- Confirmed-agreement storage and follow-through, reminder delivery and calendar
  ingestion: integration contracts only in this package, owned elsewhere.

Do not mark these as passed based on synthetic audio, a 390px viewport, a
successful run or an event from the bridge.
