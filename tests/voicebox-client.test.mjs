import test from 'node:test';
import assert from 'node:assert/strict';
import { transcribeWithVoicebox, synthesizeWithVoicebox, voiceboxHealth, spokenComment } from '../src/lib/voicebox-client.mjs';

test('STT uses local OpenAI-compatible multipart transcription and German language', async () => {
  let seen;
  const doFetch = async (url, request) => {
    seen = { url, request };
    return { ok: true, json: async () => ({ text: '  Alex, bitte prüfen.  ' }) };
  };
  const text = await transcribeWithVoicebox({
    baseUrl: 'http://127.0.0.1:8790', language: 'de',
    audioBase64: Buffer.from('RIFFtest').toString('base64'), mimeType: 'audio/webm;codecs=opus',
    doFetch,
  });
  assert.equal(text, 'Alex, bitte prüfen.');
  assert.equal(seen.url, 'http://127.0.0.1:8790/v1/audio/transcriptions');
  assert.equal(seen.request.body.get('language'), 'de');
  assert.equal(seen.request.body.get('model'), 'stt');
  assert.equal(seen.request.body.get('file').type, 'audio/webm');
});

test('STT non-200 fails without leaking provider response contents', async () => {
  await assert.rejects(
    transcribeWithVoicebox({ baseUrl: 'http://127.0.0.1:8790', language: 'de', audioBase64: 'QUJD', mimeType: 'audio/wav', doFetch: async () => ({ok: false, status: 503}) }),
    /HTTP 503/,
  );
});

test('TTS posts German voice and returns base64 PCM WAV audio', async () => {
  let sent;
  const payload = Buffer.from('RIFFwave-data');
  const result = await synthesizeWithVoicebox({
    baseUrl: 'http://localhost:8790', voice: 'de_DE-thorsten-medium', speechRate: 1.1, text: 'Aufgabe ist erledigt.',
    doFetch: async (url, request) => {
      sent = { url, body: JSON.parse(request.body) };
      return {ok: true, arrayBuffer: async () => payload};
    },
  });
  assert.equal(sent.url, 'http://localhost:8790/v1/audio/speech');
  assert.equal(sent.body.voice, 'de_DE-thorsten-medium');
  assert.equal(sent.body.model, 'tts');
  assert.equal(sent.body.response_format, 'wav');
  assert.equal(result.mime, 'audio/wav');
  assert.equal(Buffer.from(result.audioBase64, 'base64').toString(), payload.toString());
});

test('health probes localhost and respects unavailable state', async () => {
  assert.equal(await voiceboxHealth({baseUrl: 'http://localhost:8790', doFetch: async () => ({ok:true,json:async()=>({status:'ok'})})}), true);
  assert.equal(await voiceboxHealth({baseUrl: 'http://localhost:8790', doFetch: async () => ({ok:true,json:async()=>({status:'error'})})}), false);
});

test('speech trimming excludes markdown code and avoids another LLM request', () => {
  const {text, truncated} = spokenComment('```bash\nrm -rf .\n```\nAufgabe abgeschlossen.', 130);
  assert.equal(truncated, false);
  assert.doesNotMatch(text, /rm -rf/);
  assert.match(text, /abgeschlossen/);
});
