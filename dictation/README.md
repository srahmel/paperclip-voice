# Local dictation integration

This directory contains a separate, manual dictation integration. It does not activate the repository's experimental voice-dialog plugin, submit messages, speak replies, or change agent instructions. `paperclip-core.patch` was produced against Paperclip commit `4942502c4` and requires review and revalidation on other versions. The Paperclip plugin API in that version does not expose an editable composer slot.

The browser records at most 85 seconds and 5 MiB, then sends the bytes to an authenticated, company-scoped Paperclip endpoint. A single on-demand worker consumes audio from stdin and returns a transcript on stdout. No worker port, API key, cloud transcription, or persistent audio file is used. The worker forces an allowed demuxer, caps decoded audio at 90 seconds, uses CPU int8 and loads the local multilingual faster-whisper small model. The Paperclip endpoint applies the existing board-origin and company checks before reading the request. A worker is killed after three minutes or when its browser request disconnects. An aborted or failed transcription leaves the existing text usable.

## Setup

Install Python 3.13 x64, then run `./dictation/setup-windows.ps1 -RuntimeRoot <directory-outside-git>`. Downloads occur only during setup. Models and the virtual environment belong outside Git. Set these environment variables in the existing Paperclip service environment, using absolute paths:

* `PAPERCLIP_VOICE_PYTHON`: `<runtime>/voice-venv/Scripts/python.exe`
* `PAPERCLIP_VOICE_WORKER`: `<this-repository>/dictation/transcribe.py`
* `PAPERCLIP_VOICE_MODEL`: `<runtime>/voice-models/faster-whisper-small`

Apply the matching core patch, build the UI, and restart Paperclip following the operator's backup and service procedures. There is no separate server or scheduled task; each request starts its own CPU worker and reaps it at completion. The existing Paperclip watchdog continues to monitor Paperclip only. A cold model load makes each request slower. A hard termination of the Paperclip process may leave an already running worker until it exits; normal cancellation and shutdown through the request terminate it.

Select Auto, DE or EN beside the microphone. Click once to record, again to transcribe; the X cancels. Review and edit the inserted text before sending. Use localhost on desktop or a properly trusted HTTPS origin for remote devices; ordinary LAN HTTP does not provide browser microphone access. Browser microphone permission is required. Mobile recording and codecs require device-specific verification.

## Updating and rollback

Back up the Paperclip source, UI build and service configuration first. Check `git apply --check` against the new Paperclip version; review composer and authorization changes before adapting the patch. Re-run tests and a browser acceptance test before deploying. Roll back by stopping Paperclip, restoring the previous source/UI build and service configuration from backup, then starting the existing service and checking its health. The runtime and model can be removed separately after confirming that no worker is running. Do not reset or overwrite unrelated local changes.

The public voice-dialog prototype in the rest of this repository has different behavior and is not a dependency of this integration.
