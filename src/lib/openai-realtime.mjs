import { VOICE_LANGUAGES } from './voice-utils.mjs';

const OPENAI_ORIGINS = { eu: 'https://eu.api.openai.com', global: 'https://api.openai.com' };
export const REALTIME_SESSION_MS = 10 * 60_000;

export function realtimeConfig({ language, voice }) {
  return {
    type: 'realtime', model: 'gpt-realtime-2.1-mini', output_modalities: ['audio'],
    tracing: null,
    instructions: [
      `Start in ${VOICE_LANGUAGES[language]}. Use the user's language if they switch.`,
      'You are Paperclip Voice. Respond naturally and promptly. Answer questions directly and discuss options with the user. Never play back, quote or paraphrase the user’s message as an acknowledgment. Do not interrupt the discussion to ask whether to send a message.',
      'Treat brainstorming, suggestions, hypotheticals and questions as conversation. Once the discussion establishes intent to hand off one or more concrete tasks, call propose_tasks once with the complete set. If an important detail is missing, ask a focused follow-up question. The app will speak a brief approval question after receiving the proposal.',
      'The selected Paperclip agent will receive the task. Never imply you are that agent or that you have read their chats or tasks. If the user wants a different assignee, ask them to select that agent in the panel before saving.',
      'Proposing tasks does not save them. The app handles approval and reports the Paperclip results. Having discussed a task or having had it proposed never means it was saved.',
      'Use only information the user has given or verified tool results. Do not invent deadlines, task status, or external actions.',
    ].join('\n'),
    audio: {
      input: {
        noise_reduction: { type: 'near_field' },
        transcription: null,
        turn_detection: { type: 'semantic_vad', eagerness: 'high', create_response: false, interrupt_response: true },
      },
      output: { voice },
    },
    tools: [{
      type: 'function', name: 'propose_tasks',
      description: 'Prepare the concrete tasks agreed in the conversation for one spoken approval. Does not save tasks.',
      parameters: {
        type: 'object', additionalProperties: false, required: ['tasks'],
        properties: {
          tasks: {
            type: 'array', minItems: 1, maxItems: 10,
            items: {
              type: 'object', additionalProperties: false, required: ['title', 'description'],
              properties: {
                title: { type: 'string', description: 'Short title for the agreed task.' },
                description: { type: 'string', description: 'Agreed work and relevant details, in the user’s language.' },
              },
            },
          },
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
