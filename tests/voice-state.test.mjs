import test from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceStateBridge, VOICE_STATE_EVENT, VOICE_STATE_REQUEST_EVENT } from '../src/lib/voice-state.mjs';

function fixture() {
  const eventTarget = new EventTarget();
  const events = [];
  eventTarget.addEventListener(VOICE_STATE_EVENT, event => events.push(event.detail));
  let id = 0;
  const bridge = createVoiceStateBridge({ eventTarget, createSessionId: () => `session-${++id}` });
  const request = detail => eventTarget.dispatchEvent(new CustomEvent(VOICE_STATE_REQUEST_EVENT, { detail }));
  return { bridge, events, request };
}
const context = { companyId: 'company', conversationId: 'native-issue', agentId: 'agent' };

test('bridge sends only the v1 presentation fields, with bounded output energy and monotonic sequence', () => {
  const { bridge, events } = fixture();
  const session = bridge.start({ ...context, transcript: 'never publish', audio: 'never publish' });
  bridge.update(session, 'speaking', 9);
  bridge.update(session, 'listening', 0.9);
  bridge.update(session, 'speaking', NaN);
  assert.deepEqual(Object.keys(events[0]).sort(), ['version', 'companyId', 'conversationId', 'agentId', 'sessionId', 'sequence', 'phase', 'speechEnergy'].sort());
  assert.deepEqual(events.map(e => e.sequence), [1, 2, 3, 4]);
  assert.deepEqual(events.map(e => e.speechEnergy), [0, 1, 0, 0]);
  assert.ok(events.every(Object.isFrozen));
  bridge.dispose();
});

test('snapshot requires exact company/conversation/version, does not advance the phase or activate audio', () => {
  const { bridge, events, request } = fixture();
  const session = bridge.start(context);
  bridge.update(session, 'waiting');
  const count = events.length;
  for (const detail of [null, {}, {version:2, ...context}, {version:1, ...context, companyId:'other'}, {version:1, ...context, conversationId:null}]) request(detail);
  assert.equal(events.length, count);
  request({version:1, ...context});
  assert.equal(events.at(-1).sequence, 3);
  assert.equal(events.at(-1).phase, 'waiting');
  bridge.end(session, 'error');
  request({version:1, ...context});
  assert.equal(events.at(-1).phase, 'error');
  assert.equal(events.at(-1).speechEnergy, 0);
  bridge.dispose();
});

test('stop, new sessions, context changes and disposal reject stale callbacks', () => {
  const { bridge, events, request } = fixture();
  const old = bridge.start(context);
  bridge.update(old, 'speaking', 0.7);
  const next = bridge.start({...context, conversationId:'next-issue'});
  assert.equal(events.at(-2).phase, 'off');
  assert.equal(events.at(-2).speechEnergy, 0);
  const count = events.length;
  bridge.update(old, 'speaking', 1);
  bridge.end(old, 'error');
  request({version:1, ...context});
  assert.equal(events.length, count);
  bridge.end(next);
  bridge.update(next, 'listening');
  assert.equal(events.at(-1).phase, 'off');
  bridge.clear();
  const cleared = events.length;
  request({version:1, ...context, conversationId:'next-issue'});
  assert.equal(events.length, cleared);
  bridge.dispose();
  request({version:1, ...context});
  assert.equal(events.length, cleared);
});
