import test from 'node:test';
import assert from 'node:assert/strict';
import { audioBlobToBase64, audioBase64ToBuffer, waitForVoiceJob } from '../src/lib/plugin-audio.mjs';

test('base64 transport preserves audio bytes without publishing a separate endpoint', async () => {
  const bytes = new Uint8Array([0, 1, 2, 127, 128, 255]);
  const blob = new Blob([bytes], { type: 'audio/webm' });
  const encoded = await audioBlobToBase64(blob);
  assert.deepEqual(new Uint8Array(audioBase64ToBuffer(encoded)), bytes);
});

test('transcription rejects empty and oversized audio before plugin action', async () => {
  await assert.rejects(audioBlobToBase64(new Blob([])), /leer|2 MiB/i);
  await assert.rejects(audioBlobToBase64(new Blob([new Uint8Array(2 * 1024 * 1024 + 1)])), /2 MiB/i);
});

test('job helper polls pending and returns the successful result', async () => {
  const calls = [];
  let ticks = 0;
  const result = await waitForVoiceJob(async (data) => {
    calls.push(data);
    return { jobId: 'job-1' };
  }, async (data) => {
    calls.push(data);
    return ticks++ ? { status: 'ready', result: { text: 'Guten Tag' } } : { status: 'pending' };
  }, { companyId: 'company-1', audioBase64: 'AA==' }, () => true, { intervalMs: 1, sleep: async () => undefined });
  assert.deepEqual(result, { text: 'Guten Tag' });
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[1], { companyId: 'company-1', jobId: 'job-1' });
});

test('job helper fails closed on invalid, failed and aborted sessions', async () => {
  const start = async () => ({ jobId: 'job-2' });
  await assert.rejects(waitForVoiceJob(start, async () => ({ status: 'error', error: 'speech failed' }), {companyId:'c'}, () => true), /speech failed/);
  await assert.rejects(waitForVoiceJob(start, async () => ({ status: 'invalid' }), {companyId:'c'}, () => true), /Invalid audio job state/);
  await assert.rejects(waitForVoiceJob(start, async () => ({ status: 'pending' }), {companyId:'c'}, () => false), /ended/);
});
