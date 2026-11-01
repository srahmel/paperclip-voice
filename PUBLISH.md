# Publish as a public GitHub repository

This source tree is **prepared for public release**, but a GitHub repository is **not** created automatically by this archive. A repository owner with permission to create repositories must perform the publication.

## Security check (mandatory)

- [ ] Confirm no proprietary paths, prompts, user/customer information, API keys, recordings, or agent workspaces are in the files.
- [ ] Review `SECURITY.md`, `THIRD_PARTY.md` and the third-party model license notices.
- [ ] Run `npm install && npm run check` on Node.js 24.11+.
- [ ] Validate whether the intended Paperclip host supports the installed plugin SDK and `appShellOverlay` slot.
- [ ] Decide whether to publish the alpha immediately or keep a private development branch until E2E verification.

## Create public repository with GitHub CLI

From the extracted directory (replace the destination account as needed):

```bash
git init -b main
git add .
git commit -m "feat: initial Paperclip Voice alpha plugin"
gh auth login                 # only if not already authenticated
gh repo create paperclip-voice --public --source=. --remote=origin --push
```

The repo must be **public**. The `"private": true` npm field prevents accidental **npm publication**, not GitHub visibility.

Then: open GitHub → Actions; run checks; test the acceptance checklist on both Windows and Linux; add repository topics `paperclip`, `voice`, `whisper`, `piper`, `typescript`, `open-source`.

Do not publish a pre-built GPL-containing Docker image until redistribution requirements have been reviewed. The source Dockerfile is a local build recipe.
