import { registerVoiceCapture } from './voice-capture-worklet.js';
import { createSpeechDetector } from '../lib/voice-utils.mjs';

type Frame = { data: ArrayBuffer; rms: number };
type Action = (params: Record<string, unknown>) => Promise<unknown>;

const FRAME_BYTES = 3200;
const CHUNK_FRAMES = 4;
const MAX_QUEUED_FRAMES = 20;

export async function startLocalConversation(options: {
  context: AudioContext;
  input: MediaStreamAudioSourceNode;
  companyId: string;
  start: Action;
  update: Action;
  active: () => boolean;
  canListen: () => boolean;
  threshold: () => number;
  onLevel: (rms: number) => void;
  onStartSpeech: () => void;
  onEndSpeech: () => void;
  onText: (text: string) => void;
  onError: (error: unknown) => void;
}): Promise<() => void> {
  const { context, input, companyId, start, update } = options;
  if (!context.audioWorklet || context.sampleRate < 16_000) throw new Error('Dieser Browser unterstützt die lokale Live-Erkennung nicht.');
  // Paperclip loads the UI as a blob module, with no stable sibling asset URL.
  const moduleUrl = URL.createObjectURL(new Blob([`(${registerVoiceCapture.toString()})();`], { type: 'text/javascript' }));
  try { await context.audioWorklet.addModule(moduleUrl); }
  finally { URL.revokeObjectURL(moduleUrl); }
  if (!options.active()) return () => {};
  const result = await start({ companyId }) as { streamId?: string };
  const streamId = result?.streamId;
  if (!streamId) throw new Error('Die lokale Live-Erkennung konnte nicht gestartet werden.');
  const send = (command: string, payload: Record<string, unknown> = {}) => update({ companyId, streamId, command, ...payload });
  if (!options.active()) { void send('stop').catch(() => undefined); return () => {}; }

  let node: AudioWorkletNode | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let inputWatch: ReturnType<typeof setInterval> | undefined;
  let lastFrameAt = performance.now();
  let stopped = false;
  let sending = false;
  let speaking = false;
  let finishing = false;
  let quietFrames = 0;
  let speechFrames = 0;
  let consecutiveLoud = 0;
  const queue: ArrayBuffer[] = [];
  const preroll: ArrayBuffer[] = [];
  const detectsSpeech = createSpeechDetector(options.threshold);

  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(heartbeat);
    clearInterval(inputWatch);
    if (node) {
      try { input.disconnect(node); } catch { /* The input may not have connected. */ }
      node.disconnect();
      node.port.close();
    }
    queue.length = 0;
    preroll.length = 0;
    void send('stop').catch(() => undefined);
  };
  const fail = (error: unknown) => {
    stop();
    if (options.active()) options.onError(error);
  };

  async function flush(): Promise<void> {
    if (stopped || sending) return;
    sending = true;
    try {
      while (!stopped && (queue.length >= CHUNK_FRAMES || (finishing && queue.length))) {
        const frames = queue.splice(0, CHUNK_FRAMES);
        const pcm = new Uint8Array(frames.length * FRAME_BYTES);
        frames.forEach((frame, index) => pcm.set(new Uint8Array(frame), index * FRAME_BYTES));
        const audioBase64 = btoa(String.fromCharCode(...pcm));
        const result = await send('audio', { audioBase64 }) as { accepted?: boolean };
        if (result?.accepted !== true) throw new Error('Ein Audioblock konnte nicht verarbeitet werden.');
      }
      if (!stopped && finishing) {
        const result = await send('finish') as { text?: string };
        if (typeof result?.text !== 'string') throw new Error('Die Live-Erkennung hat kein gültiges Ergebnis geliefert.');
        if (!stopped && options.active()) {
          finishing = false;
          options.onText(result.text.trim());
        }
      }
    } catch (error) { fail(error); }
    finally { sending = false; }
  }

  function capture({ data, rms }: Frame) {
    lastFrameAt = performance.now();
    if (stopped || finishing || !options.active() || !options.canListen()) {
      preroll.length = 0;
      consecutiveLoud = 0;
      return;
    }
    options.onLevel(rms);
    const loud = detectsSpeech(rms, speaking);
    if (!speaking) {
      preroll.push(data);
      if (preroll.length > 3) preroll.shift();
      consecutiveLoud = loud ? consecutiveLoud + 1 : 0;
      if (consecutiveLoud < 2) return;
      speaking = true;
      speechFrames = preroll.length;
      quietFrames = 0;
      queue.push(...preroll.splice(0));
      options.onStartSpeech();
    } else {
      speechFrames++;
      quietFrames = loud ? 0 : quietFrames + 1;
      queue.push(data);
    }
    if (queue.length > MAX_QUEUED_FRAMES) { fail(new Error('Die Audioverbindung ist zu langsam. Bitte den Sprachmodus neu starten.')); return; }
    if (quietFrames >= 6 || speechFrames >= 260) {
      speaking = false;
      finishing = true;
      consecutiveLoud = 0;
      options.onEndSpeech();
    }
    void flush();
  }

  try {
    node = new AudioWorkletNode(context, 'paperclip-voice-capture', { channelCount: 1, channelCountMode: 'explicit' });
    node.port.onmessage = event => capture(event.data as Frame);
    node.onprocessorerror = () => fail(new Error('Die Mikrofonaufnahme wurde unterbrochen.'));
    input.connect(node);
    // The worklet deliberately emits silence while the graph pulls microphone frames.
    node.connect(context.destination);
    inputWatch = setInterval(() => {
      if (performance.now() - lastFrameAt > 4000) fail(new Error('Das Mikrofon liefert keine Audiodaten. Prüfe das ausgewählte Mikrofon und starte erneut.'));
    }, 1000);
    heartbeat = setInterval(() => { if (!sending) void send('keepalive').catch(fail); }, 30_000);
  } catch (error) { stop(); throw error; }
  return stop;
}
