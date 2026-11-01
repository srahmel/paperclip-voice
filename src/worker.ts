import { definePlugin, runWorker } from '@paperclipai/plugin-sdk';

// Audio and comments use the same authenticated routes as the native UI.
const plugin = definePlugin({
  async setup() {},
  async onHealth() { return { status: 'ok' }; },
});

export default plugin;
runWorker(plugin, import.meta.url);
