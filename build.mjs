// Official Paperclip bundler presets handle host-provided React and SDK dependencies.
import { rm } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { createPluginBundlerPresets } from '@paperclipai/plugin-sdk/bundlers';

const root = fileURLToPath(new URL('.', import.meta.url));
const outdir = resolve(root, process.env.PAPERCLIP_PLUGIN_OUTDIR || 'dist');
const outputPath = relative(root, outdir);
if (!outputPath || outputPath.startsWith('..') || isAbsolute(outputPath)) {
  throw new Error('Plugin output must be inside the project directory');
}
const presets = createPluginBundlerPresets({
  workerEntry: 'src/worker.ts',
  manifestEntry: 'src/manifest.ts',
  uiEntry: 'src/ui/index.tsx',
  sourcemap: true,
  outdir,
});
await rm(outdir, { recursive: true, force: true });
await Promise.all([
  esbuild.build(presets.esbuild.worker),
  esbuild.build(presets.esbuild.manifest),
  esbuild.build({ ...presets.esbuild.ui, jsx: 'automatic' }),
  esbuild.build({ entryPoints: ['src/ui/voice-capture-worklet.js'], outfile: resolve(outdir, 'ui/voice-capture-worklet.js'), target: 'es2022' }),
]);
console.log('Built Paperclip Voice plugin (worker, manifest, UI).');
