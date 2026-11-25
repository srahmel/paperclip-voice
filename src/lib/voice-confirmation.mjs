export const MAX_CONFIRMATION_CHARS = 800;
export const CONFIRMATION_TIMEOUT_MS = 30_000;

const CONFIRMATION = {
  de: {
    yes: ['ja', 'ja bitte', 'ja starten', 'ja bitte starten', 'ja senden'],
    no: ['nein', 'nein danke', 'abbrechen', 'verwerfen'],
    corrections: ['korrektur', 'ich meinte'],
    heard: 'Ich habe verstanden.',
    ask: 'Soll ich das senden? Sag Ja, senden, oder Nein.',
    retry: 'Sag Ja zum Senden, Nein zum Verwerfen oder Korrektur und die neue Nachricht.',
    cancelled: 'Entwurf verworfen.',
    accepted: 'Nachricht gesendet.',
    too_long: 'Die Nachricht ist zu lang zum Vorlesen. Bitte sage sie kürzer.',
    created: 'Aufgabe angelegt.',
  },
  en: {
    yes: ['yes', 'yes please', 'yes start', 'yes please start', 'yes send it'],
    no: ['no', 'no thanks', 'cancel', 'discard'],
    corrections: ['correction', 'i meant'],
    heard: 'I heard.',
    ask: 'Shall I send that? Say yes or no.',
    retry: 'Say yes to send, no to discard, or correction followed by the new request.',
    cancelled: 'Draft discarded.',
    accepted: 'Message sent.',
    too_long: 'The request is too long to read back. Please say it more briefly.',
    created: 'Task created.',
  },
  nl: {
    yes: ['ja', 'ja graag', 'ja start', 'ja starten', 'ja versturen'],
    no: ['nee', 'nee bedankt', 'annuleren', 'verwerpen'],
    corrections: ['correctie', 'ik bedoelde'],
    heard: 'Ik heb verstaan.',
    ask: 'Zal ik dat versturen? Zeg ja of nee.',
    retry: 'Zeg ja om te versturen, nee om te annuleren, of correctie gevolgd door het nieuwe verzoek.',
    cancelled: 'Concept verwijderd.',
    accepted: 'Bericht verstuurd.',
    too_long: 'Het verzoek is te lang om voor te lezen. Zeg het korter, alsjeblieft.',
    created: 'Taak aangemaakt.',
  },
  no: {
    yes: ['ja', 'ja takk', 'ja start', 'ja takk start', 'ja send'],
    no: ['nei', 'nei takk', 'avbryt', 'forkast'],
    corrections: ['rettelse', 'jeg mente'],
    heard: 'Jeg hørte.',
    ask: 'Skal jeg sende det? Si ja eller nei.',
    retry: 'Si ja for å sende, nei for å forkaste, eller rettelse etterfulgt av den nye forespørselen.',
    cancelled: 'Utkastet er forkastet.',
    accepted: 'Meldingen er sendt.',
    too_long: 'Forespørselen er for lang til å lese opp. Si den kortere, er du snill.',
    created: 'Oppgaven er opprettet.',
  },
};

export function voiceConfirmationDecision(text, language) {
  const words = CONFIRMATION[language] ?? CONFIRMATION.de;
  const command = text.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (words.yes.includes(command)) return { kind: 'approve', text: '' };
  if (words.no.includes(command)) return { kind: 'discard', text: '' };
  for (const prefix of words.corrections) {
    const match = text.trim().match(new RegExp(`^${prefix}(?:[\\s,:;.!?]+)(.+)$`, 'isu'));
    if (match?.[1].trim()) return { kind: 'correct', text: match[1].trim() };
  }
  return { kind: 'unclear', text: '' };
}

export function voiceConfirmationPrompt(text, language) {
  const draft = text.trim();
  if (!draft || draft.length > MAX_CONFIRMATION_CHARS) throw new Error('Invalid voice confirmation transcript');
  const words = CONFIRMATION[language] ?? CONFIRMATION.de;
  return `${words.heard} ${draft}${/[.!?]$/.test(draft) ? '' : '.'} ${words.ask}`;
}

export function voiceConfirmationStatus(key, language) {
  const words = CONFIRMATION[language] ?? CONFIRMATION.de;
  return ['retry', 'cancelled', 'accepted', 'too_long', 'created'].includes(key) ? words[key] : undefined;
}

const TASK_RECEIPT = /^\s*Task created:\s*([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\s*$/im;

export function extractVoiceTaskReceipt(body) {
  const match = body.match(TASK_RECEIPT);
  return { taskId: match?.[1], text: match ? body.replace(TASK_RECEIPT, '').trim() : body };
}
