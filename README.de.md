# Paperclip Voice

Local dictation and read-aloud support for existing Paperclip tasks and agent chats.
Version 0.2 requires no changes to Paperclip core. Plugin-owned JavaScript places
a microphone and a read-aloud button next to the composer's plus button.
The microphone opens dictation for that exact input, including the New Task dialog.
After transcript review, the insert-transcript button appends to the existing
draft; nothing is submitted or created automatically. The speaker reads the
latest accessible agent reply without creating a chat.

General voice mode is available directly below Chat in the left navigation.
It lets you select an existing task or agent chat. A small, narrowly scoped DOM
adapter handles placement. If Paperclip's structure changes or the target cannot
be identified unambiguously, the official toolbar entry remains available as a
fallback. No internal React or editor objects are used.

The transcript is shown for review first. Automatic submission is optional;
imported recordings always remain in transcript review. Stopping, closing the
panel or navigating away ends recording and playback.

The Python backend uses an existing local Whisper/Piper installation.
Python and model paths are configurable in the plugin settings; existing
`PAPERCLIP_VOICE_*` and `PAPERCLIP_TTS_*` settings provide defaults.
Audio processing runs in the plugin worker using bounded subprocesses, without
an additional port. The detailed [installation and usage guide](README.md)
describes installation and separate microphone/mobile-device acceptance checks.

This file retains its historical filename for existing links. Repository
Markdown documentation and code comments are maintained in English.
