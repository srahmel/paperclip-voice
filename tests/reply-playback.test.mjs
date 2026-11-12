import test from 'node:test';
import assert from 'node:assert/strict';
import { createReplyPlayback } from '../src/lib/reply-playback.mjs';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const turn = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const sources = [], phases = [], energies = [], timers = new Map();
  let timerId = 0, active = true;
  class Context extends EventTarget {
    state = 'running';
    destination = {};
    decodeAudioData = async () => ({});
    resume = async () => {};
    createBufferSource() {
      const source = { connect(node) { this.output = node; }, disconnect() { this.disconnected = true; }, start() { this.started = true; }, stop() { this.stopped = true; this.onended?.(); } };
      sources.push(source);
      return source;
    }
    createAnalyser() {
      return { fftSize:0, connect(node) { this.output = node; }, disconnect() { this.disconnected = true; }, getFloatTimeDomainData(samples) { samples.fill(0.125); } };
    }
  }
  const audioContext = new Context();
  const playback = createReplyPlayback({ audioContext, isActive: () => active, onPhase: p => phases.push(p), onEnergy: e => energies.push(e),
    schedule: tick => { timers.set(++timerId, tick); return timerId; }, cancel: id => timers.delete(id) });
  return { playback, audioContext, sources, phases, energies, timers, deactivate: () => {active = false;} };
}
const bytes = () => new ArrayBuffer(16);

test('reply energy comes from the actual output path and resets after natural completion', async () => {
  const f = fixture();
  const play = f.playback.play(bytes());
  await turn();
  assert.equal(f.sources[0].output.output, f.audioContext.destination);
  f.timers.values().next().value();
  assert.equal(f.energies.at(-1), 0.5);
  assert.deepEqual(f.phases, ['speaking']);
  f.sources[0].onended();
  await play;
  assert.equal(f.energies.at(-1), 0);
  assert.equal(f.phases.at(-1), 'ready');
  assert.equal(f.timers.size, 0);
});

test('stop settles playback and late ended/timer callbacks cannot affect the next playback', async () => {
  const f = fixture();
  const first = f.playback.play(bytes());
  await turn();
  const lateEnded = f.sources[0].onended;
  const lateTick = f.timers.values().next().value;
  f.playback.stop();
  await first;
  assert.equal(f.sources[0].stopped, true);
  assert.equal(f.energies.at(-1), 0);
  const second = f.playback.play(bytes());
  await turn();
  const count = f.energies.length;
  lateEnded(); lateTick();
  assert.equal(f.energies.length, count);
  assert.equal(f.sources[1].stopped, undefined);
  f.playback.stop();
  await second;
});

for (const boundary of ['decodeAudioData', 'resume']) {
  test(`stop during delayed ${boundary} prevents a late source from starting`, async () => {
    const f = fixture(), pending = deferred();
    f.audioContext[boundary] = () => pending.promise;
    const play = f.playback.play(bytes());
    await turn();
    f.playback.stop();
    pending.resolve({});
    await play;
    assert.equal(f.sources.length, 0);
    assert.equal(f.energies.at(-1), 0);
    assert.deepEqual(f.phases, []);
  });
}

test('navigation and suspended audio immediately clear energy and never reuse stale output', async () => {
  const f = fixture();
  const play = f.playback.play(bytes());
  await turn();
  const tick = f.timers.values().next().value;
  tick();
  f.audioContext.state = 'suspended';
  f.audioContext.dispatchEvent(new Event('statechange'));
  assert.equal(f.energies.at(-1), 0);
  assert.equal(f.phases.at(-1), 'waiting');
  f.deactivate();
  tick();
  await play;
  assert.equal(f.energies.at(-1), 0);
  assert.equal(f.timers.size, 0);
  assert.equal(f.sources[0].stopped, true);
});

test('a source start error rejects and frees output nodes', async () => {
  const f = fixture();
  const makeSource = f.audioContext.createBufferSource.bind(f.audioContext);
  f.audioContext.createBufferSource = () => {
    const source = makeSource();
    source.start = () => { throw new Error('output unavailable'); };
    return source;
  };
  await assert.rejects(f.playback.play(bytes()), /output unavailable/);
  assert.equal(f.energies.at(-1), 0);
  assert.equal(f.sources[0].disconnected, true);
  assert.equal(f.timers.size, 0);
});

test('unexpected output context closure rejects and clears the active sampler', async () => {
  const f = fixture();
  const play = f.playback.play(bytes());
  await turn();
  const rejection = assert.rejects(play, /context closed/);
  f.audioContext.state = 'closed';
  f.audioContext.dispatchEvent(new Event('statechange'));
  await rejection;
  assert.equal(f.energies.at(-1), 0);
  assert.equal(f.timers.size, 0);
  assert.equal(f.sources[0].stopped, true);
});
