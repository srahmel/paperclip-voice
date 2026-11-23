import test from 'node:test';
import assert from 'node:assert/strict';
import { startLocalConversation } from '../src/ui/local-conversation.ts';

test('uploads speech in bounded chunks before the turn ends and reuses the stream', async () => {
  let node;
  let active = true;
  const updates = [];
  const texts = [];
  const previousNode = globalThis.AudioWorkletNode;
  globalThis.AudioWorkletNode = class {
    port = { close() {} };
    constructor() { node = this; }
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
        return { text: 'Testfrage' };
      },
      active: () => active, canListen: () => true, threshold: () => 0.035,
      onStartSpeech() {}, onEndSpeech() {}, onText: text => texts.push(text),
      onError: error => assert.fail(error),
    });
    const emit = rms => node.port.onmessage({ data: { data: new ArrayBuffer(3200), rms } });
    for (let index = 0; index < 12; index++) emit(0.005);
    assert.deepEqual(updates, []);
    for (let turn = 1; turn <= 2; turn++) {
      for (let index = 0; index < 7; index++) emit(0.09);
      assert.ok(updates.includes('audio'));
      assert.equal(updates.filter(command => command === 'finish').length, turn - 1);
      for (let index = 0; index < 6; index++) emit(0.005);
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(texts.length, turn);
    }
    active = false;
    stop();
    assert.equal(updates.at(-1), 'stop');
  } finally {
    stop?.();
    globalThis.AudioWorkletNode = previousNode;
  }
});
