import test from 'node:test';
import assert from 'node:assert/strict';
import manifest from '../src/manifest.ts';
import {
  assertLocalVoiceboxUrl, parseConfig, voiceForLanguage, decodeBase64Audio, normaliseAudioMime,
  cleanSpokenText, voiceMessage, routeTarget, rememberVoiceAgent, voiceSessionTarget, isAgentComment, createSpeechDetector, vadDecision,
} from '../src/lib/voice-utils.mjs';

test('configuration defaults to local German speech', () => {
  const c = parseConfig();
  assert.equal(c.voiceboxUrl, 'http://127.0.0.1:8790');
  assert.equal(c.language, 'de');
  assert.equal(c.voice, 'de_DE-thorsten-medium');
});

test('the German voice dropdown selects a Piper model and preserves saved voice IDs', () => {
  const { voicePreset } = manifest.instanceConfigSchema.properties;
  const saved = { voice: 'de_DE-thorsten-high' };
  assert.deepEqual(voicePreset.enum, ['Use saved voice ID', 'Thorsten', 'Kerstin']);
  assert.equal(parseConfig(saved).voice, saved.voice);
  assert.equal(parseConfig({ ...saved, voicePreset: voicePreset.default }).voice, saved.voice);
  assert.equal(parseConfig({ ...saved, voicePreset: 'Thorsten' }).voice, 'de_DE-thorsten-medium');
  assert.equal(parseConfig({ ...saved, voicePreset: 'Kerstin' }).voice, 'de_DE-kerstin-low');
  assert.throws(() => parseConfig({ voicePreset: 'toString' }), /Invalid German voice preset/);
});

test('rejects remote or potentially unsafe backend URLs', () => {
  for (const url of [
    'http://192.168.1.2:8790', 'http://8.8.8.8:8790', 'https://localhost:8790',
    'http://localhost:8790/path', 'http://localHost@127.0.0.1:8790',
    'http://127.0.0.1:8790/?foo=bar', 'file:///etc/passwd',
    'http://127.0.0.1:22',
  ]) assert.throws(() => assertLocalVoiceboxUrl(url), undefined, url);
  assert.equal(assertLocalVoiceboxUrl('http://localhost:8790'), 'http://localhost:8790');
});

test('language and voice dropdowns persist the matching local Piper selections', () => {
  const { language, englishVoicePreset, dutchVoicePreset, norwegianVoicePreset } = manifest.instanceConfigSchema.properties;
  assert.deepEqual(language.enum, ['de', 'en', 'nl', 'no']);
  assert.deepEqual(englishVoicePreset.enum, ['Lessac', 'Cori']);
  assert.deepEqual(dutchVoicePreset.enum, ['Alex', 'Nathalie']);
  assert.deepEqual(norwegianVoicePreset.enum, ['Talesyntese', 'NVCC']);
  const config = parseConfig({ language: 'nl', englishVoicePreset: 'Cori', dutchVoicePreset: 'Nathalie', norwegianVoicePreset: 'NVCC' });
  assert.equal(config.language, 'nl');
  assert.equal(voiceForLanguage(config, 'en'), 'en_GB-cori-medium');
  assert.equal(voiceForLanguage(config, 'nl'), 'nl_BE-nathalie-medium');
  assert.equal(voiceForLanguage(config, 'no'), 'no_NO-nvcc-medium');
  assert.equal(voiceForLanguage(parseConfig(), 'en'), 'en_US-lessac-medium');
  assert.throws(() => parseConfig({ dutchVoicePreset: 'Cori' }), /Invalid Dutch voice preset/);
});

test('configuration shows language and voice selectors before advanced options', () => {
  const essentialProperties = Object.entries(manifest.instanceConfigSchema.properties)
    .filter(([, property]) => !property['x-paperclip-advanced'])
    .map(([key]) => key);
  assert.deepEqual(essentialProperties, [
    'generalVoiceBackend', 'realtimeApiKey', 'realtimeRegion', 'realtimeVoice',
    'language', 'voicePreset', 'englishVoicePreset', 'dutchVoicePreset', 'norwegianVoicePreset',
  ]);
});

test('rejects untrusted audio types and oversized/malformed payloads', () => {
  assert.equal(normaliseAudioMime('audio/webm;codecs=opus'), 'audio/webm');
  assert.throws(() => normaliseAudioMime('application/javascript'));
  assert.deepEqual(decodeBase64Audio(Buffer.from('hello').toString('base64')), Buffer.from('hello'));
  assert.throws(() => decodeBase64Audio('X%23'));
  assert.throws(() => decodeBase64Audio(Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64')));
});

test('speech cleanup keeps paperclip original intact and limits spoken text', () => {
  const original = '## Status\n**Fertig**. [Zur Aufgabe](https://example.org/task)\n```js\nsecret()\n```';
  const before = original;
  const out = cleanSpokenText(original);
  assert.equal(original, before);
  assert.match(out.text, /Status/);
  assert.match(out.text, /Fertig/);
  assert.doesNotMatch(out.text, /secret\(/);
  const capped = cleanSpokenText('Ein langer Satz. '.repeat(70), 145);
  assert.equal(capped.truncated, true);
  assert.match(capped.text, /Weitere Details stehen im Paperclip-Chat/);
});

test('voice request adds a temporary visible hint only for voice turns', () => {
  assert.equal(voiceMessage('Hallo', false), 'Hallo');
  assert.match(voiceMessage('Bitte prüfe DemoApp'), /Sprachmodus/);
  assert.match(voiceMessage('Kan du hjelpe?', true, 'no'), /norsk bokmål/);
  assert.match(cleanSpokenText('https://example.org', 120, 'nl').text, /link in de chat/);
  assert.throws(() => voiceMessage(''));
  assert.throws(() => voiceMessage('a'.repeat(5001)));
});

test('route target resolves native agent chat and issue destinations', () => {
  assert.deepEqual(routeTarget('/HUM/issues/HUM-21'), { kind: 'issue', ref: 'HUM-21' });
  assert.deepEqual(routeTarget('/chats/alex'), { kind: 'chat', ref: 'alex' });
  assert.deepEqual(routeTarget('/companies/demo/chats/alex%20test'), { kind: 'chat', ref: 'alex test' });
  const id = '2ab1581c-f210-41e8-86f0-a8d271b8d012';
  assert.deepEqual(routeTarget(`/issues/${id}`), { kind: 'issue', ref: id });
  assert.equal(routeTarget('/chats'), null);
});

test('the last explicitly selected voice agent is restored by company for the browser session', () => {
  const data = new Map();
  const storage = { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
  rememberVoiceAgent('company-a', 'klara', storage);
  rememberVoiceAgent('company-b', 'konrad', storage);
  assert.deepEqual(voiceSessionTarget('/HUM/dashboard', 'company-a', undefined, storage), { kind: 'chat', ref: 'klara' });
  assert.deepEqual(voiceSessionTarget('/OTHER/dashboard', 'company-b', undefined, storage), { kind: 'chat', ref: 'konrad' });
  assert.deepEqual(voiceSessionTarget('/HUM/issues/HUM-21', 'company-a', undefined, storage), { kind: 'issue', ref: 'HUM-21' });
  assert.deepEqual(voiceSessionTarget('/HUM/dashboard', 'company-a', 'explicit-task', storage), { kind: 'issue', ref: 'explicit-task' });
  rememberVoiceAgent('company-a', undefined, storage);
  assert.deepEqual(voiceSessionTarget('/HUM/chats/vera', 'company-a', undefined, storage), { kind: 'chat', ref: 'vera' });
});

test('only agent-authored non-deleted comments are audible', () => {
  assert.equal(isAgentComment({ body: 'Gut', authorAgentId: 'agent-1' }), true);
  assert.equal(isAgentComment({ body: 'Gut', authorType: 'agent' }), true);
  assert.equal(isAgentComment({ body: 'Meine Frage', authorUserId: 'human' }), false);
  assert.equal(isAgentComment({ body: 'Gut', authorAgentId: 'a', deletedAt: 'now' }), false);
});

test('steady input above the former fixed threshold is learned as background', () => {
  const speech = createSpeechDetector(() => 0.008);
  for (let frame = 0; frame < 20; frame++) assert.equal(speech(0.013), false);
  assert.equal(speech(0.031), true);
  assert.equal(speech(0.022, true), true);
  assert.equal(speech(0.013, true), false);
});

test('VAD stops only after speech+silence or maximum duration', () => {
  assert.equal(vadDecision({ rms: 0.00, elapsedMs: 1200, silenceMs: 1200, spoke: false }).stop, false);
  assert.equal(vadDecision({ rms: 0.055, elapsedMs: 1200, silenceMs: 0, spoke: false }).spoke, true);
  assert.equal(vadDecision({ rms: 0.001, elapsedMs: 2200, silenceMs: 1400, spoke: true }).stop, true);
  assert.equal(vadDecision({ rms: 0.03, elapsedMs: 27000, silenceMs: 0, spoke: true }).stop, true);
});
