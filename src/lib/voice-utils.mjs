/** Pure, platform-independent helpers. Neither text nor audio is logged. */
export const MAX_AUDIO_BYTES = 2 * 1024 * 1024;
export const MAX_AUDIO_BASE64_CHARS = Math.ceil(MAX_AUDIO_BYTES / 3) * 4 + 4;
export const ALLOWED_AUDIO_MIMES = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/wav', 'audio/x-wav'];
export const DEFAULT_VOICE_PRESET = 'Use saved voice ID';
export const VOICE_LANGUAGES = Object.freeze({ de: 'Deutsch', en: 'English', nl: 'Nederlands', no: 'Norsk (bokmål)' });
export const GERMAN_VOICE_PRESETS = Object.freeze({
  [DEFAULT_VOICE_PRESET]: null,
  Thorsten: 'de_DE-thorsten-medium',
  Kerstin: 'de_DE-kerstin-low',
});
export const OTHER_VOICE_PRESETS = Object.freeze({
  en: { setting: 'englishVoicePreset', title: 'English voice', default: 'Lessac', voices: { Lessac: 'en_US-lessac-medium', Cori: 'en_GB-cori-medium' } },
  nl: { setting: 'dutchVoicePreset', title: 'Dutch voice', default: 'Alex', voices: { Alex: 'nl_NL-alex-medium', Nathalie: 'nl_BE-nathalie-medium' } },
  no: { setting: 'norwegianVoicePreset', title: 'Norwegian Bokmål voice', default: 'Talesyntese', voices: { Talesyntese: 'no_NO-talesyntese-medium', NVCC: 'no_NO-nvcc-medium' } },
});
const DEFAULTS = Object.freeze({
  backend: 'python',
  voiceboxUrl: 'http://127.0.0.1:8790',
  language: 'de',
  voice: 'de_DE-thorsten-medium',
  voicePreset: DEFAULT_VOICE_PRESET,
  ...Object.fromEntries(Object.values(OTHER_VOICE_PRESETS).map(preset => [preset.setting, preset.default])),
  maxSpokenChars: 380,
  speechRate: 1,
});

export function isVoiceLanguage(value) {
  return typeof value === 'string' && Object.hasOwn(VOICE_LANGUAGES, value);
}

export function voiceForLanguage(config, language) {
  if (language === 'de') return config.voice;
  const preset = OTHER_VOICE_PRESETS[language];
  return preset.voices[config[preset.setting]];
}

export function assertLocalVoiceboxUrl(value) {
  const u = new URL(value);
  if (u.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) {
    throw new Error('Voicebox URL must use local HTTP loopback (not a remote address).');
  }
  if (u.username || u.password || u.search || u.hash || u.pathname !== '/') {
    throw new Error('Voicebox URL must not include credentials, a path, query or fragment.');
  }
  if (!u.port || Number(u.port) < 1024 || Number(u.port) > 65535) {
    throw new Error('Voicebox URL must specify an unprivileged loopback port.');
  }
  return u.origin;
}

export function parseConfig(raw = {}) {
  const config = { ...DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) };
  if (!['python', 'voicebox'].includes(config.backend)) throw new Error('Invalid audio backend');
  for (const key of ['sttPython', 'sttModelDir', 'ttsPython', 'ttsModelDir', 'windowsSystemRoot', 'moonshinePython', 'moonshineModelDir']) if (config[key] !== undefined && typeof config[key] !== 'string') throw new Error('Invalid local runtime setting');
  config.voiceboxUrl = assertLocalVoiceboxUrl(config.voiceboxUrl);
  if (!isVoiceLanguage(config.language)) throw new Error('Invalid speech language');
  if (typeof config.voicePreset !== 'string' || !Object.hasOwn(GERMAN_VOICE_PRESETS, config.voicePreset)) throw new Error('Invalid German voice preset');
  if (!/^[a-z]{2}_[A-Z]{2}-[a-zA-Z0-9_-]{2,80}$/.test(config.voice)) throw new Error('Invalid Piper voice identifier');
  config.voice = GERMAN_VOICE_PRESETS[config.voicePreset] ?? config.voice;
  for (const preset of Object.values(OTHER_VOICE_PRESETS)) {
    const selected = config[preset.setting];
    if (typeof selected !== 'string' || !Object.hasOwn(preset.voices, selected)) throw new Error(`Invalid ${preset.title} preset`);
  }
  if (!Number.isInteger(config.maxSpokenChars) || config.maxSpokenChars < 120 || config.maxSpokenChars > 1000) throw new Error('maxSpokenChars out of range');
  if (typeof config.speechRate !== 'number' || config.speechRate < 0.7 || config.speechRate > 1.5) throw new Error('speechRate out of range');
  return config;
}

export function normaliseAudioMime(raw) {
  const value = typeof raw === 'string' ? raw.split(';')[0].trim().toLowerCase() : '';
  if (!ALLOWED_AUDIO_MIMES.includes(value)) throw new Error('Unsupported audio type. Use webm, ogg, mp4 or wav.');
  return value;
}

export function extensionForMime(mime) {
  return ({ 'audio/webm': '.webm', 'audio/ogg': '.ogg', 'audio/mp4': '.m4a', 'audio/wav': '.wav', 'audio/x-wav': '.wav' })[mime] ?? '.bin';
}

export function decodeBase64Audio(value) {
  if (typeof value !== 'string' || !value.length || value.length > MAX_AUDIO_BASE64_CHARS || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error('Invalid or oversized base64 audio.');
  }
  const bytes = Buffer.from(value, 'base64');
  if (!bytes.length || bytes.length > MAX_AUDIO_BYTES) throw new Error('Audio exceeds the 2 MiB limit.');
  return bytes;
}

const SPOKEN_NOTICES = {
  de: ['technischer Code im Chat', 'Link im Chat', 'Tabelle im Chat', 'Weitere Details stehen im Paperclip-Chat.'],
  en: ['code in the chat', 'link in the chat', 'table in the chat', 'More details are in the Paperclip chat.'],
  nl: ['code in de chat', 'link in de chat', 'tabel in de chat', 'Meer details staan in de Paperclip-chat.'],
  no: ['kode i chatten', 'lenke i chatten', 'tabell i chatten', 'Du finner flere detaljer i Paperclip-chatten.'],
};

/** Keep the authoritative long-form answer untouched in Paperclip; only shorten speech. */
export function cleanSpokenText(raw, limit = DEFAULTS.maxSpokenChars, language = 'de') {
  const source = String(raw ?? '');
  const [codeNotice, linkNotice, tableNotice, moreDetails] = SPOKEN_NOTICES[language] ?? SPOKEN_NOTICES.de;
  const text = source
    .replace(/```[\s\S]*?```/g, ` (${codeNotice}) `)
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ` (${linkNotice}) `)
    .replace(/^\s*\|.*\|\s*$/gm, ` (${tableNotice}) `)
    .replace(/^\s*#{1,6}\s*/gm, '')
    .replace(/^\s*(?:[-*+] |\d+\. )/gm, '')
    .replace(/[\*_`~]/g, '')
    .replace(/\s+/g, ' ').trim();
  if (text.length <= limit) return { text, truncated: false };
  const head = text.slice(0, limit);
  const stop = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '));
  const boundary = stop > Math.floor(limit * 0.4) ? stop + 1 : head.lastIndexOf(' ');
  const excerpt = head.slice(0, boundary > limit * 0.5 ? boundary : limit).trim();
  return { text: `${excerpt} ${moreDetails}`, truncated: true };
}

const CONCISE_VOICE_HINTS = {
  de: '[Sprachmodus: Antworte hier möglichst in ein bis drei kurzen Sätzen. Vollständige Arbeitsergebnisse und wichtige Details bitte in den regulären Aufgaben dokumentieren.]',
  en: '[Voice mode: Reply in English in one to three short sentences where possible. Record full results and important details in the regular tasks.]',
  nl: '[Spraakmodus: Antwoord zo mogelijk in één tot drie korte zinnen in het Nederlands. Leg volledige resultaten en belangrijke details vast in de reguliere taken.]',
  no: '[Talemodus: Svar på norsk bokmål med én til tre korte setninger hvis mulig. Dokumenter fullstendige resultater og viktige detaljer i de vanlige oppgavene.]',
};

/** Explicit, per-turn user instruction; not a permanent agent prompt or separate conversation. */
export function voiceMessage(text, concise = true, language = 'de') {
  const t = String(text ?? '').trim();
  if (!t || t.length > 5000) throw new Error('Voice transcript is empty or too long');
  if (!concise) return t;
  return `${t}\n\n${CONCISE_VOICE_HINTS[language] ?? CONCISE_VOICE_HINTS.de}`;
}

/** Derive current Paperclip destination without mutating the host route. */
export function routeTarget(pathname) {
  const path = String(pathname ?? '').split('?')[0].split('#')[0];
  const issue = path.match(/\/issues\/([a-z0-9][a-z0-9-]{0,127})(?:\/|$)/i);
  if (issue) return { kind: 'issue', ref: issue[1] };
  const chat = path.match(/\/chats\/([^/]+)(?:\/|$)/i);
  if (chat && chat[1]) {
    try { return { kind: 'chat', ref: decodeURIComponent(chat[1]) }; }
    catch { return null; }
  }
  return null;
}

export function voiceSessionTarget(pathname, companyId, issueId, storage = undefined) {
  if (issueId) return { kind: 'issue', ref: issueId };
  const route = routeTarget(pathname);
  if (route?.kind === 'issue' || !companyId) return route;
  try {
    const agent = (storage ?? globalThis.sessionStorage).getItem(`paperclip-voice:last-agent:${companyId}`);
    if (agent && /^[a-z0-9_-]{1,128}$/i.test(agent)) return { kind: 'chat', ref: agent };
  } catch { /* The browser may block session storage. */ }
  return route;
}

export function rememberVoiceAgent(companyId, agentRef, storage = undefined) {
  if (!companyId) return;
  const key = `paperclip-voice:last-agent:${companyId}`;
  try {
    const session = storage ?? globalThis.sessionStorage;
    if (agentRef) session.setItem(key, agentRef);
    else session.removeItem(key);
  } catch { /* The browser may block session storage. */ }
}

export function isAgentComment(comment) {
  return Boolean(comment && (comment.authorAgentId || comment.authorType === 'agent') && !comment.deletedAt && typeof comment.body === 'string' && comment.body.trim());
}

/** VAD state helper; thresholds are dimensionless RMS of WebAudio float samples. */
export const DEFAULT_SPEECH_LEVEL = 0.008;

export function createSpeechDetector(minimumLevel) {
  let noiseFloor = 0.002;
  return (rms, speaking = false) => {
    const threshold = Math.max(minimumLevel(), noiseFloor * 1.8 + 0.002);
    const loud = rms >= threshold * (speaking ? 0.8 : 1);
    if (!speaking && !loud) noiseFloor += (rms - noiseFloor) * 0.2;
    return loud;
  };
}

export function vadDecision({ rms = 0, elapsedMs, silenceMs, spoke, threshold = 0.025, speech = rms >= threshold, minMs = 450, endSilenceMs = 1250, maxMs = 26000 }) {
  const nextSpoke = spoke || speech;
  const nextSilence = speech ? 0 : (spoke ? silenceMs : 0);
  const stop = elapsedMs >= maxMs || (elapsedMs >= minMs && nextSpoke && nextSilence >= endSilenceMs);
  return { spoke: nextSpoke, silenceMs: nextSilence, stop };
}
