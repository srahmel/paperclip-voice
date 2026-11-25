import test from 'node:test';
import assert from 'node:assert/strict';
import { createRealtimeCall } from '../src/lib/openai-realtime.mjs';
import { createNativeVoiceTask } from '../src/lib/paperclip-client.mjs';
import { realtimeTaskHandler } from '../src/lib/realtime-task.mjs';
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
        assert.equal(config.audio.output.voice, 'cedar');
        assert.equal(config.tools[0].name, 'create_task');
        return new Response('v=0\r\n', { status: 201, headers: { Location: '/v1/realtime/calls/rtc_example' } });
      },
    });
    assert.deepEqual(reply, { callId: 'rtc_example', answer: 'v=0\r\n' });
  }
});

test('existing plugin and dictation settings stay local unless the general provider is switched', () => {
  assert.equal(parseConfig({}).generalVoiceBackend, 'local');
  const config = parseConfig({ backend: 'voicebox', generalVoiceBackend: 'openai', language: 'nl' });
  assert.equal(config.backend, 'voicebox');
  assert.equal(config.language, 'nl');
  assert.throws(() => parseConfig({ realtimeRegion: 'https://example.test' }), /processing region/);
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
  const handle = realtimeTaskHandler({ companyId: 'test-company', agentId: 'agent', saveTask: async () => {
    writes++;
    throw new Error('Connection lost');
  } });
  assert.deepEqual(handle('session', 'invalid', '[]'), { status: 'invalid_details' });
  assert.equal(writes, 0);
  const first = handle('session', 'call-1', JSON.stringify(args));
  const duplicate = handle('session', 'call-2', JSON.stringify({ ...args, title: '  REVIEW  OVERDUE QUOTES ' }));
  assert.equal(first, duplicate);
  assert.deepEqual(await first, { status: 'unknown' });
  assert.deepEqual(await handle('session', 'call-3', JSON.stringify(args)), { status: 'unknown' });
  assert.equal(writes, 1);
});

test('the live client writes only completed task calls, then returns a Paperclip receipt and releases the microphone', async t => {
  const channel = { readyState: 'open', send: value => messages.push(JSON.parse(value)), close() {} };
  const messages = [];
  const writes = [];
  const receipts = [];
  const stops = [];
  const track = { enabled: false, addEventListener() {}, stop() { stops.push('track'); } };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const events = { open: [] };
  t.mock.method(globalThis, 'fetch', async (url, request) => {
    writes.push({ url, body: JSON.parse(request.body) });
    return Response.json({ id: 'issue', identifier: 'TEST-2', companyId: 'company', assigneeAgentId: 'agent' });
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
    companyId: 'company', agentId: 'agent', language: 'en',
    connect: async payload => { events.open.push(payload); return { answer: 'v=0\r\n', sessionId: 'session' }; },
    disconnect: async payload => { stops.push(payload.sessionId); },
    onPhase() {}, onMicLevel() {}, onReply() {}, onTask: id => receipts.push(id),
    onError: assert.fail, onPlaybackBlocked() {}, waitCue: async () => {},
  });
  t.after(conversation.stop);
  const event = value => channel.onmessage({ data: JSON.stringify(value) });
  const turn = () => new Promise(resolve => setImmediate(resolve));
  await turn();
  assert.deepEqual(events.open, [{ companyId: 'company', language: 'en', offer: 'v=0\r\n' }]);
  assert.equal(track.enabled, true);

  const call = { type: 'function_call', name: 'create_task', call_id: 'task_1', arguments: JSON.stringify(args) };
  event({ type: 'response.done', response: { status: 'completed', output: [{ type: 'message' }] } });
  event({ type: 'response.done', response: { status: 'cancelled', output: [call] } });
  await turn();
  assert.equal(writes.length, 0);

  event({ type: 'response.done', response: { status: 'completed', output: [call] } });
  await turn();
  assert.equal(writes.length, 1);
  assert.deepEqual(receipts, ['TEST-2']);
  assert.equal(messages[0].item.call_id, 'task_1');
  assert.deepEqual(JSON.parse(messages[0].item.output), { status: 'created', identifier: 'TEST-2' });
  assert.equal(messages[1].type, 'response.create');
  conversation.stop();
  assert.deepEqual(stops, ['track', 'peer', 'session']);
});
