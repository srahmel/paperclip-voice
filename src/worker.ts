import { localAudioReady, synthesizeWithPython, transcribeWithPython } from './lib/local-python.mjs';
import { LocalSpeechStream, localStreamReady, MAX_STREAM_CHUNK_BYTES } from './lib/local-stream.mjs';
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
  controller: AbortController;
  settled: Promise<void>;
};

const jobs = new Map<string, AudioJob>();
const JOB_TTL_MS = 10 * 60_000;
const MAX_ACTIVE_JOBS = 4;
const STREAM_IDLE_MS = 90_000;
type VoiceStream = { companyId: string; ownerId: string; process: LocalSpeechStream; expiry?: ReturnType<typeof setTimeout> };
const streams = new Map<string, VoiceStream>();
const STATUS_MESSAGES: Record<string, Record<string, string>> = {
  de: {
    submitted: 'Gesendet.',
    waiting: 'Moment, ich schaue nach.',
    no_speech: 'Ich habe nichts verstanden.',
  },
  en: {
    submitted: 'Sent.',
    waiting: 'One moment, I am checking.',
    no_speech: 'I did not understand.',
  },
};

function refreshStreamExpiry(stream: VoiceStream) {
  clearTimeout(stream.expiry);
  stream.expiry = setTimeout(() => stream.process.close(), STREAM_IDLE_MS);
  stream.expiry.unref();
}

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
  for (const [id, job] of jobs) if (job.expiresAt <= now) {
    job.controller.abort();
    // Keep pending work counted against capacity until its process has exited.
    void job.settled.then(() => { if (jobs.get(id) === job) jobs.delete(id); });
  }
}

function startJob(companyId: string, ownerId: string, work: (signal: AbortSignal) => Promise<unknown>): { jobId: string } {
  pruneJobs();
  const active = [...jobs.values()].filter((job) => job.state === 'pending');
  if (active.length >= MAX_ACTIVE_JOBS || active.filter((job) => job.companyId === companyId && job.ownerId === ownerId).length >= 2) {
    throw new Error('Voice processor is busy; try again shortly');
  }
  if (jobs.size >= 16) {
    const completed = [...jobs].find(([, job]) => job.state !== 'pending');
    if (completed) jobs.delete(completed[0]); else throw new Error('Voice processor is busy');
  }
  const jobId = randomUUID();
  const job: AudioJob = { companyId, ownerId, state: 'pending', expiresAt: Date.now() + JOB_TTL_MS, controller: new AbortController(), settled: Promise.resolve() };
  jobs.set(jobId, job);
  // Never await inference in a Paperclip bridge action: the worker RPC defaults to 30 seconds.
  job.settled = Promise.resolve().then(() => work(job.controller.signal)).then(
    (result) => { if (jobs.get(jobId) === job) { job.state = 'ready'; job.result = result; } },
    () => { if (jobs.get(jobId) === job) { job.state = 'error'; job.error = 'Local audio processing failed; check the Voice plugin configuration'; } },
  );
  return { jobId };
}

const plugin = definePlugin({
  multiCompanyConfig: true,
  async setup(ctx) {
    const configFor = async (companyId: string) => parseConfig(await ctx.config.get(companyId));

    const transcribeAudio = (config: ReturnType<typeof parseConfig>, request: { language: string; audioBase64: string; mimeType: string; signal: AbortSignal; timeoutMs: number }) =>
      config.backend === 'python' ? transcribeWithPython({ config, ...request }) : transcribeWithVoicebox({ baseUrl: config.voiceboxUrl, ...request });
    const synthesizeAudio = (config: ReturnType<typeof parseConfig>, request: { language: string; voice: string; speechRate: number; text: string; signal: AbortSignal; timeoutMs: number }) =>
      config.backend === 'python' ? synthesizeWithPython({ config, ...request }) : synthesizeWithVoicebox({ baseUrl: config.voiceboxUrl, ...request });

    ctx.data.register('voice-health', async (params) => {
      const companyId = requiredString(params, 'companyId');
      const config = await configFor(companyId);
      try {
        const ready = config.backend === 'python' ? localAudioReady(config) : await voiceboxHealth({ baseUrl: config.voiceboxUrl });
        return { ready, streamingReady: ready && localStreamReady(config) };
      }
      catch { return { ready: false }; }
    });

    ctx.actions.register('voice-stream-start', async (params, auth) => {
      const scope = requireScope(params, auth);
      const config = await configFor(scope.companyId);
      if (!localStreamReady(config)) throw new Error('Local streaming speech recognition is not configured');
      if (streams.size >= MAX_ACTIVE_JOBS || [...streams.values()].some(stream => stream.companyId === scope.companyId && stream.ownerId === scope.ownerId)) {
        throw new Error('Another hands-free session is already active');
      }
      const streamId = randomUUID();
      const process = new LocalSpeechStream(config, { onClose: () => {
        clearTimeout(stream.expiry);
        streams.delete(streamId);
      } });
      const stream: VoiceStream = { ...scope, process };
      streams.set(streamId, stream);
      refreshStreamExpiry(stream);
      const ready = await process.request({ command: 'ready' }, 20_000);
      if (ready?.ready !== true) { process.close(); throw new Error('Local streaming speech recognition could not start'); }
      return { streamId };
    });

    ctx.actions.register('voice-stream-update', async (params, auth) => {
      const { companyId, ownerId } = requireScope(params, auth);
      const stream = streams.get(requiredString(params, 'streamId'));
      if (!stream || stream.companyId !== companyId || stream.ownerId !== ownerId) throw new Error('Voice stream not found');
      if (params.command === 'stop') {
        stream.process.close();
        await stream.process.done;
        return { stopped: true };
      }
      if (stream.process.closed) throw new Error('Voice stream is closed');
      if (params.command === 'keepalive') {
        refreshStreamExpiry(stream);
        return { ready: true };
      }
      if (params.command === 'finish') {
        refreshStreamExpiry(stream);
        return stream.process.request({ command: 'finish' });
      }
      if (params.command !== 'audio') throw new Error('Unknown voice stream command');
      const audio = requiredString(params, 'audioBase64');
      if (audio.length > Math.ceil(MAX_STREAM_CHUNK_BYTES / 3) * 4 || decodeBase64Audio(audio).length > MAX_STREAM_CHUNK_BYTES) throw new Error('Voice stream audio chunk is too large');
      refreshStreamExpiry(stream);
      return stream.process.request({ command: 'audio', audio });
    });

    ctx.actions.register('voice-transcribe', async (params, auth) => {
      const { companyId, ownerId } = requireScope(params, auth);
      const config = await configFor(companyId);
      const audioBase64 = requiredString(params, 'audioBase64');
      const mimeType = requiredString(params, 'mimeType');
      decodeBase64Audio(audioBase64); // Reject oversized audio before queueing work.
      const language = allowedLanguage(params.language, config.language);
      return startJob(companyId, ownerId, async signal => ({
        text: await transcribeAudio(config, {
          language, audioBase64, mimeType, timeoutMs: 120_000, signal,
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
      if (!selected || !isAgentComment(selected)) throw new Error('Comment is not an agent response');
      const { text, truncated } = spokenComment(selected.body, config.maxSpokenChars);
      if (!text) return startJob(companyId, ownerId, async () => ({ audioBase64: '', mime: 'audio/wav', bytes: 0, truncated }));
      const language = allowedLanguage(params.language, config.language);
      const voice = language === 'en' ? 'en_US-lessac-medium' : config.voice;
      return startJob(companyId, ownerId, async signal => ({
        ...await synthesizeAudio(config, {
          language, voice, speechRate: config.speechRate, text, timeoutMs: 120_000, signal,
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
      return startJob(companyId, ownerId, signal => synthesizeAudio(config, {
        language, voice, speechRate: config.speechRate, text, timeoutMs: 120_000, signal,
      }));
    });

    ctx.actions.register('voice-cancel', async (params, auth) => {
      const { companyId, ownerId } = requireScope(params, auth);
      const jobId = requiredString(params, 'jobId');
      const job = jobs.get(jobId);
      if (!job || job.companyId !== companyId || job.ownerId !== ownerId) throw new Error('Voice job not found');
      job.controller.abort();
      await job.settled;
      jobs.delete(jobId);
      return { cancelled: true };
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
  async onShutdown() {
    const activeStreams = [...streams.values()];
    for (const stream of activeStreams) stream.process.close();
    const pending = [...jobs.values()];
    for (const job of pending) job.controller.abort();
    await Promise.all([...pending.map(job => job.settled), ...activeStreams.map(stream => stream.process.done)]);
    jobs.clear();
  },
  async onHealth() { return { status: 'ok' }; },
});

export default plugin;
runWorker(plugin, import.meta.url);
