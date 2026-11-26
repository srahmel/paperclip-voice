import test from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceWorkspace } from '../src/lib/paperclip-workspace.mjs';

test('the open-task overview uses caller-scoped reads and excludes unrelated data', async () => {
  const calls = [];
  const workspace = createVoiceWorkspace({ companyId: 'test-company', language: 'de', doFetch: async (path, request) => {
    calls.push({ path, request });
    return Response.json([
      { companyId: 'test-company', identifier: 'TEST-1', title: 'Check reports', status: 'todo', description: 'Not requested', privateConfig: 'excluded' },
      { companyId: 'foreign-company', identifier: 'OTHER-1', status: 'todo' },
      { companyId: 'test-company', identifier: 'TEST-2', status: 'done' },
    ]);
  } });
  const result = await workspace.read(JSON.stringify({ resource: 'tasks', mine: true }));
  assert.deepEqual(result, { status: 'ok', items: [{ identifier: 'TEST-1', title: 'Check reports', status: 'todo' }], counts: { todo: 1 }, scanned: 1, offset: 0, complete: true });
  assert.equal(calls.length, 1);
  assert.match(calls[0].path, /^\/api\/companies\/test-company\/issues\?/);
  assert.match(calls[0].path, /assigneeUserId=me/);
  assert.equal(calls[0].request.method, 'GET');
  assert.equal(calls[0].request.credentials, 'include');
});

test('reads and staged changes reject foreign tasks and administration paths', async () => {
  const methods = [];
  const workspace = createVoiceWorkspace({ companyId: 'test-company', language: 'de', doFetch: async (_path, request) => {
    methods.push(request.method);
    return Response.json({ companyId: 'foreign-company', id: 'foreign-id', identifier: 'OTHER-1' });
  } });
  await assert.rejects(workspace.prepare(JSON.stringify({ action: 'update_task', reference: 'OTHER-1', status: 'done' })), /not_found/);
  await assert.rejects(workspace.prepare(JSON.stringify({ action: 'modify_settings', reference: 'instance' })), /unsupported_change/);
  await assert.rejects(workspace.destination(JSON.stringify({ destination: 'settings' })), /unsupported_view/);
  assert.deepEqual(methods, ['GET']);
});

test('the task detail shares a bounded projection and removes recognized credentials', async () => {
  const workspace = createVoiceWorkspace({ companyId: 'test-company', language: 'de', doFetch: async () => Response.json({
    companyId: 'test-company', id: 'issue', identifier: 'TEST-1', title: 'Check access', status: 'todo',
    description: 'Example token sk-proj-synthetic-abc1234567891', runnerCredentials: 'excluded',
  }) });
  const result = await workspace.read(JSON.stringify({ resource: 'task', reference: 'TEST-1' }));
  assert.equal(result.item.description, 'Example token [redacted]');
  assert.equal(result.item.runnerCredentials, undefined);
  assert.equal(await workspace.destination(JSON.stringify({ destination: 'task', reference: 'TEST-1' })), '/issues/TEST-1');
});
