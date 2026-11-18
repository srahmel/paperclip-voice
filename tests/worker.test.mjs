import test from 'node:test';
import assert from 'node:assert/strict';
import plugin from '../src/worker.ts';

const actions = new Map();
const data = new Map();
let reads = 0;
await plugin.definition.setup({
  config: { get: async () => ({ backend: 'python', sttPython: '/missing-voice-test-runtime' }) },
  actions: { register: (key, action) => actions.set(key, action) },
  data: { register: (key, reader) => data.set(key, reader) },
  issues: { get: async () => { reads++; return null; }, listComments: async () => [] },
});
const auth = { companyId: 'company-a', actor: { type: 'user', userId: 'user-a' } };
const request = { companyId: 'company-a', audioBase64: 'AA==', mimeType: 'audio/wav', language: 'de' };

test('worker rejects company spoofing and agent calls before reading task data', async () => {
  await assert.rejects(actions.get('voice-transcribe')({ ...request, companyId: 'company-b' }, auth), /authenticated company user/);
  await assert.rejects(actions.get('voice-speak-comment')({ companyId: 'company-a', issueId: 'i', commentId: 'c' }, { ...auth, actor: { type: 'agent' } }), /authenticated company user/);
  assert.equal(reads, 0);
});

test('audio job status and cancellation require the original company and user', async () => {
  const { jobId } = await actions.get('voice-transcribe')(request, auth);
  assert.equal(typeof jobId, 'string');
  const params = { companyId: 'company-a', jobId };
  const other = { ...auth, actor: { type: 'user', userId: 'user-b' } };
  await assert.rejects(actions.get('voice-poll')(params, other), /not found/);
  await assert.rejects(actions.get('voice-cancel')(params, other), /not found/);
  assert.deepEqual(await actions.get('voice-cancel')(params, auth), { cancelled: true });
  await assert.rejects(actions.get('voice-poll')(params, auth), /not found/);
});

test('shutdown retires pending audio jobs without replaying provider work', async () => {
  const { jobId } = await actions.get('voice-transcribe')(request, auth);
  await plugin.definition.onShutdown();
  await assert.rejects(actions.get('voice-poll')({ companyId: 'company-a', jobId }, auth), /not found/);
});
