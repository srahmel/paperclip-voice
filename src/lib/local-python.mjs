import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeBase64Audio, normaliseAudioMime } from './voice-utils.mjs';

export function packageRoot() {
  let root = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++, root = dirname(root)) {
    try { if (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).name === 'paperclip-plugin-voice') return root; } catch {}
  }
  throw new Error('Voice plugin package is unavailable');
}

export function audioWorkerEnvironment(env = {}) {
  const inherited = Object.fromEntries(['SystemRoot', 'WINDIR', 'PATH', 'TEMP', 'TMP'].filter(k => process.env[k]).map(k => [k, process.env[k]]));
  return { ...inherited, ...env, PYTHONNOUSERSITE: '1', PYTHONIOENCODING: 'utf-8', HF_HUB_OFFLINE: '1', OMP_NUM_THREADS: '4', OPENBLAS_NUM_THREADS: '1' };
}

export function localRuntime(config = {}, env = process.env) {
  const root = packageRoot();
  return {
    sttPython: config.sttPython || env.PAPERCLIP_VOICE_PYTHON,
    ttsPython: config.ttsPython || env.PAPERCLIP_TTS_PYTHON,
    sttModelDir: config.sttModelDir || env.PAPERCLIP_VOICE_MODEL,
    ttsModelDir: config.ttsModelDir || env.PAPERCLIP_TTS_MODEL_DIR,
    systemRoot: config.windowsSystemRoot || env.SystemRoot || env.WINDIR,
    transcriber: join(root, 'dictation', 'transcribe.py'),
    synthesizer: join(root, 'dictation', 'synthesize.py'),
  };
}

export function localAudioReady(config = {}) {
  const r = localRuntime(config);
  if (process.platform === 'win32' && (!r.systemRoot || !existsSync(r.systemRoot))) return false;
  return [r.sttPython, r.ttsPython, r.sttModelDir, r.ttsModelDir, r.transcriber, r.synthesizer]
    .every(path => typeof path === 'string' && existsSync(path));
}

export function runAudioWorker({ executable, script, args = [], input, env = {}, signal, timeoutMs = 180_000, maxBytes = 6 * 1024 * 1024 }) {
  if (signal?.aborted) return Promise.reject(new Error('Audio job cancelled'));
  if (!executable || !script) return Promise.reject(new Error('Local audio runtime is not configured'));
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [script, ...args], {
      shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'],
      env: audioWorkerEnvironment(env),
    });
    const chunks = [];
    let size = 0, stopped = false;
    const stop = () => { stopped = true; child.kill(); };
    const timer = setTimeout(stop, timeoutMs);
    signal?.addEventListener('abort', stop, { once: true });
    if (signal?.aborted) stop();
    child.stdout.on('data', chunk => { size += chunk.length; if (size > maxBytes) stop(); else chunks.push(chunk); });
    child.stdin.on('error', () => {});
    child.once('error', () => { clearTimeout(timer); signal?.removeEventListener('abort', stop); reject(new Error('Local audio process could not start')); });
    child.once('close', code => {
      clearTimeout(timer); signal?.removeEventListener('abort', stop);
      if (stopped || code !== 0) reject(new Error('Local audio processing stopped or failed'));
      else resolve(Buffer.concat(chunks));
    });
    child.stdin.end(input);
  });
}

export async function transcribeWithPython({ config, language, audioBase64, mimeType, signal }) {
  const r = localRuntime(config);
  const mime = normaliseAudioMime(mimeType);
  if (!['de', 'en', 'auto'].includes(language) || !r.sttModelDir) throw new Error('Invalid transcription settings');
  const format = { 'audio/webm': 'matroska', 'audio/ogg': 'ogg', 'audio/mp4': 'mov', 'audio/wav': 'wav', 'audio/x-wav': 'wav' }[mime];
  const bytes = await runAudioWorker({ executable: r.sttPython, script: r.transcriber,
    args: [language, format], input: decodeBase64Audio(audioBase64), signal,
    env: { PAPERCLIP_VOICE_MODEL: r.sttModelDir, ...(r.systemRoot ? { SystemRoot: r.systemRoot, WINDIR: r.systemRoot } : {}) }, maxBytes: 100_000 });
  const result = JSON.parse(bytes.toString('utf8'));
  if (typeof result.text !== 'string' || result.text.length > 5000) throw new Error('Invalid transcription result');
  return result.text.trim();
}

export async function synthesizeWithPython({ config, language, voice, speechRate, text, signal }) {
  const r = localRuntime(config);
  if (!['de', 'en'].includes(language) || !text?.trim() || text.length > 2500 || !r.ttsModelDir) throw new Error('Invalid speech settings');
  const bytes = await runAudioWorker({ executable: r.ttsPython, script: r.synthesizer,
    input: JSON.stringify({ text, language, voice, speed: speechRate }), signal, timeoutMs: 90_000,
    env: { PAPERCLIP_TTS_MODEL_DIR: r.ttsModelDir, ...(r.systemRoot ? { SystemRoot: r.systemRoot, WINDIR: r.systemRoot } : {}) } });
  if (bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Invalid speech audio');
  return { audioBase64: bytes.toString('base64'), mime: 'audio/wav', bytes: bytes.length };
}
