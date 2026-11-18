# Plugin migration verification — 18 November 2026

## Completed before live activation

- Image plugin: TypeScript, 32 tests and isolated output build passed. Its synthetic
  browser preview selected an attachment, zoomed from 53 to 66 percent, drew a
  mark and saved annotated feedback through the simulated native attachment and
  comment APIs. This is not a real-task or stock-host installation proof.
- Voice plugin: 33 Node tests, TypeScript and isolated output build passed after
  merging the existing standalone backend with the local task-aware UI.
- New subprocess tests exercise real pipe I/O, environment filtering, output
  bounds, timeout and cancellation. Worker tests reject another company/user,
  agent invocation, unauthorized job polling/cancellation, and stale shutdown jobs.
- Native Windows / Node 24.22.1: plugin-owned Python code generated a 167468-byte
  WAV with the installed German Piper voice, then transcribed it with the
  installed offline faster-whisper model. Most of the synthetic phrase was
  correct; the word Plugin was recognized as Klugchen. This is not a speech
  accuracy or microphone acceptance result.

## Failed attempts and changes

- The inherited Voicebox Docker build failed: its configured GHCR image rejected
  anonymous token retrieval with HTTP 401. No container/service was started.
  Default audio now reuses existing local Python runtimes from the plugin worker.
- Initial merge conflicts in the UI imports/status text and README were resolved
  around public plugin actions, official toolbar slots and no composer DOM mount.
- Typecheck initially caught incomplete request types and cancellation options;
  those were corrected before the passing check.
- The host deliberately filters plugin environments. Native Python/SystemRoot
  and model locations therefore need explicit company plugin configuration.

## Still requires live proof

- Reloaded plugins and authorized configuration on the actual Paperclip host.
- Imported recording through the real authenticated plugin action bridge.
- Physical microphone, playback and full voice conversation with a human.
- Standalone image entry and editor after removal of the native gallery patch.
- Controlled removal of the old feature patches, host UI build, health and
  endpoint absence checks. No stock-host or Linux acceptance is claimed here.
- Mobile, Bluetooth and background recording remain device-specific checks.
