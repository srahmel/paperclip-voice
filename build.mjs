// Official Paperclip bundler presets handle host-provided React and SDK dependencies.
import { rm } from 'node:fs/promises';
import * as esbuild from 'esbuild';
import { createPluginBundlerPresets } from '@paperclipai/plugin-sdk/bundlers';

const presets = createPluginBundlerPresets({
  workerEntry: 'src/worker.ts',
  manifestEntry: 'src/manifest.ts',
  uiEntry: 'src/ui/index.tsx',
  sourcemap: true,
});
await rm('dist', { recursive: true, force: true });
await Promise.all([
  esbuild.build(presets.esbuild.worker),
  esbuild.build(presets.esbuild.manifest),
  esbuild.build({ ...presets.esbuild.ui, jsx: 'automatic' }),
]);
console.log('Built Paperclip Voice plugin (worker, manifest, UI).');
