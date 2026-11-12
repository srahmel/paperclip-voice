import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { build } from 'esbuild';
import { createVoiceStateBridge, VOICE_STATE_EVENT, VOICE_STATE_REQUEST_EVENT } from '../../src/lib/voice-state.mjs';

// Optional source-level integration against a supplied Companion receiver module.
// Reads/bundles its code; changes no files and contacts no backend.
if (!process.argv[2]) throw new Error('Usage: node tests/browser/check-consumer.mjs <receiver-module.ts>');
const modulePath = path.resolve(process.argv[2]);
const digest = createHash('sha256').update(await readFile(modulePath)).digest('hex');
const bundled = await build({entryPoints:[modulePath], bundle:true, format:'esm', platform:'node', write:false});
const { createVoiceReceiver, voiceState } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString('base64')}`);
const context = {companyId:'synthetic-company', conversationId:'synthetic-conversation', agentId:'synthetic-agent'};
const receiver = createVoiceReceiver(context), eventTarget = new EventTarget(), accepted = [], emitted = [];
eventTarget.addEventListener(VOICE_STATE_EVENT, event => {
  emitted.push(event.detail);
  const state = receiver.accept(event.detail);
  if (state) accepted.push(state);
});
const bridge = createVoiceStateBridge({eventTarget});
const first = bridge.start(context);
bridge.update(first,'listening');
assert.equal(voiceState(accepted.at(-1).phase),'listening');
bridge.update(first,'speaking',0.6);
const oldSpeaking = emitted.at(-1);
assert.equal(accepted.at(-1).speechEnergy,0.6);
assert.equal(receiver.accept(oldSpeaking),null,'duplicate sequence must be rejected');
assert.equal(receiver.accept({...oldSpeaking, sequence:1000, agentId:'another-agent'}),null);
eventTarget.dispatchEvent(new CustomEvent(VOICE_STATE_REQUEST_EVENT,{detail:{version:1,...context}}));
assert.equal(accepted.at(-1).sequence,oldSpeaking.sequence+1);
bridge.end(first);
assert.equal(accepted.at(-1).speechEnergy,0);
assert.equal(voiceState(accepted.at(-1).phase),'resting');
const next = bridge.start(context);
bridge.update(next,'waiting');
assert.equal(voiceState(accepted.at(-1).phase),'processing');
assert.equal(receiver.accept({...oldSpeaking,sequence:1001}),null,'retired session must be rejected');
const count=accepted.length;
bridge.update(first,'speaking',1);
assert.equal(accepted.length,count);
bridge.end(next,'error');
assert.equal(voiceState(accepted.at(-1).phase),'unavailable');
bridge.start({...context,companyId:'another-company'});
assert.equal(accepted.at(-1).phase,'error','company mismatch must be ignored');
bridge.dispose();
console.log(`PASS: producer/consumer context, snapshot, state mapping, sequence, retired-session and stop/error reset; receiver SHA-256 ${digest}`);
