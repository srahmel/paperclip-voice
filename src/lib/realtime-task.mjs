import { createNativeVoiceTask } from './paperclip-client.mjs';

export function realtimeTaskHandler({ companyId, agentId, saveTask = createNativeVoiceTask }) {
  const tasks = new Map();
  let saving = false;
  return (sessionId, callId, rawArguments) => {
    let fields;
    try { fields = JSON.parse(rawArguments); }
    catch { return { status: 'invalid_details' }; }
    if (typeof fields?.title !== 'string' || typeof fields.description !== 'string') return { status: 'invalid_details' };
    const title = fields.title.trim();
    const description = fields.description.trim();
    if (!title || title.length > 240 || !description || description.length > 5000 || !/^[a-zA-Z0-9_-]{1,160}$/.test(callId)) {
      return { status: 'invalid_details' };
    }
    const key = title.normalize('NFKC').replace(/\s+/g, ' ').toLowerCase();
    const previous = tasks.get(key);
    if (previous) return previous;
    if (saving) return { status: 'busy' };
    saving = true;
    // Keep even an unconfirmed outcome: a server may have committed before a network error.
    const result = Promise.resolve().then(() => saveTask({
      companyId, agentId, title, description, idempotencyKey: `voice:${sessionId}:${callId}`,
    })).catch(() => ({ status: 'unknown' })).finally(() => { saving = false; });
    tasks.set(key, result);
    return result;
  };
}
