import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureNativeAgentChat, resolveNativeTask, paperclipApi, readNativeComments, postNativeComment } from '../src/lib/paperclip-client.mjs';

test('task references resolve to the correct accessible company issue', async () => {
  let calls = 0;
  const doFetch = async (url, options) => {
    calls++;
    assert.equal(url, '/api/issues/HUM-21');
    assert.equal(options.method, 'GET');
    return { ok: true, json: async () => ({ id: 'issue-uuid', companyId: 'company' }) };
  };
  assert.equal(await resolveNativeTask('company', 'HUM-21', doFetch), 'issue-uuid');
  await assert.rejects(resolveNativeTask('other-company', 'HUM-21', doFetch), /anderen Organisation/);
  assert.equal(calls, 2);
});

test('voice mode resolves official agent chat as existing durable issue', async () => {
  const calls = [];
  const doFetch = async (url, opts) => {
    calls.push([url, opts]);
    return { ok: true, json: async () => ({ id: 'ordinary-chat-issue-id' }) };
  };
  const issueId = await ensureNativeAgentChat('company A', 'agent/one', doFetch);
  assert.equal(issueId, 'ordinary-chat-issue-id');
  assert.deepEqual(calls.map(([url]) => url), ['/api/companies/company%20A/chats/agent%2Fone']);
  assert.equal(calls[0][1].method, 'POST');
  assert.equal(calls[0][1].credentials, 'include');
  assert.deepEqual(JSON.parse(calls[0][1].body), {});
});

test('voice submission is one native human comment with a stable idempotency key', async () => {
  const calls = [];
  const doFetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, json: async () => ({ id: 'comment-1', body: 'Hello from voice' }) };
  };
  await postNativeComment('issue-42', 'Hello from voice', 'client-request-abc', doFetch);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/issues/issue-42/comments');
  assert.deepEqual(JSON.parse(calls[0].init.body), { body: 'Hello from voice', clientRequestId: 'client-request-abc' });
  assert.equal(calls[0].init.credentials, 'include');
});

test('network/server failure has unknown outcome and never auto-retries comment submission', async () => {
  let count = 0;
  await assert.rejects(postNativeComment('issue-42', 'Do work', 'key-42', async () => {
    count += 1;
    return { ok: false, status: 503, text: async () => 'PRIVATE BODY' };
  }), /outcome may be unknown/);
  assert.equal(count, 1);
  await assert.rejects(postNativeComment('issue-42', 'Do work', 'key-42', async () => {
    throw new TypeError('Network unavailable');
  }), /Network unavailable/);
});

test('agent follow-up reads native issue comments and does not create a new agent session', async () => {
  const comments = [{ id: 'reply', authorAgentId: 'agent-1', body: 'Task done' }];
  const doFetch = async (url, options) => {
    assert.equal(url, '/api/issues/issue-42/comments?order=desc&limit=100');
    assert.equal(options.method, 'GET');
    return { ok: true, json: async () => comments };
  };
  assert.deepEqual(await readNativeComments('issue-42', doFetch), comments);
});

test('API helper rejects protocol-relative paths before browser fetch', async () => {
  await assert.rejects(paperclipApi('//evil.invalid', { doFetch: async () => {throw new Error('should not fetch');} }), /Invalid Paperclip/);
});
