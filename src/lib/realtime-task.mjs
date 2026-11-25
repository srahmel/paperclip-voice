import { createNativeVoiceTask } from './paperclip-client.mjs';
import { voiceConfirmationDecision } from './voice-confirmation.mjs';

const MAX_TASKS = 10;

const TASK_SPEECH = {
  de: {
    ask: count => count === 1 ? 'Soll ich die Aufgabe anlegen?' : `Soll ich die ${count} Aufgaben anlegen?`,
    declined: 'Okay, ich lege nichts an.',
    unclear: 'Ich habe die Freigabe nicht sicher verstanden. Es wurde nichts angelegt.',
    receipt: ids => ids.length === 1 ? `Aufgabe ${ids[0]} ist angelegt.` : `Die Aufgaben ${ids.join(', ')} sind angelegt.`,
    unknown: 'Für die übrigen Aufgaben habe ich keine Bestätigung von Paperclip bekommen.',
  },
  en: {
    ask: count => count === 1 ? 'Shall I create the task?' : `Shall I create those ${count} tasks?`,
    declined: 'Okay, I won’t create anything.',
    unclear: 'I couldn’t verify your approval. No tasks were created.',
    receipt: ids => ids.length === 1 ? `Task ${ids[0]} was created.` : `Tasks ${ids.join(', ')} were created.`,
    unknown: 'Paperclip hasn’t confirmed the remaining tasks.',
  },
  nl: {
    ask: count => count === 1 ? 'Zal ik de taak aanmaken?' : `Zal ik de ${count} taken aanmaken?`,
    declined: 'Oké, ik maak niets aan.',
    unclear: 'Ik kon je toestemming niet bevestigen. Er zijn geen taken aangemaakt.',
    receipt: ids => ids.length === 1 ? `Taak ${ids[0]} is aangemaakt.` : `De taken ${ids.join(', ')} zijn aangemaakt.`,
    unknown: 'Paperclip heeft de overige taken niet bevestigd.',
  },
  no: {
    ask: count => count === 1 ? 'Skal jeg opprette oppgaven?' : `Skal jeg opprette de ${count} oppgavene?`,
    declined: 'Greit, jeg oppretter ingenting.',
    unclear: 'Jeg kunne ikke bekrefte godkjenningen. Ingen oppgaver ble opprettet.',
    receipt: ids => ids.length === 1 ? `Oppgave ${ids[0]} er opprettet.` : `Oppgavene ${ids.join(', ')} er opprettet.`,
    unknown: 'Paperclip har ikke bekreftet de andre oppgavene.',
  },
};

const ADDITIONAL_APPROVALS = {
  de: ['ja genau', 'ja mach das', 'ja mach das bitte', 'ja bitte anlegen', 'ja leg sie an', 'ja bitte beide', 'ja bitte alle'],
  en: ['yes go ahead', 'yes create them', 'yes both', 'yes all of them'],
  nl: ['ja inderdaad', 'ja doe maar', 'ja maak ze aan', 'ja allebei'],
  no: ['ja absolutt', 'ja gjør det', 'ja opprett dem', 'ja begge'],
};

export function taskApproval(text, language) {
  const decision = voiceConfirmationDecision(text, language).kind;
  if (decision !== 'unclear') return decision;
  const words = text.toLowerCase().normalize('NFC').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  return ADDITIONAL_APPROVALS[language]?.includes(words) ? 'approve' : 'unclear';
}

export function taskSpeech(language) {
  return TASK_SPEECH[language] ?? TASK_SPEECH.de;
}

function taskKey(title, description) {
  return JSON.stringify([title, description]).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ');
}

export function readTaskProposal(raw) {
  if (typeof raw !== 'string' || raw.length > 65_000) return [];
  let input;
  try { input = JSON.parse(raw)?.tasks; } catch { return []; }
  if (!Array.isArray(input) || input.length < 1 || input.length > MAX_TASKS) return [];
  const tasks = new Map();
  for (const value of input) {
    if (typeof value?.title !== 'string' || typeof value.description !== 'string') return [];
    const title = value.title.trim();
    const description = value.description.trim();
    if (!title || title.length > 240 || !description || description.length > 5000) return [];
    tasks.set(taskKey(title, description), { title, description });
  }
  return [...tasks.values()];
}

export function approvedTaskWriter({ companyId, agentId, saveTask = createNativeVoiceTask }) {
  const writes = new Map();
  return async (sessionId, proposalId, tasks) => {
    const results = await Promise.all(tasks.map(({ title, description }, index) => {
      const key = taskKey(title, description);
      const previous = writes.get(key);
      if (previous) return previous;
      // Keep uncertain results as well. A save may have committed before a network error.
      const result = Promise.resolve().then(() => saveTask({
        companyId, agentId, title, description, idempotencyKey: `voice:${sessionId}:${proposalId}:${index}`,
      })).catch(() => ({ status: 'unknown' }));
      writes.set(key, result);
      return result;
    }));
    const identifiers = [...new Set(results.filter(result => result.status === 'created').map(result => result.identifier))];
    return { identifiers, unknownCount: results.filter(result => result.status !== 'created').length };
  };
}
