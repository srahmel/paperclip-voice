# Paperclip Voice

Local speech input and output for existing Paperclip agent chats. The optional
voice-dialog plugin detects a pause, transcribes with local faster-whisper,
sends a normal Paperclip comment, reads an agent reply with local Piper, and
listens again. Text and normal permissions remain in Paperclip. The normal
dictation button still allows editing before sending.

## Requirements

- A compatible Paperclip installation with the authenticated local audio routes
  provided by the patches in `dictation/`.
- The local faster-whisper and Piper environments and models. The repair task
  described in `dictation/ensure-voice-runtime.ps1` restores missing runtime
  components. No cloud API key or separate Voicebox service is required.
- A browser with MediaRecorder, Web Audio and microphone access on HTTPS or
  localhost. Chrome and Edge are the primary targets.
- A Paperclip version supporting the `appShellOverlay` plugin slot. On Windows,
  the Paperclip plugin loader may require the accompanying Windows loader patch.

## Use

Open an existing task and select **Sprachmodus für diesen Task** in its header.
The task becomes the conversation target; press **Sprachmodus starten**. The
global waveform button can also select the current task. Standalone agent chats
require Paperclip's Agent Chat feature. Starting an agent voice session checks
this setting and attempts to enable it through the existing Paperclip API when
needed. If the signed-in user lacks permission, the interface explains how an
administrator can enable it; task conversations remain available.
Allow microphone access. When you finish speaking, pause; the message
is sent automatically. The agent's reply is read aloud and listening resumes.
The short-answer request is visible in each submitted voice message. **Stoppen**
releases the microphone. The panel can also disable automatic sending.

Voice recognition can misinterpret background noise or words, and submitted
messages can trigger normal agent work. Test in a quiet place and while parked.
Mobile browsers may pause recording or playback in the background or when the
screen locks. Microphone, Bluetooth, and end-to-end operation must be verified
on the actual device; browser permission and autoplay policies vary.

## Install, update, rollback

Build with Node 24: `npm install` and `npm run check`. Back up the Paperclip
database, verify the target instance, then install the local plugin with an
authorized Paperclip administrator using `paperclipai plugin install --local
<absolute-path-to-repository>`. Use the Paperclip plugin manager to disable or
uninstall the plugin; the native dictation and speech patches remain separate.
Record and reapply the native Paperclip patches after upstream updates only after
reviewing compatibility. The Windows loader patch and installation notes are
also maintained in the private Paperclip configuration backup.

The UI communicates with authenticated same-origin Paperclip endpoints; audio
is processed locally, not intentionally logged or persisted. Conversations are
stored as normal Paperclip text comments. The browser session's existing access
rights and Paperclip approvals remain in force. A failed or ambiguous submission
is not retried automatically. Spoken replies are shortened; full details remain
in the chat.

## Development

`npm run check` runs the unit tests, TypeScript check, and plugin build. The
previous experimental Voicebox client and its tests remain in the repository for
reference, but the active plugin UI does not depend on Voicebox or Docker.
