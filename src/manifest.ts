import type { PaperclipPluginManifestV1 } from '@paperclipai/plugin-sdk';

const manifest: PaperclipPluginManifestV1 = {
  id: 'paperclip-plugin-voice',
  apiVersion: 1,
  version: '0.1.0',
  displayName: 'Paperclip Voice (Local)',
  description: 'Speak with existing Paperclip agents and issues using local Whisper STT and Piper TTS.',
  author: 'paperclip-voice contributors',
  categories: ['ui'],
  capabilities: ['ui.action.register'],
  entrypoints: { worker: './dist/worker.js', ui: './dist/ui' },
  ui: {
    slots: [
      { type: 'appShellOverlay', id: 'voice-global', displayName: 'Voice mode', exportName: 'VoiceOverlay' },
    ],
  },
};

export default manifest;
