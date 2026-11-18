# Local audio runtime

The Python scripts are assets of the Voice plugin's default local backend.
`transcribe.py` receives bounded audio through stdin and returns JSON.
`synthesize.py` receives text/language/voice/speed JSON and returns a WAV.
Neither worker opens a network port or logs audio/text.

The Windows setup scripts install Python environments and offline models.
The model/runtime repair helper is separate from plugin installation. It must
not restore or reapply Paperclip source patches. Configure runtime/model paths
in the Voice plugin settings; the server filters plugin child environments.

Historical `*.patch` files in this directory describe the retired core-based
implementation. They are not installation instructions and are not packaged.
See the repository README and Git history for migration context.
