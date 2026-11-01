# Contributing

Contributions are welcome once the repository is published. The priority is **native Paperclip chat/task parity and low-cost cross-platform operation**, not a separate voice agent product.

1. Discuss major architectural changes before implementing them. No separate conversation database, special agent identity or hidden modification of Paperclip agent instructions.
2. Use `npm run check` on Node.js 24.11+ and test Windows and Linux where relevant. Document actual test environment and any untested paths.
3. Keep changes small, use the official Paperclip plugin SDK when possible, and avoid patching Paperclip core.
4. Do not add external speech API services as required dependencies, nor log raw audio/transcripts.
5. Never commit private records, real conversations, API tokens or proprietary service configurations. Use synthetic test data.
6. License newly contributed code under this repository's MIT license; check third-party dependencies and model terms before adding them.

Before opening a PR, read `docs/ACCEPTANCE.md` and `SECURITY.md`.
