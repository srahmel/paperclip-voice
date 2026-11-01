import type { PaperclipPluginManifestV1 } from '@paperclipai/plugin-sdk';

const manifest: PaperclipPluginManifestV1 = {
  id: 'paperclip-plugin-voice',
  apiVersion: 1,
  version: '0.1.0',
  displayName: 'Paperclip Voice (Local)',
  description: 'Speak with existing Paperclip agents and issues using local Whisper STT and Piper TTS.',
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
        description: 'Only localhost/127.0.0.1 URLs are allowed. Voicebox must run on the Paperclip server.',
        default: 'http://127.0.0.1:8790',
      },
      language: { type: 'string', title: 'Transcription language', enum: ['de', 'en'], default: 'de' },
      voice: { type: 'string', title: 'Installed Piper voice ID', default: 'de_DE-thorsten-medium' },
      maxSpokenChars: { type: 'integer', title: 'Max spoken characters per reply', minimum: 120, maximum: 1000, default: 380 },
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
