# Distribution

Version 0.2 is a plugin-only migration. The repository is currently private for
npm publication (`private: true`); GitHub source publication is separate.

Before an install or release:

1. Run tests, typecheck and build in the existing repository.
2. Use PAPERCLIP_PLUGIN_OUTDIR=.cache/build for a non-deploying check.
3. Inspect the package file list. Include Python workers; exclude recordings,
   models, credentials, runtime data and archived core patches.
4. Verify public task/global toolbar and overlay slots, authenticated actions,
   local runtime configuration and cancellation on the target host.
5. Record remaining physical microphone/mobile checks honestly.

No npm publish is part of the current migration. Existing models and Python
runtimes keep their own licenses and are not embedded in the npm package.
