import { VOICE_LANGUAGES } from './voice-utils.mjs';

const OPENAI_ORIGINS = { eu: 'https://eu.api.openai.com', global: 'https://api.openai.com' };
export const REALTIME_SESSION_MS = 10 * 60_000;

export function realtimeConfig({ language, voice }) {
  return {
    type: 'realtime', model: 'gpt-realtime-2.1-mini', output_modalities: ['audio'],
    tracing: null,
    instructions: [
      `Start in ${VOICE_LANGUAGES[language]}. Use the user's language if they switch.`,
      'You are Paperclip Voice. Respond to the user naturally and promptly. Answer questions and discuss options conversationally. Do not repeat the user’s words or ask for routine confirmation.',
      'Treat brainstorming, suggestions, hypotheticals and questions as conversation. Call create_task only after the user has expressed a clear intention to have a Paperclip task created and the desired work is clear. An unambiguous request with enough detail is sufficient. If the intention or a material detail is unclear, ask a short question.',
      'The selected Paperclip agent will receive the task. Never imply you are that agent or that you have read their chats or tasks. If the user wants a different assignee, ask them to select that agent in the panel before saving.',
      'When saving a task, do not announce success until the tool returns created. State the returned identifier. If the tool reports an unknown outcome, say it could not be confirmed and do not try to create it again.',
      'Use only information the user has given or verified tool results. Do not invent deadlines, task status, or external actions.',
    ].join('\n'),
    audio: {
      input: {
        noise_reduction: { type: 'near_field' },
        turn_detection: { type: 'semantic_vad', eagerness: 'high', create_response: true, interrupt_response: true },
      },
      output: { voice },
    },
    tools: [{
      type: 'function', name: 'create_task',
      description: 'Create one task assigned to the selected agent when the user clearly intends it and the work is clear.',
      parameters: {
        type: 'object', additionalProperties: false, required: ['title', 'description'],
        properties: {
          title: { type: 'string', description: 'Short title for the agreed task.' },
          description: { type: 'string', description: 'Agreed work and relevant details, in the user’s language.' },
        },
      },
    }],
  };
}

export async function createRealtimeCall({ offer, region, language, voice, apiKey, doFetch = fetch }) {
  if (typeof offer !== 'string' || offer.length > 32_000 || !/^v=0\r?\n/.test(offer)) throw new Error('Invalid Realtime audio offer');
  const form = new FormData();
  form.set('sdp', offer);
  form.set('session', JSON.stringify(realtimeConfig({ language, voice })));
  let response;
  try {
    response = await doFetch(`${OPENAI_ORIGINS[region]}/v1/realtime/calls`, {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form,
      redirect: 'error', signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error('OpenAI Realtime ist nicht erreichbar. Bitte Verbindung und Region prüfen.');
  }
  if (!response.ok) throw new Error(`OpenAI Realtime hat die Verbindung abgelehnt (HTTP ${response.status}). Bitte API-Projekt, Region und Abrechnung prüfen.`);
  const callId = response.headers.get('Location')?.match(/\/realtime\/calls\/([a-zA-Z0-9_-]{1,160})\/?$/)?.[1];
  const answer = await response.text();
  if (!callId || !/^v=0\r?\n/.test(answer)) throw new Error('OpenAI Realtime hat keine gültige Audioverbindung zurückgegeben.');
  return { callId, answer };
}

export async function hangupRealtimeCall({ callId, region, apiKey }) {
  await fetch(`${OPENAI_ORIGINS[region]}/v1/realtime/calls/${encodeURIComponent(callId)}/hangup`, {
    method: 'POST', headers: { Authorization: `Bearer ${apiKey}` },
    redirect: 'error', signal: AbortSignal.timeout(5_000),
  });
}
