# Plugin-only acceptance

Use a synthetic unassigned task. Do not send test instructions to a real agent.
Keep pass, fail and not-run results separate.

- [x] Plugin tests, TypeScript and an isolated output build.
- [x] Pipe I/O, bounded output, timeout, cancellation and private child environment.
- [x] Authenticated job company/user ownership and worker shutdown tests.
- [x] Local Windows Piper to Whisper synthetic roundtrip; one word misrecognized.
- [x] Both plugins reload on the existing host with their new manifests.
- [x] Explicit local runtime configuration; no host secret environment forwarding.
- [x] Real plugin bridge imports an audio fixture and shows an editable transcript.
- [x] Imported audio never submits automatically; manual submission finishes dictation.
- [x] Task/global toolbar opens Voice; no native composer DOM elements are needed.
- [x] Panel close after imported dictation; worker cancellation/shutdown tests.
- [ ] Physical microphone/playback teardown on Stop, close and navigation.
- [ ] Physical microphone and human speech quality.
- [x] One native dictation comment on an unassigned synthetic task, with no agent run.
- [x] Real plugin speech job returns a validated WAV after host restart.
- [ ] Agent-answer playback and complete live microphone conversation.
- [x] Image selection, zoom, marking and explicit feedback without the core gallery patch.
- [x] Four legacy feature patches removed, UI rebuilt, host healthy, old audio routes absent.
- [x] Direct microphone/speaker beside Add, general Voice below Chat, native toolbar fallback.
- [x] Dictation appends to the correct draft; native Undo/Redo; no automatic submission.
- [x] New Task modal dictation inserts into its own editor without creating a task.
- [ ] Mobile microphone, Bluetooth and locked-screen/background behavior.

Do not certify unperformed physical-device or live checks from unit tests.
