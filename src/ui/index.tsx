import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { usePluginAction, usePluginData } from '@paperclipai/plugin-sdk/ui';
import { type PluginWidgetProps } from '@paperclipai/plugin-sdk/ui';
import { routeTarget, vadDecision, voiceMessage } from '../lib/voice-utils.mjs';
import { audioBlobToBase64, audioBase64ToBuffer, waitForVoiceJob } from '../lib/plugin-audio.mjs';
import { paperclipApi, ensureNativeAgentChat, readNativeComments, postNativeComment } from '../lib/paperclip-client.mjs';

type Phase = 'off' | 'starting' | 'ready' | 'listening' | 'transcribing' | 'review' | 'sending' | 'waiting' | 'speaking' | 'error';
type Target = { kind: 'chat' | 'issue'; ref: string };
type Agent = { id: string; name: string; status?: string };
type Comment = { id: string; authorAgentId?: string | null; authorType?: string; deletedAt?: string | null; body?: string };
type AudioResult = { audioBase64: string; mime: string; bytes: number };

const P: Record<string, CSSProperties> = {
  toggle: { position: 'fixed', right: 20, bottom: 20, zIndex: 10050, padding: '12px 17px', borderRadius: 999, border: '1px solid #557', background: '#172236', color: '#fff', boxShadow: '0 4px 20px #0005', fontWeight: 600, cursor: 'pointer' },
  panel: { position: 'fixed', right: 16, bottom: 78, zIndex: 10050, maxWidth: 'calc(100vw - 32px)', width: 375, maxHeight: 'calc(100dvh - 105px)', overflowY: 'auto', borderRadius: 14, border: '1px solid #718096', background: '#152031', color: '#fff', padding: 16, boxShadow: '0 8px 40px #0009', fontFamily: 'system-ui, sans-serif', fontSize: 14 },
  field: { display: 'block', width: '100%', marginTop: 6, marginBottom: 10, background: '#263750', color: '#fff', border: '1px solid #6b778d', borderRadius: 8, padding: 9, fontSize: 14 },
  button: { borderRadius: 8, padding: '9px 12px', background: '#3a5a8b', color: 'white', border: '1px solid #8290a9', marginRight: 6, marginBottom: 6, cursor: 'pointer' },
  muted: { opacity: 0.75, fontSize: 12, lineHeight: 1.5 },
  title: { margin: '0 0 10px 0', fontSize: 18, fontWeight: 700 },
};

function friendlyError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function api<T>(path: string): Promise<T> {
  return paperclipApi(path) as Promise<T>;
}

async function apiComments(issueId: string): Promise<Comment[]> {
  return readNativeComments(issueId) as Promise<Comment[]>;
}

async function resolveIssue(companyId: string, target: Target): Promise<string> {
  if (target.kind === 'issue') return target.ref;
  return ensureNativeAgentChat(companyId, target.ref);
}

function preferredMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg']
    .find((mime) => MediaRecorder.isTypeSupported(mime));
}

function isAgentReply(comment: Comment): boolean {
  return Boolean((comment.authorAgentId || comment.authorType === 'agent') && !comment.deletedAt && comment.body?.trim());
}

export function VoiceOverlay({ context }: PluginWidgetProps) {
  const companyId = context.companyId ?? '';
  const transcribe = usePluginAction('voice-transcribe');
  const speakComment = usePluginAction('voice-speak-comment');
  const speakStatus = usePluginAction('voice-speak-status');
  const poll = usePluginAction('voice-poll');
  const health = usePluginData<{ ready: boolean }>('voice-health', { companyId });
  const [opened, setOpened] = useState(false);
  const [phase, setPhaseState] = useState<Phase>('off');
  const phaseRef = useRef<Phase>('off');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [target, setTargetState] = useState<Target | null>(null);
  const targetRef = useRef<Target | null>(null);
  const [issueId, setIssueId] = useState<string | null>(null);
  const [lastTranscript, setLastTranscript] = useState('');
  const [lastReply, setLastReply] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [autoSend, setAutoSend] = useState(true);
  const autoSendRef = useRef(true);
  const [autoContinue, setAutoContinue] = useState(true);
  const autoContinueRef = useRef(true);
  const [silenceThreshold, setSilenceThreshold] = useState(0.035);
  const thresholdRef = useRef(0.035);
  const [conciseReply, setConciseReply] = useState(true);
  const conciseReplyRef = useRef(true);
  const [language, setLanguage] = useState<'de' | 'en'>('de');

  const epochRef = useRef(0); // invalidates asynchronous work on stop/company change
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const silenceIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const monitorIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const monitorBusyRef = useRef(false);
  const utteranceStartedRef = useRef(false);
  const playingSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const seenCommentIdsRef = useRef<Set<string>>(new Set());
  const activeIssueIdRef = useRef<string | null>(null);

  const setPhase = (next: Phase) => { phaseRef.current = next; setPhaseState(next); };
  const setTarget = (next: Target | null) => { targetRef.current = next; setTargetState(next); };
  const active = (epoch: number) => epoch === epochRef.current && streamRef.current !== null;

  const teardown = useCallback(() => {
    epochRef.current += 1;
    if (silenceIntervalRef.current) clearInterval(silenceIntervalRef.current);
    silenceIntervalRef.current = null;
    if (monitorIntervalRef.current) clearInterval(monitorIntervalRef.current);
    monitorIntervalRef.current = null;
    monitorBusyRef.current = false;
    utteranceStartedRef.current = false;
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.onstop = null;
      recorderRef.current.stop();
    }
    recorderRef.current = null;
    playingSourceRef.current?.stop();
    playingSourceRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    analyserRef.current = null;
    void audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = null;
    activeIssueIdRef.current = null;
    seenCommentIdsRef.current.clear();
    phaseRef.current = 'off';
    setPhaseState('off');
  }, []);

  useEffect(() => () => teardown(), [teardown]);
  useEffect(() => { teardown(); setIssueId(null); setTarget(null); }, [companyId, teardown]);

  useEffect(() => {
    if (!opened || !companyId) return;
    const inferred = routeTarget(window.location.pathname) as Target | null;
    if (phaseRef.current === 'off' && inferred) setTarget(inferred);
    void api<Agent[]>(`/companies/${encodeURIComponent(companyId)}/agents`)
      .then((items) => setAgents(items.filter((agent) => agent.status !== 'terminated')))
      .catch((cause) => setError(`Agenten konnten nicht geladen werden: ${friendlyError(cause)}`));
  }, [opened, companyId]);

  async function playAudio(result: AudioResult, epoch: number): Promise<void> {
    if (!active(epoch) || !result.audioBase64) return;
    const audioCtx = audioContextRef.current;
    if (!audioCtx) return;
    setPhase('speaking');
    const decoded = await audioCtx.decodeAudioData(audioBase64ToBuffer(result.audioBase64));
    if (!active(epoch)) return;
    await audioCtx.resume();
    await new Promise<void>((resolve, reject) => {
      if (!active(epoch)) return resolve();
      const source = audioCtx.createBufferSource();
      playingSourceRef.current = source;
      source.buffer = decoded;
      source.connect(audioCtx.destination);
      source.onended = () => { if (playingSourceRef.current === source) playingSourceRef.current = null; resolve(); };
      try { source.start(); }
      catch (cause) { reject(cause); }
    });
  }

  async function audioJob<T>(action: (params: Record<string, unknown>) => Promise<unknown>, params: Record<string, unknown>, epoch: number): Promise<T> {
    const result = await waitForVoiceJob(
      (payload: Record<string, unknown>) => action(payload),
      (payload: Record<string, unknown>) => poll(payload),
      { companyId, ...params },
      () => active(epoch),
    );
    return result as T;
  }

  async function sayStatus(status: string, epoch: number): Promise<void> {
    const result = await audioJob<AudioResult>(speakStatus, { status, language }, epoch);
    await playAudio(result, epoch);
  }

  async function waitForAgent(issue: string, epoch: number): Promise<void> {
    setPhase('waiting');
    const deadline = Date.now() + 15 * 60 * 1000;
    while (active(epoch) && phaseRef.current === 'waiting' && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 1800));
      if (!active(epoch) || phaseRef.current !== 'waiting') return;
      const comments = await apiComments(issue);
      const newReplies = comments.filter((comment) => !seenCommentIdsRef.current.has(comment.id) && isAgentReply(comment));
      for (const comment of comments) seenCommentIdsRef.current.add(comment.id);
      if (newReplies.length) {
        const latest = newReplies[newReplies.length - 1];
        const spoken = await audioJob<AudioResult>(speakComment, { issueId: issue, commentId: latest.id, language }, epoch);
        setLastReply(latest.body ?? '');
        await playAudio(spoken, epoch);
        if (!active(epoch)) return;
        if (autoContinueRef.current) await startCapture(epoch);
        else setPhase('ready');
        return;
      }
    }
    if (active(epoch) && phaseRef.current === 'waiting') {
      setError('Noch keine Agentenantwort. Die Aufgabe läuft in Paperclip weiter; neue Agentenmeldungen werden weiter beobachtet.');
      if (autoContinueRef.current) await startCapture(epoch);
      else setPhase('ready');
    }
  }

  async function submitTranscript(text: string, epoch: number): Promise<void> {
    if (!active(epoch)) return;
    const selected = targetRef.current;
    if (!selected) throw new Error('Wähle zuerst einen Agenten oder eine Aufgabe.');
    setPhase('sending');
    const issue = activeIssueIdRef.current ?? await resolveIssue(companyId, selected);
    if (!active(epoch)) return;
    activeIssueIdRef.current = issue;
    setIssueId(issue);

    // Establish a baseline BEFORE submitting; never read an old reply aloud.
    const before = await apiComments(issue);
    for (const c of before) seenCommentIdsRef.current.add(c.id);
    if (!active(epoch)) return;
    const clientRequestId = crypto.randomUUID();
    const message = voiceMessage(text, conciseReplyRef.current);
    // Native authenticated Paperclip user operation, not a parallel plugin agent chat.
    // 5xx or transport failure is an UNKNOWN outcome: never retry automatically.
    try { await postNativeComment(issue, message, clientRequestId); }
    catch { throw new Error('Senden möglicherweise erfolgt. Bitte den Chat prüfen, bevor du erneut sendest.'); }
    if (!active(epoch)) return;
    try { await sayStatus('submitted', epoch); }
    catch { throw new Error('Nachricht wurde gesendet, aber die Sprachausgabe ist ausgefallen. Bitte den Chat prüfen.'); }
    if (active(epoch)) await waitForAgent(issue, epoch);
  }

  async function processRecording(blob: Blob, epoch: number): Promise<void> {
    if (!active(epoch)) return;
    try {
      setPhase('transcribing');
      if (blob.size < 500 || blob.size > 2 * 1024 * 1024) throw new Error('Audioaufnahme ist zu kurz oder zu groß (max. 2 MiB).');
      const audioBase64 = await audioBlobToBase64(blob);
      if (!active(epoch)) return;
      const transcription = await audioJob<{ text: string }>(transcribe, { audioBase64, mimeType: blob.type || 'audio/webm', language }, epoch);
      const text = transcription.text?.trim() ?? '';
      if (!active(epoch)) return;
      if (!text) {
        await sayStatus('no_speech', epoch);
        if (active(epoch)) await startCapture(epoch);
        return;
      }
      setLastTranscript(text);
      if (!autoSendRef.current) { setPhase('review'); return; }
      await submitTranscript(text, epoch);
    } catch (cause) {
      if (active(epoch)) { teardown(); setError(friendlyError(cause)); setPhase('error'); }
    }
  }

  // Continue watching the SAME issue after the first response, including late
  // progress/final comments while another speech turn is being prepared.
  function ensureReplyMonitor(epoch: number): void {
    if (monitorIntervalRef.current) return;
    monitorIntervalRef.current = setInterval(() => {
      if (!active(epoch) || phaseRef.current !== 'listening' || utteranceStartedRef.current || monitorBusyRef.current) return;
      const currentIssue = activeIssueIdRef.current;
      if (!currentIssue) return;
      monitorBusyRef.current = true;
      void (async () => {
        try {
          const comments = await apiComments(currentIssue);
          if (!active(epoch) || phaseRef.current !== 'listening' || utteranceStartedRef.current) return;
          const newReplies = comments.filter(c => !seenCommentIdsRef.current.has(c.id) && isAgentReply(c));
          for (const c of comments) seenCommentIdsRef.current.add(c.id);
          if (!newReplies.length) return;
          // The user is not speaking. Silence-only recording is discarded.
          const recording = recorderRef.current;
          if (recording && recording.state !== 'inactive') {
            recording.onstop = null;
            recording.stop();
          }
          if (silenceIntervalRef.current) clearInterval(silenceIntervalRef.current);
          silenceIntervalRef.current = null;
          const latest = newReplies[newReplies.length - 1];
          const spoken = await audioJob<AudioResult>(speakComment, { issueId: currentIssue, commentId: latest.id, language }, epoch);
          if (!active(epoch)) return;
          setLastReply(latest.body ?? '');
          await playAudio(spoken, epoch);
          if (!active(epoch)) return;
          if (autoContinueRef.current) await startCapture(epoch);
          else setPhase('ready');
        } catch (cause) {
          if (active(epoch)) { teardown(); setError(`Antwort-Beobachtung: ${friendlyError(cause)}`); setPhase('error'); }
        } finally {
          monitorBusyRef.current = false;
        }
      })();
    }, 2500);
  }

  async function startCapture(epoch: number): Promise<void> {
    if (!active(epoch)) return;
    const stream = streamRef.current;
    const analyser = analyserRef.current;
    if (!stream || !analyser) return;
    try { await audioContextRef.current?.resume(); }
    catch { /* Browser may suspend playback while backgrounded. */ }
    if (!active(epoch)) return;
    const mime = preferredMime();
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 32_000 } : { audioBitsPerSecond: 32_000 });
    recorderRef.current = recorder;
    utteranceStartedRef.current = false;
    const chunks: Blob[] = [];
    let spoke = false;
    let silenceMs = 0;
    let lastTick = performance.now();
    const started = lastTick;
    let quietStop = false;
    recorder.ondataavailable = (event) => { if (event.data?.size) chunks.push(event.data); };
    recorder.onstop = () => {
      if (silenceIntervalRef.current) clearInterval(silenceIntervalRef.current);
      silenceIntervalRef.current = null;
      if (!active(epoch)) return;
      if (quietStop || !spoke) {
        void startCapture(epoch); // no audio sent for silence-only clips
        return;
      }
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      void processRecording(blob, epoch);
    };
    recorder.start(1000);
    setPhase('listening');
    const samples = new Float32Array(analyser.fftSize);
    silenceIntervalRef.current = setInterval(() => {
      if (!active(epoch) || recorder.state === 'inactive') return;
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) sum += sample * sample;
      const rms = Math.sqrt(sum / samples.length);
      const now = performance.now();
      const dt = now - lastTick;
      lastTick = now;
      const next = vadDecision({ rms, elapsedMs: now - started, silenceMs: silenceMs + dt, spoke, threshold: thresholdRef.current });
      spoke = next.spoke;
      utteranceStartedRef.current = spoke;
      silenceMs = rms >= thresholdRef.current ? 0 : (spoke ? silenceMs + dt : 0);
      if (next.stop || (!spoke && now - started >= 25_000)) {
        quietStop = !spoke;
        recorder.stop();
      }
    }, 100);
    ensureReplyMonitor(epoch);
  }

  async function startSession(): Promise<void> {
    if (phaseRef.current !== 'off' && phaseRef.current !== 'error') return;
    if (!companyId || !targetRef.current) { setError('Wähle zunächst Alex, einen anderen Agenten oder eine Aufgabe.'); return; }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { setError('Dieser Browser unterstützt keine sichere Audioaufnahme. HTTPS/localhost erforderlich.'); return; }
    if (health.data?.ready === false) { setError('Lokaler Voicebox-Dienst nicht erreichbar. Bitte Voicebox-Health auf dem Paperclip-Host prüfen.'); return; }
    teardown();
    setError(null);
    setLastReply('');
    setLastTranscript('');
    setPhase('starting');
    const epoch = epochRef.current;
    try {
      const ctx = new AudioContext();
      audioContextRef.current = ctx;
      await ctx.resume(); // unlock on the original user gesture before requesting microphone
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (epoch !== epochRef.current) { stream.getTracks().forEach((track) => track.stop()); return; }
      streamRef.current = stream;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(analyser);
      analyserRef.current = analyser;
      await startCapture(epoch);
    } catch (cause) {
      if (epoch !== epochRef.current) return;
      teardown();
      setError(`Mikrofon konnte nicht gestartet werden: ${friendlyError(cause)}`);
      setPhase('error');
    }
  }

  const targetLabel = target ? (target.kind === 'issue' ? `Aufgabe ${target.ref.slice(0, 8)}` : agents.find(a => a.id === target.ref)?.name ?? target.ref) : 'Kein Ziel';
  const canStart = phase === 'off' || phase === 'error';

  return <>
    <button type="button" style={P.toggle} aria-label="Paperclip Voice öffnen" onClick={() => setOpened(v => !v)}>
      {phase === 'listening' ? '● Mikrofon aktiv' : '◉ Voice'}
    </button>
    {opened && <section style={P.panel} aria-label="Paperclip Voice" aria-live="polite">
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <h2 style={P.title}>Paperclip Voice</h2>
        <button type="button" style={P.button} onClick={() => setOpened(false)} aria-label="Panel schließen">×</button>
      </header>
      <p style={P.muted}>Lokales Whisper + Piper · Original-Paperclip-Chat · Windows / Linux</p>
      <p><strong>Status:</strong> {({ off: 'Aus', starting: 'Mikrofon wird geöffnet …', ready: 'Bereit', listening: 'Ich höre zu …', transcribing: 'Transkribiere …', review: 'Transkript prüfen', sending: 'Sende an Paperclip …', waiting: 'Warte auf Agentenantwort …', speaking: 'Sprachausgabe läuft …', error: 'Fehler' } as Record<Phase,string>)[phase]}</p>
      <p style={P.muted}>Voicebox: {health.loading ? 'Wird geprüft …' : health.data?.ready ? 'Bereit' : 'Nicht erreichbar oder noch nicht geprüft'}</p>
      <label htmlFor="voice-language">Sprache</label>
      <select id="voice-language" style={P.field} value={language} disabled={phase !== 'off' && phase !== 'error'} onChange={(event) => setLanguage(event.target.value as 'de' | 'en')}>
        <option value="de">Deutsch</option><option value="en">English</option>
      </select>
      <label htmlFor="voice-target" style={{ display: 'block', marginTop: 8 }}>Zielkonversation</label>
      <select id="voice-target" style={P.field} value={target ? `${target.kind}:${target.ref}` : ''} disabled={phase !== 'off' && phase !== 'error'} onChange={(event) => {
        if (!event.target.value) return setTarget(null);
        const [kind, ...rest] = event.target.value.split(':');
        setTarget({ kind: kind as Target['kind'], ref: rest.join(':') });
      }}>
        <option value="">Agent wählen …</option>
        {target?.kind === 'issue' && <option value={`issue:${target.ref}`}>Aktuelle Aufgabe {target.ref.slice(0, 8)}</option>}
        {target?.kind === 'chat' && !agents.some(a => a.id === target.ref) && <option value={`chat:${target.ref}`}>Aktueller Chat: {target.ref}</option>}
        {agents.map(a => <option key={a.id} value={`chat:${a.id}`}>{a.name}</option>)}
      </select>
      <p style={P.muted}>Aktiv: {targetLabel}{issueId ? <a style={{ color: '#c3dcff', marginLeft: 7 }} href={`/issues/${encodeURIComponent(issueId)}`}>Chat öffnen</a> : null}</p>
      <label style={{ display: 'block', marginBottom: 7 }}><input type="checkbox" checked={autoSend} onChange={(event) => { autoSendRef.current = event.target.checked; setAutoSend(event.target.checked); }} /> Automatisch an Paperclip senden</label>
      <label style={{ display: 'block', marginBottom: 7 }}><input type="checkbox" checked={autoContinue} onChange={(event) => { autoContinueRef.current = event.target.checked; setAutoContinue(event.target.checked); }} /> Nach Antwort weiter zuhören</label>
      <label style={{ display: 'block', marginBottom: 7 }}><input type="checkbox" checked={conciseReply} onChange={(event) => { conciseReplyRef.current = event.target.checked; setConciseReply(event.target.checked); }} /> Knappe Antworten anfordern (sichtbar im Chat)</label>
      <label style={P.muted} htmlFor="voice-threshold">Mikrofonempfindlichkeit (Auto-Stopp bei Sprechpause)</label>
      <input id="voice-threshold" type="range" min="0.015" max="0.09" step="0.005" value={silenceThreshold} onChange={(event) => { const n = Number(event.target.value); thresholdRef.current = n; setSilenceThreshold(n); }} style={{ width: '100%', margin: '4px 0 10px' }}/>
      <div>
        {canStart ? <button type="button" style={P.button} onClick={() => void startSession()}>Sprachmodus starten</button> : null}
        {phase !== 'off' && <button type="button" style={P.button} onClick={() => { teardown(); setError(null); }}>Stoppen</button>}
        {phase === 'ready' && streamRef.current && <button type="button" style={P.button} onClick={() => { const epoch = epochRef.current; void startCapture(epoch); }}>Weitere Anweisung</button>}
        {phase === 'review' && <button type="button" style={P.button} onClick={() => void submitTranscript(lastTranscript, epochRef.current).catch(cause => { setError(friendlyError(cause)); setPhase('error'); })}>Transkript absenden</button>}
      </div>
      {lastTranscript && <div style={{ marginTop: 12 }}><strong>Zuletzt verstanden</strong><textarea style={{ ...P.field, minHeight: 60 }} value={lastTranscript} onChange={(event) => setLastTranscript(event.target.value)} disabled={phase !== 'review'} /></div>}
      {lastReply && <div style={{ marginTop: 10, maxHeight: 140, overflowY: 'auto' }}><strong>Letzte Antwort</strong><p style={{ ...P.muted, whiteSpace: 'pre-wrap' }}>{lastReply.slice(0, 1300)}{lastReply.length > 1300 ? ' …' : ''}</p></div>}
      {error && <p role="alert" style={{ background: '#5c2631', padding: 8, borderRadius: 6, whiteSpace: 'pre-wrap' }}>{error}</p>}
      <p style={{ ...P.muted, marginTop: 10 }}>Freigaben bleiben in Paperclip. Keine Audio-API-Kosten. Bei gesperrtem Smartphone kann der Browser Mikrofon und Audio pausieren.</p>
    </section>}
  </>;
}
