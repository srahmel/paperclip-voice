import type { PaperclipPluginManifestV1 } from '@paperclipai/plugin-sdk';
import { DEFAULT_VOICE_PRESET, GERMAN_VOICE_PRESETS, OTHER_VOICE_PRESETS, VOICE_LANGUAGES } from './lib/voice-utils.mjs';

const manifest: PaperclipPluginManifestV1 = {
  id: 'paperclip-plugin-voice',
  apiVersion: 1,
  version: '0.5.0',
  displayName: 'Paperclip Voice (Local)',
  description: 'Have a live voice conversation with OpenAI Realtime or dictate locally into Paperclip tasks.',
  author: 'paperclip-voice contributors',
  categories: ['ui'],
  capabilities: [
    'issues.read',
    'issue.comments.read',
    'http.outbound',
    'secrets.read-ref',
    'ui.action.register',
  ],
  entrypoints: { worker: './dist/worker.js', ui: './dist/ui' },
  instanceConfigSchema: {
    type: 'object',
    properties: {
      generalVoiceBackend: {
        type: 'string', title: 'General voice mode', enum: ['local', 'openai'], default: 'local',
        description: 'OpenAI handles the live conversation. Task dictation continues to use the local audio engine.',
      },
      realtimeApiKey: {
        format: 'secret-ref', title: 'OpenAI Realtime API key',
        description: 'Use Create secret or select an existing organization secret. This setting accepts the secret reference.',
        anyOf: [
          {
            type: 'object', required: ['type', 'secretId'], additionalProperties: false,
            properties: {
              type: { const: 'secret_ref' },
              secretId: { type: 'string', format: 'uuid' },
              version: { anyOf: [{ const: 'latest' }, { type: 'integer', minimum: 1 }] },
            },
          },
          { const: '' },
        ],
      },
      realtimeRegion: {
        type: 'string', title: 'OpenAI processing region', enum: ['eu', 'global'], default: 'eu',
        description: 'EU requires a compatible OpenAI project. The plugin uses the selected region only.',
      },
      realtimeVoice: { type: 'string', title: 'OpenAI Realtime voice', enum: ['marin', 'cedar', 'coral', 'verse'], default: 'marin' },
      workspaceAccess: {
        type: 'boolean', title: 'Paperclip workspace access in Voice', default: false,
        description: 'Allow OpenAI Realtime to receive the Paperclip results needed to answer your requests. Voice uses the signed-in user’s permissions and asks before making changes.',
      },
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
      language: {
        type: 'string', title: 'Default language', enum: Object.keys(VOICE_LANGUAGES), default: 'de',
        description: 'de = German, en = English, nl = Dutch, no = Norwegian Bokmål.',
      },
      voicePreset: { type: 'string', title: 'German voice', enum: Object.keys(GERMAN_VOICE_PRESETS), default: DEFAULT_VOICE_PRESET },
      ...Object.fromEntries(Object.values(OTHER_VOICE_PRESETS).map(preset => [preset.setting, {
        type: 'string', title: preset.title, enum: Object.keys(preset.voices), default: preset.default,
      }])),
      voice: { type: 'string', title: 'Saved German Piper voice ID', description: 'Used when the German voice dropdown is set to Use saved voice ID.', default: 'de_DE-thorsten-medium' },
      maxSpokenChars: { type: 'integer', title: 'Maximum spoken characters', minimum: 120, maximum: 1000, default: 380 },
      speechRate: { type: 'number', title: 'Playback speed', minimum: 0.7, maximum: 1.5, default: 1 },
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
