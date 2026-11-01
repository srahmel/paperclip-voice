import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertLocalVoiceboxUrl, parseConfig, decodeBase64Audio, normaliseAudioMime,
  cleanSpokenText, voiceMessage, routeTarget, isAgentComment, vadDecision,
} from '../src/lib/voice-utils.mjs';

test('configuration defaults to local German speech', () => {
  const c = parseConfig();
  assert.equal(c.voiceboxUrl, 'http://127.0.0.1:8790');
  assert.equal(c.language, 'de');
  assert.equal(c.voice, 'de_DE-thorsten-medium');
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

test('only agent-authored non-deleted comments are audible', () => {
  assert.equal(isAgentComment({ body: 'Gut', authorAgentId: 'agent-1' }), true);
  assert.equal(isAgentComment({ body: 'Gut', authorType: 'agent' }), true);
  assert.equal(isAgentComment({ body: 'Meine Frage', authorUserId: 'human' }), false);
  assert.equal(isAgentComment({ body: 'Gut', authorAgentId: 'a', deletedAt: 'now' }), false);
});

test('VAD stops only after speech+silence or maximum duration', () => {
  assert.equal(vadDecision({ rms: 0.00, elapsedMs: 1200, silenceMs: 1200, spoke: false }).stop, false);
  assert.equal(vadDecision({ rms: 0.055, elapsedMs: 1200, silenceMs: 0, spoke: false }).spoke, true);
  assert.equal(vadDecision({ rms: 0.001, elapsedMs: 2200, silenceMs: 1400, spoke: true }).stop, true);
  assert.equal(vadDecision({ rms: 0.03, elapsedMs: 27000, silenceMs: 0, spoke: true }).stop, true);
});
