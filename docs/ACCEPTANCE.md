# Plugin-only acceptance

Use a synthetic unassigned task. Do not send test instructions to a real agent.
Keep pass, fail and not-run results separate.

- [x] Plugin tests, TypeScript and an isolated output build.
- [x] Pipe I/O, bounded output, timeout, cancellation and private child environment.
- [x] Authenticated job company/user ownership and worker shutdown tests.
- [x] Local Windows Piper to Whisper synthetic roundtrip; one word misrecognized.
- [ ] Both plugins reload on the existing host with their new manifests.
- [ ] Explicit local runtime configuration; no host secret environment forwarding.
- [ ] Real plugin bridge imports an audio fixture and shows an editable transcript.
- [ ] Imported audio never submits automatically.
- [ ] Task/global toolbar opens Voice; no native composer DOM elements are needed.
- [ ] Panel close, Stop and navigation cancel microphone/playback and pending jobs.
- [ ] Physical microphone and human speech quality.
- [ ] Standard comment submission and agent answer playback, when explicitly tested.
- [ ] Image selection, zoom, marking and explicit feedback without the core gallery patch.
- [ ] Four legacy feature patches removed, UI rebuilt, host healthy, old audio routes absent.
- [ ] Mobile microphone, Bluetooth and locked-screen/background behavior.

Do not certify unperformed physical-device or live checks from unit tests.
