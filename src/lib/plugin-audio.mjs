// UI-side transport for bounded, asynchronous Paperclip plugin audio actions.
// Speech bytes cross Paperclip's authenticated plugin bridge, never a public audio port.
export async function audioBlobToBase64(blob) {
  if (!(blob instanceof Blob) || !blob.size || blob.size > 2 * 1024 * 1024) {
    throw new Error('Audioaufnahme ist leer oder größer als 2 MiB.');
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let raw = '';
  for (let i = 0; i < bytes.length; i += 16_384) raw += String.fromCharCode(...bytes.subarray(i, i + 16_384));
  return btoa(raw);
}

export function audioBase64ToBuffer(value) {
  if (typeof value !== 'string' || value.length > 9_000_000) throw new Error('Invalid audio response');
  const raw = atob(value);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes.buffer;
}

export async function waitForVoiceJob(start, poll, params, active, {
  intervalMs = 1000,
  timeoutMs = 160_000,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  if (!active()) throw new Error('Voice session ended');
  const started = await start(params);
  if (typeof started?.jobId !== 'string' || !started.jobId) throw new Error('Plugin did not create an audio job');
  const deadline = Date.now() + timeoutMs;
  while (active()) {
    const status = await poll({ companyId: params.companyId, jobId: started.jobId });
    if (!active()) break;
    if (status?.status === 'ready') return status.result;
    if (status?.status === 'error') throw new Error(status.error || 'Local audio processing failed');
    if (status?.status !== 'pending') throw new Error('Invalid audio job state');
    if (Date.now() >= deadline) throw new Error('Local audio processing exceeded the allowed time');
    await sleep(intervalMs);
  }
  throw new Error('Voice session ended');
}
