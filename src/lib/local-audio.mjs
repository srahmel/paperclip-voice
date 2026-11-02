// The browser uses Paperclip's authenticated, same-origin local audio routes.
// No audio or transcript is written to logs by this client.
export async function transcribeLocal(companyId, audio, language = 'auto', doFetch = fetch) {
  if (!companyId || !(audio instanceof Blob) || !audio.size || audio.size > 2 * 1024 * 1024) throw new Error('Ungültige Audioaufnahme.');
  const response = await doFetch(`/api/companies/${encodeURIComponent(companyId)}/local-dictation`, {
    method: 'POST', credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(185000),
    headers: { 'Content-Type': audio.type || 'audio/webm', 'X-Dictation-Language': language }, body: audio,
  });
  if (response.status === 404) throw new Error('Der lokale Transkriptions-Endpunkt fehlt. Bitte die Paperclip-Voice-Installation prüfen.');
  if (response.status === 401 || response.status === 403) throw new Error('Keine Berechtigung für die lokale Transkription. Bitte in Paperclip anmelden.');
  if (response.status === 429) throw new Error('Die lokale Transkription ist gerade belegt. Bitte später erneut versuchen.');
  if (!response.ok) throw new Error('Lokale Transkription nicht verfügbar. Bitte Sprachlaufzeit und Modell prüfen.');
  const result = await response.json();
  return typeof result.text === 'string' ? result.text.trim() : '';
}

export async function speakLocal(companyId, text, language = 'de', doFetch = fetch) {
  if (!companyId || !text?.trim()) throw new Error('Kein Text zum Vorlesen.');
  const response = await doFetch(`/api/companies/${encodeURIComponent(companyId)}/local-speech`, {
    method: 'POST', credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(95000),
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: text.slice(0, 4000), language }),
  });
  if (response.status === 404) throw new Error('Der lokale Sprachausgabe-Endpunkt fehlt. Bitte die Paperclip-Voice-Installation prüfen.');
  if (response.status === 401 || response.status === 403) throw new Error('Keine Berechtigung für die lokale Sprachausgabe. Bitte in Paperclip anmelden.');
  if (response.status === 429) throw new Error('Die lokale Sprachausgabe ist gerade belegt.');
  if (!response.ok) throw new Error('Lokale Sprachausgabe nicht verfügbar. Bitte Sprachlaufzeit und Stimme prüfen.');
  return response.arrayBuffer();
}
