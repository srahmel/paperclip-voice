import assert from 'node:assert/strict';
import test from 'node:test';
import { extractVoiceTaskReceipt, voiceConfirmationDecision, voiceConfirmationPrompt } from '../src/lib/voice-confirmation.mjs';
import { voiceMessage } from '../src/lib/voice-utils.mjs';

test('only complete, unqualified commands approve or discard a spoken draft', () => {
  for (const [language, approve, discard, correction] of [
    ['de', 'Ja, senden.', 'Nein.', 'Korrektur: Frag Klara nach der Uhrzeit.'],
    ['en', 'Yes, send it.', 'No.', 'Correction: Ask Klara for the time.'],
    ['nl', 'Ja, versturen.', 'Nee.', 'Correctie: Vraag Klara hoe laat het is.'],
    ['no', 'Ja, send.', 'Nei.', 'Rettelse: Spør Klara hva klokken er.'],
  ]) {
    assert.equal(voiceConfirmationDecision(approve, language).kind, 'approve');
    assert.equal(voiceConfirmationDecision(discard, language).kind, 'discard');
    assert.deepEqual(voiceConfirmationDecision(correction, language), { kind: 'correct', text: correction.split(': ')[1] });
  }
  for (const text of ['Ja, aber erst morgen', 'Sag Ja', 'Nein, ja', 'Korrektur']) {
    assert.equal(voiceConfirmationDecision(text, 'de').kind, 'unclear');
  }
});

test('readback includes the full proposed message, including questions', () => {
  assert.equal(voiceConfirmationPrompt('Wie spät ist es?', 'de'), 'Ich habe verstanden. Wie spät ist es? Soll ich das senden? Sag Ja, senden, oder Nein.');
  assert.throws(() => voiceConfirmationPrompt('a'.repeat(801), 'de'), /invalid voice confirmation/i);
});

test('task receipts are requested for confirmed messages and extracted from a dedicated line', () => {
  const id = 'b13b6efd-47f1-4945-aab8-6e65d3e52273';
  assert.match(voiceMessage('Lege die Aufgabe an.', false, 'de', true), /Task created: <Paperclip task UUID>/);
  assert.doesNotMatch(voiceMessage('Wie spät ist es?'), /Task created/);
  assert.deepEqual(extractVoiceTaskReceipt(`Ich habe den Eintrag angelegt.\nTask created: ${id}`), { taskId: id, text: 'Ich habe den Eintrag angelegt.' });
  assert.equal(extractVoiceTaskReceipt(`Als Beispiel: Task created: ${id}`).taskId, undefined);
});
