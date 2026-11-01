import { definePlugin, runWorker } from '@paperclipai/plugin-sdk';
import {
  decodeBase64Audio,
  isAgentComment,
  parseConfig,
  voiceMessage,
} from './lib/voice-utils.mjs';
import {
  spokenComment,
  synthesizeWithVoicebox,
  transcribeWithVoicebox,
  voiceboxHealth,
} from './lib/voicebox-client.mjs';

function requiredString(params: Record<string, unknown>, name: string): string {
  const value = params[name];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing ${name}`);
  return value;
}

const STATUS_MESSAGES: Record<string, string> = {
  submitted: 'Deine Anweisung wurde in Paperclip übermittelt.',
  waiting: 'Der Agent bearbeitet die Aufgabe. Du kannst den Fortschritt in Paperclip verfolgen.',
  no_speech: 'Ich habe nichts Verständliches gehört. Bitte versuche es erneut.',
};

const plugin = definePlugin({
  multiCompanyConfig: true,
  async setup(ctx) {
    const configFor = async (companyId: string) => parseConfig(await ctx.config.get(companyId));

    ctx.data.register('voice-settings', async (params) => {
      const companyId = requiredString(params, 'companyId');
      const c = await configFor(companyId);
      return { language: c.language, voice: c.voice, maxSpokenChars: c.maxSpokenChars };
    });

    ctx.data.register('voice-health', async (params) => {
      const companyId = requiredString(params, 'companyId');
      const c = await configFor(companyId);
      try {
        return { ready: await voiceboxHealth({ baseUrl: c.voiceboxUrl }) };
      } catch {
        // Never reveal local network details in the UI or log transcripts.
        return { ready: false };
      }
    });

    // Read the same durable comments that the native Paperclip chat renders.
    ctx.data.register('voice-comments', async (params) => {
      const companyId = requiredString(params, 'companyId');
      const issueId = requiredString(params, 'issueId');
      const issue = await ctx.issues.get(issueId, companyId);
      if (!issue) throw new Error('Issue does not exist or is inaccessible');
      const comments = await ctx.issues.listComments(issueId, companyId);
      return { comments: comments.slice(-100).map((c) => ({
        id: c.id,
        agent: isAgentComment(c),
        createdAt: c.createdAt,
      })) };
    });

    // Compressed MediaRecorder audio is transported as bounded base64 JSON via
    // the authenticated Paperclip plugin bridge, never through a public STT API.
    ctx.actions.register('voice-transcribe', async (params) => {
      const companyId = requiredString(params, 'companyId');
      const c = await configFor(companyId);
      const audioBase64 = requiredString(params, 'audioBase64');
      const mimeType = requiredString(params, 'mimeType');
      decodeBase64Audio(audioBase64); // reject before making a network request
      const text = await transcribeWithVoicebox({
        baseUrl: c.voiceboxUrl, language: c.language, audioBase64, mimeType,
      });
      return { text };
    });

    // Server-side source verification prevents speaking an arbitrary private
    // message supplied by a browser that lacks access to that issue.
    ctx.actions.register('voice-speak-comment', async (params) => {
      const companyId = requiredString(params, 'companyId');
      const issueId = requiredString(params, 'issueId');
      const commentId = requiredString(params, 'commentId');
      const c = await configFor(companyId);
      const issue = await ctx.issues.get(issueId, companyId);
      if (!issue) throw new Error('Issue not found');
      const comments = await ctx.issues.listComments(issueId, companyId);
      const selected = comments.find((comment) => comment.id === commentId);
      if (!isAgentComment(selected)) throw new Error('Comment is not an agent response');
      const { text, truncated } = spokenComment(selected!.body, c.maxSpokenChars);
      if (!text) return { audioBase64: '', mime: 'audio/wav', bytes: 0, truncated };
      const audio = await synthesizeWithVoicebox({
        baseUrl: c.voiceboxUrl, voice: c.voice, speechRate: c.speechRate, text,
      });
      return { ...audio, truncated };
    });

    ctx.actions.register('voice-speak-status', async (params) => {
      const companyId = requiredString(params, 'companyId');
      const status = requiredString(params, 'status');
      const c = await configFor(companyId);
      const text = Object.hasOwn(STATUS_MESSAGES, status) ? STATUS_MESSAGES[status] : null;
      if (!text) throw new Error('Unknown status message');
      return synthesizeWithVoicebox({ baseUrl: c.voiceboxUrl, voice: c.voice, speechRate: c.speechRate, text });
    });
  },
  async onValidateConfig(raw) {
    try { parseConfig(raw); return { ok: true, errors: [], warnings: [] }; }
    catch (error) { return { ok: false, errors: [error instanceof Error ? error.message : String(error)], warnings: [] }; }
  },
  async onHealth() { return { status: 'ok' }; },
});

export default plugin;
runWorker(plugin, import.meta.url);
