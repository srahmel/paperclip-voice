# Verification log — 1 November 2026

## Passed in the development container

- **18 / 18** Node.js isolated tests for local speech API shapes, security limits, normal Paperclip issue/chat API requests, comment submission idempotency semantics, VAD rules and text cleanup.
- TypeScript/TSX syntax parsed with the TypeScript compiler frontend for `src/manifest.ts`, `src/worker.ts` and `src/ui/index.tsx` (no parse diagnostics).
- Public source-content scan: no known proprietary project names, personal IDs, business domains, local operator paths, secrets or voice recordings.

## Not run / cannot claim

- **Full dependency install, typecheck, and esbuild build**: npm registry DNS egress was unavailable in this environment (`EAI_AGAIN registry.npmjs.org`). The GitHub Actions workflow is set to run these checks after publication.
- **Docker image build**: Docker engine is not installed in the development container.
- **Real Paperclip plugin registration / end-to-end**: No access to the local running Paperclip instance, microphone or signed-in browser.
- **Windows / Linux runtime verification**: CI matrix has been prepared, but no runs have executed yet.
- **Mobile lock-screen usability**: unverified and not promised.

## Source review notes

- Manifest now includes `issue.comments.read`, needed for both speaking and monitoring the original Paperclip comments.
- Voicebox's default English-only STT must be replaced by a multilingual model at image-build time.
- The default German TTS voice is baked into the local image, not retrieved by the browser.
- Native Paperclip calls use authenticated standard endpoints; plugin-created LLM sessions are intentionally absent.
