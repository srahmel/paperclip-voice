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
- Final code review removed an inherited style that hid the public task button.
  Imported recording submission now finishes without entering a microphone loop;
  worker cancellation/shutdown awaits the owned processing operation. Tests and
  TypeScript passed again after these changes. Live UI acceptance is still pending.
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

## Completed on the existing Windows host

- Voice 0.2.0 and Image Review 0.1.1 are ready, with no recorded plugin error.
  The operator approved the additional Voice capabilities. The upgrade endpoint
  refused capability expansion and offered no working approval continuation;
  normal soft uninstall/reinstall retained the same plugin ID and preserved data.
- Explicit company-scoped native runtime/model paths and Windows SystemRoot were
  configured. The Plugin Manager displays the settings and passes configuration
  validation. The actual audio health action returns ready.
- An imported synthetic WAV produced an editable transcript through the real
  authenticated bridge. Automatic submission remained off. Manual submission
  created one native comment on an unassigned synthetic task and finished the
  dictation. The task stayed completed; the tests caused no agent runs.
- After the four local feature patches were removed, the UI was built into its
  normal output retaining old assets. The existing orderly restart drained zero
  agent runs, stopped PostgreSQL and exited with code zero. Windows briefly
  retained old port entries; the runner waited until the port was released.
  The initial short observation window expired before restart completed, then
  the new process reached healthy/ready and loaded all three installed plugins.
- The exact authenticated company-scoped legacy dictation/speech routes return
  404. The standard composer has no legacy microphone/speaker controls. Both
  public Voice toolbar entries work. Import/transcript preview was repeated on
  this core without sending a second voice comment.
- A real post-restart speech job returned a validated 31276-byte WAV through the
  plugin bridge. This proves synthesis and transport, not physical playback.
- The standalone image editor selected a native synthetic attachment, zoomed
  from 49 to 62 percent, drew one mark and explicitly saved feedback plus an
  annotated attachment using the normal APIs after core patch removal.
- The temporary CLI admin token was revoked, its subsequent request returned
  401, and its local credential was removed. Browser sessions were preserved.

## Remaining acceptance limits

- Physical microphone, audible playback and full voice conversation with a human.
- Mobile, Bluetooth and background recording remain device-specific checks.
- No Linux or pristine upstream-host installation acceptance is claimed. Existing
  unrelated technical host corrections remain; this removes the feature patches.
