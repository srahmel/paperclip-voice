import test from 'node:test';
import assert from 'node:assert/strict';
import { createRealtimeCall, realtimeConfig } from '../src/lib/openai-realtime.mjs';
import { createNativeVoiceTask } from '../src/lib/paperclip-client.mjs';
import { approvedTaskWriter, readTaskProposal, taskApproval } from '../src/lib/realtime-task.mjs';
import { parseConfig, realtimeAgentTarget } from '../src/lib/voice-utils.mjs';
import { startRealtimeConversation } from '../src/ui/realtime-conversation.ts';

const args = { title: 'Review overdue quotes', description: 'List overdue quotes by Friday.' };

test('Realtime uses only the configured region and requests a conversational audio session in each language', async () => {
  for (const [language, label] of [['de', 'Deutsch'], ['en', 'English'], ['nl', 'Nederlands'], ['no', 'Norsk (bokmål)']]) {
    const reply = await createRealtimeCall({
      offer: 'v=0\r\n', region: 'eu', voice: 'cedar', apiKey: 'synthetic-test-value', language,
      doFetch: async (url, request) => {
        assert.equal(url, 'https://eu.api.openai.com/v1/realtime/calls');
        assert.equal(request.redirect, 'error');
        assert.equal(request.body.get('sdp'), 'v=0\r\n');
        const config = JSON.parse(request.body.get('session'));
        assert.ok(config.instructions.startsWith(`Start in ${label}.`));
        assert.equal(config.tracing, null);
        assert.equal(config.audio.input.turn_detection.interrupt_response, true);
        assert.equal(config.audio.input.turn_detection.create_response, false);
        assert.equal(config.audio.input.transcription, null);
        assert.equal(config.audio.output.voice, 'cedar');
        assert.equal(config.tools[0].name, 'propose_tasks');
        return new Response('v=0\r\n', { status: 201, headers: { Location: '/v1/realtime/calls/rtc_example' } });
      },
    });
    assert.deepEqual(reply, { callId: 'rtc_example', answer: 'v=0\r\n' });
  }
});

test('Realtime explains authentication, region and usage failures without exposing provider response bodies', async () => {
  for (const [status, expected] of [[401, /API-Schlüssel.*abgelehnt/], [403, /ausgewählten Region/], [429, /Nutzungslimit/]]) {
    await assert.rejects(createRealtimeCall({
      offer: 'v=0\r\n', region: 'eu', voice: 'marin', apiKey: 'synthetic-key', language: 'de',
      doFetch: async () => new Response('private diagnostic payload', { status }),
    }), error => expected.test(error.message) && !error.message.includes('private diagnostic payload'));
  }
});

test('existing plugin and dictation settings stay local unless the general provider is switched', () => {
  assert.equal(parseConfig({}).generalVoiceBackend, 'local');
  const config = parseConfig({ backend: 'voicebox', generalVoiceBackend: 'openai', language: 'nl' });
  assert.equal(config.backend, 'voicebox');
  assert.equal(config.language, 'nl');
  assert.throws(() => parseConfig({ realtimeRegion: 'https://example.test' }), /processing region/);
});

test('OpenAI receives the Paperclip workspace tools only for explicitly enabled configurations', () => {
  const local = realtimeConfig({ language: 'de', voice: 'marin' });
  assert.deepEqual(local.tools.map(tool => tool.name), ['propose_tasks']);
  const workspace = realtimeConfig({ language: 'de', voice: 'marin', workspaceAccess: true });
  assert.deepEqual(workspace.tools.map(tool => tool.name), ['propose_tasks', 'paperclip_read', 'paperclip_propose_change', 'paperclip_open']);
});

test('opening general Voice from a task restores the remembered agent for the current company', () => {
  const storage = new Map([['paperclip-voice:last-agent:company', 'selected-agent']]);
  const scopedStorage = { getItem: key => storage.get(key) };
  assert.deepEqual(realtimeAgentTarget('/COM/issues/COM-42', 'company', scopedStorage), { kind: 'chat', ref: 'selected-agent' });
  assert.equal(realtimeAgentTarget('/COM/issues/COM-42', 'other', scopedStorage), null);
});

test('task writes use the chosen agent and a stable Paperclip idempotency key', async () => {
  const result = await createNativeVoiceTask({
    ...args, companyId: 'test-company', agentId: 'selected-agent', idempotencyKey: 'voice:session:call',
    doFetch: async (url, request) => {
      assert.equal(url, '/api/companies/test-company/issues');
      assert.equal(request.credentials, 'include');
      assert.deepEqual(JSON.parse(request.body), {
        ...args, assigneeAgentId: 'selected-agent', status: 'todo', idempotencyKey: 'voice:session:call',
      });
      return Response.json({ id: 'issue', identifier: 'TEST-7', companyId: 'test-company', assigneeAgentId: 'selected-agent' });
    },
  });
  assert.deepEqual(result, { status: 'created', identifier: 'TEST-7' });
});

test('duplicates, unknown outcomes, and malformed tool arguments cannot trigger repeat task writes', async () => {
  let writes = 0;
  const handle = approvedTaskWriter({ companyId: 'test-company', agentId: 'agent', saveTask: async () => {
    writes++;
    throw new Error('Connection lost');
  } });
  assert.deepEqual(readTaskProposal('[]'), []);
  assert.equal(readTaskProposal(JSON.stringify({ tasks: [args, args] })).length, 1);
  assert.equal(writes, 0);
  const first = handle('session', 'call-1', [args]);
  const duplicate = handle('session', 'call-2', [{ ...args, title: 'REVIEW  OVERDUE QUOTES' }]);
  assert.deepEqual(await first, { identifiers: [], unknownCount: 1 });
  assert.deepEqual(await duplicate, { identifiers: [], unknownCount: 1 });
  assert.equal(writes, 1);
});

test('spoken task approval recognizes clear answers without accepting qualified changes', () => {
  for (const [language, yes, no] of [['de', 'Ja, mach das bitte.', 'Nein.'], ['en', 'Yes, go ahead.', 'No thanks.'], ['nl', 'Ja, doe maar.', 'Nee.'], ['no', 'Ja, gjør det.', 'Nei.']]) {
    assert.equal(taskApproval(yes, language), 'approve');
    assert.equal(taskApproval(no, language), 'discard');
  }
  assert.equal(taskApproval('Ja, aber erst nächsten Monat.', 'de'), 'unclear');
});

test('conversation proceeds immediately and a batch writes only after an audible question and matching spoken approval', async t => {
  const channel = { readyState: 'open', send: value => messages.push(JSON.parse(value)), close() {} };
  const messages = [];
  const writes = [];
  const reads = [];
  const receipts = [];
  const stops = [];
  const track = { enabled: false, addEventListener() {}, stop() { stops.push('track'); } };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const events = { open: [] };
  t.mock.method(globalThis, 'fetch', async (url, request) => {
    if (request.method === 'GET') {
      reads.push(url);
      const issue = { id: 'issue-1', identifier: 'TEST-1', companyId: 'company', title: 'Review the report', status: 'todo', privateMetadata: 'test payload excluded by projection' };
      return Response.json(url.includes('?') ? [issue] : issue);
    }
    writes.push({ url, body: JSON.parse(request.body) });
    return Response.json({ id: `issue-${writes.length}`, identifier: `TEST-${writes.length}`, companyId: 'company', assigneeAgentId: 'agent' });
  });
  const original = new Map();
  for (const [name, value] of Object.entries({
    navigator: { mediaDevices: { getUserMedia: async () => stream } },
    Audio: class { setAttribute() {} pause() {} },
    RTCPeerConnection: class {
      createDataChannel() { return channel; }
      addTrack() {}
      async createOffer() { return { sdp: 'v=0\r\n' }; }
      async setLocalDescription() {}
      async setRemoteDescription() { channel.onopen(); }
      close() { stops.push('peer'); }
    },
  })) {
    original.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value, configurable: true });
  }
  t.after(() => {
    for (const [name, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });

  const conversation = startRealtimeConversation({
    companyId: 'company', agentId: 'agent', language: 'en', workspaceAccess: true,
    connect: async payload => { events.open.push(payload); return { answer: 'v=0\r\n', sessionId: 'session' }; },
    disconnect: async payload => { stops.push(payload.sessionId); },
    onPhase() {}, onMicLevel() {}, onReply() {}, onTasks: ids => receipts.push(...ids),
    onError: assert.fail, onPlaybackBlocked() {}, waitCue: async () => {},
  });
  t.after(conversation.stop);
  const event = value => channel.onmessage({ data: JSON.stringify(value) });
  const turn = () => new Promise(resolve => setImmediate(resolve));
  await turn();
  assert.deepEqual(events.open, [{ companyId: 'company', language: 'en', offer: 'v=0\r\n' }]);
  assert.equal(track.enabled, true);

  const userTurn = itemId => {
    event({ type: 'input_audio_buffer.speech_started', item_id: itemId });
    event({ type: 'input_audio_buffer.speech_stopped', item_id: itemId });
    event({ type: 'input_audio_buffer.committed', item_id: itemId });
  };
  const transcript = (itemId, text) => event({ type: 'conversation.item.input_audio_transcription.completed', item_id: itemId, transcript: text });
  const tasks = [args, { title: 'Summarize quotes', description: 'Give the results to Klara.' }];
  const call = id => ({ type: 'function_call', name: 'propose_tasks', call_id: id, arguments: JSON.stringify({ tasks }) });
  const done = output => event({ type: 'response.done', response: { status: 'completed', output } });
  const playQuestion = id => {
    const questionId = `confirmation_${id}`;
    event({ type: 'response.created', response: { id: questionId, metadata: { proposalId: id } } });
    event({ type: 'output_audio_buffer.started', response_id: questionId });
    done([]);
    event({ type: 'output_audio_buffer.stopped', response_id: questionId });
  };

  userTurn('question');
  assert.equal(messages.at(-1).type, 'response.create');
  assert.deepEqual(messages.at(-1).response, {});
  done([{ type: 'function_call', name: 'paperclip_read', call_id: 'read_open', arguments: JSON.stringify({ resource: 'tasks' }) }]);
  await turn();
  assert.match(reads[0], /^\/api\/companies\/company\/issues\?/);
  const overview = JSON.parse(messages.findLast(message => message.type === 'conversation.item.create').item.output);
  assert.equal(overview.items[0].identifier, 'TEST-1');
  assert.equal(overview.items[0].privateMetadata, undefined);
  assert.deepEqual(overview.counts, { todo: 1 });
  assert.equal(writes.length, 0);
  done([]);
  event({ type: 'response.done', response: { status: 'cancelled', output: [call('cancelled')] } });
  done([call('decline')]);
  await turn();
  assert.match(messages.at(-1).response.instructions, /Shall I create those 2 tasks/);
  assert.deepEqual(JSON.parse(messages.findLast(message => message.type === 'conversation.item.create').item.output), { status: 'awaiting_approval', count: 2 });
  assert.equal(messages.at(-2).session.audio.input.transcription.model, 'gpt-4o-mini-transcribe');
  transcript('question', 'Yes.');
  playQuestion('decline');
  userTurn('no');
  transcript('no', 'No.');
  assert.match(messages.at(-1).response.instructions, /won’t create anything/);
  assert.equal(messages.at(-2).session.audio.input.transcription, null);
  done([]);

  done([call('agree')]);
  await turn();
  playQuestion('agree');
  userTurn('approval');
  transcript('question', 'Yes.');
  await turn();
  assert.equal(writes.length, 0);

  transcript('approval', 'Yes, go ahead.');
  await turn();
  assert.equal(writes.length, 2);
  assert.deepEqual(writes.map(write => write.body.idempotencyKey), ['voice:session:agree:0', 'voice:session:agree:1']);
  assert.deepEqual(receipts, ['TEST-1', 'TEST-2']);
  assert.match(messages.at(-1).response.instructions, /Tasks TEST-1, TEST-2 were created/);
  transcript('approval', 'Yes.');
  await turn();
  assert.equal(writes.length, 2);
  done([]);
  userTurn('request_change');
  done([{ type: 'function_call', name: 'paperclip_propose_change', call_id: 'change', arguments: JSON.stringify({ action: 'update_task', reference: 'TEST-1', status: 'done' }) }]);
  await turn();
  assert.match(messages.at(-1).response.instructions, /Update task.*TEST-1, done/);
  assert.equal(writes.length, 2);
  playQuestion('change');
  userTurn('approve_change');
  transcript('approve_change', 'Yes.');
  await turn();
  assert.deepEqual(writes[2], { url: '/api/issues/issue-1', body: { status: 'done' } });
  assert.match(messages.at(-1).response.instructions, /Paperclip confirmed the change/);
  conversation.stop();
  assert.deepEqual(stops, ['track', 'peer', 'session']);
});
