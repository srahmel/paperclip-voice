# Security policy

**Alpha prototype: not yet audited for production use.** Test against a non-production Paperclip instance first. The project has no independently verified hosted security boundary; it relies on Paperclip's existing session authentication and company authorization.

## Threat boundaries

- Paperclip serves plugin UI as same-origin code. Installing a third-party plugin gives it broad browser trust: audit its code before installation.
- Voicebox is a **private host service**. `voicebox/compose.yaml` binds its port to host `127.0.0.1` only. Never publish it to `0.0.0.0` on the host, Tailscale Funnel or public Internet.
- Do not proxy arbitrary URLs into the plugin worker. Only validated local Voicebox URLs are accepted.
- Audio upload size is limited to 2 MiB; Voicebox additionally limits audio duration and input size.
- Microphone permissions are managed by the browser. The microphone should stop when voice mode stops or the plugin unmounts.
- Transcription can be inaccurate: auto-send makes the *transcribed text* a real Paperclip instruction, subject to all normal approval controls. Disable auto-send for risky use.
- Paperclip task messages are *durable text records*. Deleting a local audio snippet does not delete the corresponding task comment.
- Browser background/lock-screen audio is not guaranteed.
- Remote mobile traffic should use authenticated HTTPS with Tailscale Serve or an equivalently secure channel. Voicebox itself stays on the server's loopback interface.

## Reporting issues

Please open a private security advisory with the eventual GitHub repository owner, not a public issue containing proof-of-concept credentials or sensitive recordings. Until advisory support is configured, do not attach confidential information to public issues.

## Avoid committing

Audio recordings, model weights, secrets/tokens, local runtime directories, API keys, personal paths, company data, workspaces, diagnostic logs, database backups and user transcripts.
