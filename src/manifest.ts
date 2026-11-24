import type { PaperclipPluginManifestV1 } from '@paperclipai/plugin-sdk';
import { DEFAULT_VOICE_PRESET, GERMAN_VOICE_PRESETS, OTHER_VOICE_PRESETS, VOICE_LANGUAGES } from './lib/voice-utils.mjs';

const advanced = { 'x-paperclip-advanced': true };

const manifest: PaperclipPluginManifestV1 = {
  id: 'paperclip-plugin-voice',
  apiVersion: 1,
  version: '0.3.6',
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
      backend: { ...advanced, type: 'string', title: 'Local audio engine', enum: ['python', 'voicebox'], default: 'python' },
      windowsSystemRoot: { ...advanced, type: 'string', title: 'Windows system directory', description: 'SystemRoot for the local Python processes on Windows.' },
      sttPython: { ...advanced, type: 'string', title: 'Whisper Python executable', description: 'Leave empty to use the existing PAPERCLIP_VOICE_PYTHON setting.' },
      sttModelDir: { ...advanced, type: 'string', title: 'Whisper model directory', description: 'Leave empty to use PAPERCLIP_VOICE_MODEL.' },
      moonshinePython: { ...advanced, type: 'string', title: 'Moonshine Python executable', description: 'Optional local runtime for German hands-free mode.' },
      moonshineModelDir: { ...advanced, type: 'string', title: 'Moonshine model directory', description: 'Local German Small Streaming model files.' },
      ttsPython: { ...advanced, type: 'string', title: 'Piper Python executable', description: 'Leave empty to use PAPERCLIP_TTS_PYTHON.' },
      ttsModelDir: { ...advanced, type: 'string', title: 'Piper model directory', description: 'Leave empty to use PAPERCLIP_TTS_MODEL_DIR.' },
      voiceboxUrl: {
        ...advanced, type: 'string', title: 'Local Voicebox URL',
        description: 'Voicebox must run on the Paperclip server, accessible only on loopback.',
        default: 'http://127.0.0.1:8790',
      },
      language: {
        type: 'string', title: 'Default language', enum: Object.keys(VOICE_LANGUAGES), default: 'de',
        description: 'de = German, en = English, nl = Dutch, no = Norwegian Bokmål.',
      },
      voicePreset: { type: 'string', title: 'German voice', enum: Object.keys(GERMAN_VOICE_PRESETS), default: DEFAULT_VOICE_PRESET },
      ...Object.fromEntries(Object.values(OTHER_VOICE_PRESETS).map(preset => [preset.setting, {
        type: 'string', title: preset.title, enum: Object.keys(preset.voices), default: preset.default,
      }])),
      voice: { ...advanced, type: 'string', title: 'Saved German Piper voice ID', description: 'Used when the German voice dropdown is set to Use saved voice ID.', default: 'de_DE-thorsten-medium' },
      maxSpokenChars: { ...advanced, type: 'integer', title: 'Maximum spoken characters', minimum: 120, maximum: 1000, default: 380 },
      speechRate: { ...advanced, type: 'number', title: 'Playback speed', minimum: 0.7, maximum: 1.5, default: 1 },
    },
    additionalProperties: false,
  } as PaperclipPluginManifestV1['instanceConfigSchema'],
  ui: {
    slots: [
      { type: 'globalToolbarButton', id: 'voice-open', displayName: 'Voice mode', exportName: 'VoiceOpenButton' },
      { type: 'appShellOverlay', id: 'voice-global', displayName: 'Voice mode', exportName: 'VoiceOverlay' },
      { type: 'toolbarButton', id: 'voice-task', displayName: 'Voice mode', exportName: 'TaskVoiceButton', entityTypes: ['issue'] },
    ],
  },
};

export default manifest;
