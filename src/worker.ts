import { randomUUID } from 'node:crypto';
import { definePlugin, runWorker } from '@paperclipai/plugin-sdk';
import { decodeBase64Audio, isAgentComment, parseConfig } from './lib/voice-utils.mjs';
import { spokenComment, synthesizeWithVoicebox, transcribeWithVoicebox, voiceboxHealth } from './lib/voicebox-client.mjs';

type JobState = 'pending' | 'ready' | 'error';
type AudioJob = {
  companyId: string;
  ownerId: string;
  state: JobState;
  result?: unknown;
  error?: string;
  expiresAt: number;
};

const jobs = new Map<string, AudioJob>();
const JOB_TTL_MS = 10 * 60_000;
const MAX_ACTIVE_JOBS = 4;
const STATUS_MESSAGES: Record<string, Record<string, string>> = {
  de: {
    submitted: 'Gesendet.',
    no_speech: 'Ich habe nichts verstanden.',
  },
  en: {
    submitted: 'Sent.',
    no_speech: 'I did not understand.',
  },
};

function requiredString(params: Record<string, unknown>, name: string): string {
  const value = params[name];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing ${name}`);
  return value;
}

function allowedLanguage(input: unknown, fallback: string): string {
  return input === 'de' || input === 'en' ? input : fallback;
}

function requireScope(
  params: Record<string, unknown>,
  auth: { companyId: string | null; actor: { type: string; userId: string | null } },
): { companyId: string; ownerId: string } {
  const companyId = requiredString(params, 'companyId');
  if (!auth || auth.companyId !== companyId || auth.actor.type !== 'user') {
    throw new Error('An authenticated company user is required');
  }
  // local_trusted single-operator instances may have no persisted board user id.
  return { companyId, ownerId: auth.actor.userId ?? 'local-board' };
}

function pruneJobs(): void {
  const now = Date.now();
  for (const [id, job] of jobs) if (job.expiresAt <= now) jobs.delete(id);
}

function startJob(companyId: string, ownerId: string, work: () => Promise<unknown>): { jobId: string } {
  pruneJobs();
  const active = [...jobs.values()].filter((job) => job.state === 'pending');
  if (active.length >= MAX_ACTIVE_JOBS || active.filter((job) => job.companyId === companyId && job.ownerId === ownerId).length >= 2) {
    throw new Error('Voice processor is busy; try again shortly');
  }
  const jobId = randomUUID();
  const job: AudioJob = { companyId, ownerId, state: 'pending', expiresAt: Date.now() + JOB_TTL_MS };
  jobs.set(jobId, job);
  // Never await inference in a Paperclip bridge action: the worker RPC defaults to 30 seconds.
  void Promise.resolve().then(work).then(
    (result) => { if (jobs.get(jobId) === job) { job.state = 'ready'; job.result = result; } },
    () => { if (jobs.get(jobId) === job) { job.state = 'error'; job.error = 'Local audio processing failed; check Voicebox health and configuration'; } },
  );
  return { jobId };
}

const plugin = definePlugin({
  multiCompanyConfig: true,
  async setup(ctx) {
    const configFor = async (companyId: string) => parseConfig(await ctx.config.get(companyId));

    ctx.data.register('voice-health', async (params) => {
      const companyId = requiredString(params, 'companyId');
      const config = await configFor(companyId);
      try { return { ready: await voiceboxHealth({ baseUrl: config.voiceboxUrl }) }; }
      catch { return { ready: false }; }
    });

    ctx.actions.register('voice-transcribe', async (params, auth) => {
      const { companyId, ownerId } = requireScope(params, auth);
      const config = await configFor(companyId);
      const audioBase64 = requiredString(params, 'audioBase64');
      const mimeType = requiredString(params, 'mimeType');
      decodeBase64Audio(audioBase64); // Reject oversized audio before queueing work.
      const language = allowedLanguage(params.language, config.language);
      return startJob(companyId, ownerId, async () => ({
        text: await transcribeWithVoicebox({
          baseUrl: config.voiceboxUrl, language, audioBase64, mimeType, timeoutMs: 120_000,
        }),
      }));
    });

    ctx.actions.register('voice-speak-comment', async (params, auth) => {
      const { companyId, ownerId } = requireScope(params, auth);
      const issueId = requiredString(params, 'issueId');
      const commentId = requiredString(params, 'commentId');
      const config = await configFor(companyId);
      // Read the authoritative source under the active, authenticated invocation.
      const issue = await ctx.issues.get(issueId, companyId);
      if (!issue) throw new Error('Issue not found');
      const comments = await ctx.issues.listComments(issueId, companyId);
      const selected = comments.find((comment) => comment.id === commentId);
      if (!isAgentComment(selected)) throw new Error('Comment is not an agent response');
      const { text, truncated } = spokenComment(selected.body, config.maxSpokenChars);
      if (!text) return startJob(companyId, ownerId, async () => ({ audioBase64: '', mime: 'audio/wav', bytes: 0, truncated }));
      const language = allowedLanguage(params.language, config.language);
      const voice = language === 'en' ? 'en_US-lessac-medium' : config.voice;
      return startJob(companyId, ownerId, async () => ({
        ...await synthesizeWithVoicebox({
          baseUrl: config.voiceboxUrl, voice, speechRate: config.speechRate, text, timeoutMs: 120_000,
        }), truncated,
      }));
    });

    ctx.actions.register('voice-speak-status', async (params, auth) => {
      const { companyId, ownerId } = requireScope(params, auth);
      const config = await configFor(companyId);
      const language = allowedLanguage(params.language, config.language);
      const status = requiredString(params, 'status');
      const text = STATUS_MESSAGES[language]?.[status];
      if (!text) throw new Error('Unknown status message');
      const voice = language === 'en' ? 'en_US-lessac-medium' : config.voice;
      return startJob(companyId, ownerId, () => synthesizeWithVoicebox({
        baseUrl: config.voiceboxUrl, voice, speechRate: config.speechRate, text, timeoutMs: 120_000,
      }));
    });

    ctx.actions.register('voice-poll', async (params, auth) => {
      const { companyId, ownerId } = requireScope(params, auth);
      const jobId = requiredString(params, 'jobId');
      pruneJobs();
      const job = jobs.get(jobId);
      if (!job || job.companyId !== companyId || job.ownerId !== ownerId) throw new Error('Voice job not found');
      return {
        status: job.state,
        ...(job.state === 'ready' ? { result: job.result } : {}),
        ...(job.state === 'error' ? { error: job.error } : {}),
      };
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
