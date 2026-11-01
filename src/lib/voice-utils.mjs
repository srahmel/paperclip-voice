/** Pure, platform-independent helpers. Neither text nor audio is logged. */
export const MAX_AUDIO_BYTES = 2 * 1024 * 1024;
export const MAX_AUDIO_BASE64_CHARS = Math.ceil(MAX_AUDIO_BYTES / 3) * 4 + 4;
export const ALLOWED_AUDIO_MIMES = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/wav', 'audio/x-wav'];
const DEFAULTS = Object.freeze({
  voiceboxUrl: 'http://127.0.0.1:8790',
  language: 'de',
  voice: 'de_DE-thorsten-medium',
  maxSpokenChars: 380,
  speechRate: 1,
});

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
  config.voiceboxUrl = assertLocalVoiceboxUrl(config.voiceboxUrl);
  if (!['de', 'en'].includes(config.language)) throw new Error('language must be de or en');
  if (!/^[a-z]{2}_[A-Z]{2}-[a-zA-Z0-9_-]{2,80}$/.test(config.voice)) throw new Error('Invalid Piper voice identifier');
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

/** Keep the authoritative long-form answer untouched in Paperclip; only shorten speech. */
export function cleanSpokenText(raw, limit = DEFAULTS.maxSpokenChars) {
  const source = String(raw ?? '');
  const text = source
    .replace(/```[\s\S]*?```/g, ' (technischer Code im Chat) ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' (Link im Chat) ')
    .replace(/^\s*\|.*\|\s*$/gm, ' (Tabelle im Chat) ')
    .replace(/^\s*#{1,6}\s*/gm, '')
    .replace(/^\s*(?:[-*+] |\d+\. )/gm, '')
    .replace(/[\*_`~]/g, '')
    .replace(/\s+/g, ' ').trim();
  if (text.length <= limit) return { text, truncated: false };
  const head = text.slice(0, limit);
  const stop = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '));
  const boundary = stop > Math.floor(limit * 0.4) ? stop + 1 : head.lastIndexOf(' ');
  const excerpt = head.slice(0, boundary > limit * 0.5 ? boundary : limit).trim();
  return { text: `${excerpt} Weitere Details stehen im Paperclip-Chat.`, truncated: true };
}

/** Explicit, per-turn user instruction; not a permanent agent prompt or separate conversation. */
export function voiceMessage(text, concise = true) {
  const t = String(text ?? '').trim();
  if (!t || t.length > 5000) throw new Error('Voice transcript is empty or too long');
  if (!concise) return t;
  return `${t}\n\n[Sprachmodus: Antworte hier möglichst in ein bis drei kurzen Sätzen. Vollständige Arbeitsergebnisse und wichtige Details bitte in den regulären Aufgaben dokumentieren.]`;
}

/** Derive current Paperclip destination without mutating the host route. */
export function routeTarget(pathname) {
  const path = String(pathname ?? '').split('?')[0].split('#')[0];
  const issue = path.match(/\/issues\/([0-9a-f-]{36})(?:\/|$)/i);
  if (issue) return { kind: 'issue', ref: issue[1] };
  const chat = path.match(/\/chats\/([^/]+)(?:\/|$)/i);
  if (chat && chat[1]) {
    try { return { kind: 'chat', ref: decodeURIComponent(chat[1]) }; }
    catch { return null; }
  }
  return null;
}

export function isAgentComment(comment) {
  return Boolean(comment && (comment.authorAgentId || comment.authorType === 'agent') && !comment.deletedAt && typeof comment.body === 'string' && comment.body.trim());
}

/** VAD state helper; thresholds are dimensionless RMS of WebAudio float samples. */
export function vadDecision({ rms, elapsedMs, silenceMs, spoke, threshold = 0.025, minMs = 450, endSilenceMs = 1250, maxMs = 26000 }) {
  const speech = rms >= threshold;
  const nextSpoke = spoke || speech;
  const nextSilence = speech ? 0 : (spoke ? silenceMs : 0);
  const stop = elapsedMs >= maxMs || (elapsedMs >= minMs && nextSpoke && nextSilence >= endSilenceMs);
  return { spoke: nextSpoke, silenceMs: nextSilence, stop };
}
