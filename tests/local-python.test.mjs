import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { runAudioWorker, localAudioReady } from '../src/lib/local-python.mjs';
const script = fileURLToPath(new URL('./fixtures/audio-worker.mjs', import.meta.url));
const invoke = (mode, options = {}) => runAudioWorker({ executable: process.execPath, script, args: [mode], input: 'synthetic audio', ...options });

test('local audio uses pipe transport and a restricted offline child environment', async () => {
  assert.equal((await invoke('echo')).toString(), 'synthetic audio');
  process.env.PAPERCLIP_TEST_SECRET_SHOULD_NOT_CROSS = 'synthetic-only';
  try { assert.deepEqual(JSON.parse((await invoke('env')).toString()), { leaked: false, offline: '1' }); }
  finally { delete process.env.PAPERCLIP_TEST_SECRET_SHOULD_NOT_CROSS; }
});

test('oversized output, timeout and cancellation settle the owned audio process', async () => {
  await assert.rejects(invoke('large', { maxBytes: 32 }), /stopped or failed/);
  await assert.rejects(invoke('hang', { timeoutMs: 100 }), /stopped or failed/);
  const controller = new AbortController();
  const pending = invoke('hang', { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, /stopped or failed/);
});

test('a stopped job cannot start a child and absent local runtimes are unavailable', async () => {
  await assert.rejects(invoke('echo', { signal: AbortSignal.abort() }), /cancelled/);
  assert.equal(localAudioReady({ sttPython: '/missing-voice-runtime', ttsPython: '/missing-voice-runtime' }), false);
});
