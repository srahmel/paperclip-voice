import { realtimeTaskHandler } from '../lib/realtime-task.mjs';

type Phase = 'listening' | 'capturing' | 'thinking' | 'saving' | 'speaking';
type Action = (params: Record<string, unknown>) => Promise<unknown>;
type EventItem = { type?: string; name?: string; call_id?: string; arguments?: string };
type RealtimeEvent = {
  type?: string;
  transcript?: string;
  response?: { status?: string; output?: EventItem[] };
};

export function startRealtimeConversation(options: {
  companyId: string;
  agentId: string;
  language: string;
  connect: Action;
  disconnect: Action;
  onPhase: (phase: Phase) => void;
  onMicLevel: (level: number) => void;
  onReply: (text: string) => void;
  onTask: (identifier: string) => void;
  onError: (error: unknown) => void;
  onPlaybackBlocked: (blocked: boolean) => void;
  waitCue: () => Promise<void>;
}) {
  const { companyId, agentId, language } = options;
  const task = realtimeTaskHandler({ companyId, agentId });
  const audio = new Audio();
  audio.autoplay = true;
  audio.setAttribute('playsinline', '');
  const pc = new RTCPeerConnection();
  const channel = pc.createDataChannel('oai-events');
  const seen = new Set<string>();
  let stream: MediaStream | undefined;
  let sessionId: string | undefined;
  let disconnected: ReturnType<typeof setTimeout> | undefined;
  let meter: ReturnType<typeof setInterval> | undefined;
  let meterContext: AudioContext | undefined;
  let stopped = false;
  let talking = false;
  let responding = false;
  let waitingForTool = 0;
  let speechTurns = 0;
  const startup = setTimeout(() => fail(new Error('Die Audioverbindung konnte nicht rechtzeitig starten.')), 30_000);

  function release(id: string) {
    void options.disconnect({ companyId, sessionId: id }).catch(() => undefined);
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    clearTimeout(startup);
    clearTimeout(disconnected);
    clearInterval(meter);
    void meterContext?.close().catch(() => undefined);
    stream?.getTracks().forEach(track => track.stop());
    channel.close();
    pc.close();
    audio.pause();
    audio.srcObject = null;
    if (sessionId) release(sessionId);
  }

  function fail(error: unknown) {
    if (stopped) return;
    stop();
    options.onError(error);
  }

  async function play() {
    if (!audio.srcObject || stopped) return;
    try { await audio.play(); if (!stopped) options.onPlaybackBlocked(false); }
    catch { if (!stopped) options.onPlaybackBlocked(true); }
  }

  function send(event: Record<string, unknown>) {
    if (!stopped && channel.readyState === 'open') channel.send(JSON.stringify(event));
  }

  async function handleTasks(items: EventItem[]) {
    const id = sessionId;
    if (!id || stopped) return;
    const calls = items.filter(item => item.type === 'function_call' && typeof item.call_id === 'string' && !seen.has(item.call_id));
    if (!calls.length) return;
    const turn = speechTurns;
    waitingForTool++;
    options.onPhase('saving');
    let cue: Promise<void> | undefined;
    const timer = setTimeout(() => {
      if (!stopped && speechTurns === turn && !talking) cue = options.waitCue().catch(() => undefined);
    }, 1600);
    try {
      const results = await Promise.all(calls.map(async item => {
        const callId = item.call_id!;
        seen.add(callId);
        const result = item.name !== 'create_task' || typeof item.arguments !== 'string' || talking
          ? { status: 'no_action' }
          : await task(id, callId, item.arguments);
        return { callId, result };
      }));
      clearTimeout(timer);
      await cue;
      if (stopped) return;
      for (const { callId, result } of results) {
        if (result.status === 'created' && 'identifier' in result) options.onTask(result.identifier);
        send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: callId, output: JSON.stringify(result) } });
      }
      if (speechTurns === turn && !talking && !responding) {
        options.onPhase('thinking');
        send({ type: 'response.create' });
      }
    } finally {
      clearTimeout(timer);
      waitingForTool--;
    }
  }

  channel.onopen = () => {
    if (stopped) return;
    clearTimeout(startup);
    stream?.getAudioTracks().forEach(track => { track.enabled = true; });
    options.onPhase('listening');
  };
  channel.onclose = () => fail(new Error('Das Sprachgespräch wurde getrennt.'));
  channel.onerror = () => fail(new Error('Die Verbindung zum Sprachdienst ist gestört.'));
  channel.onmessage = ({ data }) => {
    if (stopped || typeof data !== 'string') return;
    let event: RealtimeEvent;
    try { event = JSON.parse(data); } catch { return; }
    switch (event?.type) {
      case 'input_audio_buffer.speech_started':
        talking = true;
        speechTurns++;
        options.onPhase('capturing');
        break;
      case 'input_audio_buffer.speech_stopped':
        talking = false;
        options.onMicLevel(0);
        options.onPhase('thinking');
        break;
      case 'response.created': responding = true; break;
      case 'output_audio_buffer.started': options.onPhase('speaking'); break;
      case 'output_audio_buffer.stopped':
      case 'output_audio_buffer.cleared':
        if (!talking) options.onPhase(waitingForTool ? 'saving' : 'listening');
        break;
      case 'response.output_audio_transcript.done':
        if (typeof event.transcript === 'string') options.onReply(event.transcript);
        break;
      case 'response.done':
        responding = false;
        if (event.response?.status === 'completed') {
          void handleTasks(event.response.output ?? []).catch(fail);
        } else if (event.response?.status === 'failed' || event.response?.status === 'incomplete') {
          fail(new Error('OpenAI Realtime konnte die Antwort nicht fertigstellen.'));
        }
        break;
      case 'error': fail(new Error('OpenAI Realtime meldet einen Gesprächsfehler.')); break;
    }
  };
  pc.ontrack = event => {
    audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
    void play();
  };
  pc.onconnectionstatechange = () => {
    clearTimeout(disconnected);
    if (pc.connectionState === 'failed') fail(new Error('Die Sprachverbindung ist fehlgeschlagen.'));
    if (pc.connectionState === 'disconnected') {
      disconnected = setTimeout(() => fail(new Error('Die Sprachverbindung wurde unterbrochen.')), 4500);
    }
  };

  async function connect() {
    const media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    if (stopped) { media.getTracks().forEach(track => track.stop()); return; }
    stream = media;
    for (const track of media.getAudioTracks()) {
      track.enabled = false;
      pc.addTrack(track, media);
      track.addEventListener('ended', () => fail(new Error('Die Mikrofonverbindung wurde getrennt.')), { once: true });
    }
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    if (stopped) return;
    const reply = await options.connect({ companyId, language, offer: offer.sdp }) as { sessionId?: string; answer?: string };
    if (stopped) { if (reply.sessionId) release(reply.sessionId); return; }
    if (typeof reply.sessionId !== 'string' || typeof reply.answer !== 'string') throw new Error('Die Sprachverbindung wurde nicht bestätigt.');
    sessionId = reply.sessionId;
    await pc.setRemoteDescription({ type: 'answer', sdp: reply.answer });
    if (stopped) return;
    try {
      meterContext = new AudioContext();
      const analyser = meterContext.createAnalyser();
      meterContext.createMediaStreamSource(media).connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      meter = setInterval(() => {
        if (!talking || stopped) return;
        analyser.getFloatTimeDomainData(samples);
        let squares = 0;
        for (const sample of samples) squares += sample * sample;
        options.onMicLevel(Math.sqrt(squares / samples.length));
      }, 100);
    } catch { /* The microphone indicator does not control recording. */ }
  }

  void connect().catch(fail);
  return { stop, play };
}
