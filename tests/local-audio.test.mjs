import test from 'node:test';
import assert from 'node:assert/strict';
import { transcribeLocal, speakLocal } from '../src/lib/local-audio.mjs';

test('local transcription uploads bounded audio to authenticated Paperclip', async () => {
  const audio = new Blob(['audio'], {type: 'audio/webm'});
  let request;
  const text = await transcribeLocal('a/b', audio, 'de', async (url, options) => {
    request = {url, options};
    return {ok: true, json: async () => ({text: ' Hallo '})};
  });
  assert.equal(text, 'Hallo');
  assert.equal(request.url, '/api/companies/a%2Fb/local-dictation');
  assert.equal(request.options.credentials, 'include');
  assert.equal(request.options.body, audio);
  assert.equal(request.options.headers['X-Dictation-Language'], 'de');
});

test('rejects oversized audio and reports failed transcription', async () => {
  await assert.rejects(transcribeLocal('c', new Blob([new Uint8Array(2 * 1024 * 1024 + 1)])));
  await assert.rejects(transcribeLocal('c', new Blob(['audio']), 'auto', async () => ({ok:false})), /Transkription/);
});

test('speech uses authenticated local endpoint and handles failure', async () => {
  let request;
  const bytes = new ArrayBuffer(4);
  assert.equal(await speakLocal('c', 'Hallo', 'de', async (url, options) => { request = {url, options}; return {ok:true, arrayBuffer: async () => bytes}; }), bytes);
  assert.equal(request.url, '/api/companies/c/local-speech');
  assert.equal(request.options.credentials, 'include');
  assert.deepEqual(JSON.parse(request.options.body), {text: 'Hallo', language: 'de'});
  await assert.rejects(speakLocal('c', 'Hallo', 'de', async () => ({ok:false})), /Sprachausgabe/);
});

test('missing route and authorization failures give actionable errors', async () => {
  await assert.rejects(transcribeLocal('c', new Blob(['x']), 'de', async () => ({ok:false, status:404})), /Endpunkt fehlt/);
  await assert.rejects(speakLocal('c', 'Hallo', 'de', async () => ({ok:false, status:403})), /Berechtigung/);
});
