import { decodeBase64Audio, extensionForMime, normaliseAudioMime, cleanSpokenText } from './voice-utils.mjs';

export async function transcribeWithVoicebox({ baseUrl, language, audioBase64, mimeType, timeoutMs = 45000, doFetch = fetch }) {
  const mime = normaliseAudioMime(mimeType);
  const bytes = decodeBase64Audio(audioBase64);
  const form = new FormData();
  form.set('file', new Blob([bytes], { type: mime }), `utterance${extensionForMime(mime)}`);
  form.set('model', 'stt');
  form.set('language', language);
  const res = await doFetch(`${baseUrl}/v1/audio/transcriptions`, {
    method: 'POST', body: form, signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Local STT returned HTTP ${res.status}`);
  const json = await res.json();
  const text = typeof json?.text === 'string' ? json.text.trim() : '';
  if (text.length > 5000) throw new Error('Transcription exceeds maximum text length');
  return text;
}

export async function synthesizeWithVoicebox({ baseUrl, voice, speechRate, text, timeoutMs = 45000, doFetch = fetch }) {
  const safeText = String(text ?? '');
  if (!safeText || safeText.length > 2500) throw new Error('Invalid TTS text');
  const res = await doFetch(`${baseUrl}/v1/audio/speech`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'tts', input: safeText, voice, speed: speechRate, response_format: 'wav' }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Local TTS returned HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > 6 * 1024 * 1024) throw new Error('TTS output exceeds 6 MiB limit');
  return { audioBase64: bytes.toString('base64'), mime: 'audio/wav', bytes: bytes.length };
}

export async function voiceboxHealth({ baseUrl, doFetch = fetch }) {
  const res = await doFetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(3500) });
  if (!res.ok) throw new Error(`Voicebox HTTP ${res.status}`);
  const data = await res.json();
  return data?.status === 'ok';
}

export function spokenComment(body, maxSpokenChars) {
  return cleanSpokenText(body, maxSpokenChars);
}
