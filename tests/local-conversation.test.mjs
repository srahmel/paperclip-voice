import test from 'node:test';
import assert from 'node:assert/strict';
import { startLocalConversation } from '../src/ui/local-conversation.ts';
import { DEFAULT_SPEECH_LEVEL } from '../src/lib/voice-utils.mjs';

test('uploads speech in bounded chunks before the turn ends and reuses the stream', async () => {
  let node;
  let active = true;
  const updates = [];
  const texts = [];
  const levels = [];
  const fallbackJobs = [];
  const previousNode = globalThis.AudioWorkletNode;
  globalThis.AudioWorkletNode = class {
    port = { close() {} };
    constructor(_context, _name, options) {
      assert.equal(options.channelCount, 1);
      assert.equal(options.channelCountMode, 'explicit');
      node = this;
    }
    connect() {}
    disconnect() {}
  };
  let stop;
  try {
    stop = await startLocalConversation({
      context: { sampleRate: 48000, audioWorklet: { async addModule(url) {
        assert.match(url, /^blob:/);
        assert.match(await (await fetch(url)).text(), /registerProcessor\('paperclip-voice-capture'/);
      } } },
      input: { connect() {}, disconnect() {} },
      companyId: 'test-company',
      start: async () => ({ streamId: 'local-stream' }),
      update: async request => {
        assert.equal(request.streamId, 'local-stream');
        updates.push(request.command);
        if (request.command === 'audio') {
          assert.ok(Buffer.from(request.audioBase64, 'base64').length <= 12800);
          return { accepted: true };
        }
        return texts.length ? { text: '', fallbackJobId: 'whisper-fallback' } : { text: 'Testfrage' };
      },
      active: () => active, canListen: () => true, threshold: () => DEFAULT_SPEECH_LEVEL,
      onLevel: rms => levels.push(rms),
      recoverText: async jobId => { fallbackJobs.push(jobId); return 'Zweite Testfrage'; },
      onStartSpeech() {}, onEndSpeech() {}, onText: text => texts.push(text),
      onError: error => assert.fail(error),
    });
    const emit = rms => node.port.onmessage({ data: { data: new ArrayBuffer(3200), rms } });
    for (let index = 0; index < 12; index++) emit(0.005);
    assert.deepEqual(updates, []);
    assert.equal(levels.at(-1), 0.005);
    for (let turn = 1; turn <= 2; turn++) {
      // The former 0.035 threshold dropped every frame of this quiet turn.
      for (let index = 0; index < 7; index++) emit(0.018);
      assert.equal(levels.at(-1), 0.018);
      assert.ok(updates.includes('audio'));
      assert.equal(updates.filter(command => command === 'finish').length, turn - 1);
      for (let index = 0; index < 6; index++) emit(0.005);
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(texts.length, turn);
    }
    assert.deepEqual(texts, ['Testfrage', 'Zweite Testfrage']);
    assert.deepEqual(fallbackJobs, ['whisper-fallback']);
    active = false;
    stop();
    assert.equal(updates.at(-1), 'stop');
  } finally {
    stop?.();
    globalThis.AudioWorkletNode = previousNode;
  }
});
