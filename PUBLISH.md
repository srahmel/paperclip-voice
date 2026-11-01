# Public alpha release checklist

The source repository is public: https://github.com/srahmel/paperclip-voice

## Current strategy

- Publish the **independent plugin**, not modifications to Paperclip's core.
- Run `npm install && npm run check` on Node.js 24+.
- Check [GitHub Actions](https://github.com/srahmel/paperclip-voice/actions) for green Windows/Linux results.
- Build and run Voicebox locally via `docker compose -f voicebox/compose.yaml up -d --build`.
- Verify the target Paperclip instance and plugin compatibility before installation.
- Run the [live acceptance checklist](docs/ACCEPTANCE.md) in a non-production environment.
- Document failures and versions; never apply the archived `dictation/` patches automatically.
- Review the [security policy](SECURITY.md) and [third-party licenses](THIRD_PARTY.md) before distribution.

**Do not advertise production-ready or hands-free locked-phone operation before real acceptance testing.**

Do not distribute a prebuilt Docker image containing GPL-licensed Piper binaries without meeting the applicable license and notice obligations. The Dockerfile is a local build recipe.
