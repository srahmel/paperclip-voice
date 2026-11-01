import type { PaperclipPluginManifestV1 } from '@paperclipai/plugin-sdk';

const manifest: PaperclipPluginManifestV1 = {
  id: 'paperclip-plugin-voice',
  apiVersion: 1,
  version: '0.1.1',
  displayName: 'Paperclip Voice (Local)',
  description: 'Talk with existing Paperclip agents using local Whisper and Piper, without modifying the Paperclip core.',
  author: 'paperclip-voice contributors',
  categories: ['ui'],
  capabilities: [
    'issues.read',
    'issue.comments.read',
    'http.outbound',
    'ui.action.register',
  ],
  entrypoints: { worker: './dist/worker.js', ui: './dist/ui' },
  instanceConfigSchema: {
    type: 'object',
    properties: {
      voiceboxUrl: {
        type: 'string', title: 'Local Voicebox URL',
        description: 'Voicebox must run on the Paperclip server, accessible only on loopback.',
        default: 'http://127.0.0.1:8790',
      },
      language: { type: 'string', title: 'Default language', enum: ['de', 'en'], default: 'de' },
      voice: { type: 'string', title: 'German Piper voice ID', default: 'de_DE-thorsten-medium' },
      maxSpokenChars: { type: 'integer', title: 'Maximum spoken characters', minimum: 120, maximum: 1000, default: 380 },
      speechRate: { type: 'number', title: 'Playback speed', minimum: 0.7, maximum: 1.5, default: 1 },
    },
    additionalProperties: false,
  } as PaperclipPluginManifestV1['instanceConfigSchema'],
  ui: {
    slots: [
      { type: 'appShellOverlay', id: 'voice-global', displayName: 'Voice mode', exportName: 'VoiceOverlay' },
    ],
  },
};

export default manifest;
