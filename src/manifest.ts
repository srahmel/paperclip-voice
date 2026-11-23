import type { PaperclipPluginManifestV1 } from '@paperclipai/plugin-sdk';

const manifest: PaperclipPluginManifestV1 = {
  id: 'paperclip-plugin-voice',
  apiVersion: 1,
  version: '0.3.0',
  displayName: 'Paperclip Voice (Local)',
  description: 'Talk with existing Paperclip agents using local Whisper, Piper and optional German streaming speech recognition.',
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
      backend: { type: 'string', title: 'Local audio engine', enum: ['python', 'voicebox'], default: 'python' },
      windowsSystemRoot: { type: 'string', title: 'Windows system directory', description: 'SystemRoot for the local Python processes on Windows.' },
      sttPython: { type: 'string', title: 'Whisper Python executable', description: 'Leave empty to use the existing PAPERCLIP_VOICE_PYTHON setting.' },
      sttModelDir: { type: 'string', title: 'Whisper model directory', description: 'Leave empty to use PAPERCLIP_VOICE_MODEL.' },
      moonshinePython: { type: 'string', title: 'Moonshine Python executable', description: 'Optional local runtime for German hands-free mode.' },
      moonshineModelDir: { type: 'string', title: 'Moonshine model directory', description: 'Local German Small Streaming model files.' },
      ttsPython: { type: 'string', title: 'Piper Python executable', description: 'Leave empty to use PAPERCLIP_TTS_PYTHON.' },
      ttsModelDir: { type: 'string', title: 'Piper model directory', description: 'Leave empty to use PAPERCLIP_TTS_MODEL_DIR.' },
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
      { type: 'globalToolbarButton', id: 'voice-open', displayName: 'Sprachmodus', exportName: 'VoiceOpenButton' },
      { type: 'appShellOverlay', id: 'voice-global', displayName: 'Voice mode', exportName: 'VoiceOverlay' },
      { type: 'toolbarButton', id: 'voice-task', displayName: 'Sprachmodus', exportName: 'TaskVoiceButton', entityTypes: ['issue'] },
    ],
  },
};

export default manifest;
