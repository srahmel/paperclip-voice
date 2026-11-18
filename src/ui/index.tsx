import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useHostLocation, usePluginAction, usePluginData, type PluginWidgetProps } from '@paperclipai/plugin-sdk/ui';
import { routeTarget, vadDecision, voiceMessage } from '../lib/voice-utils.mjs';
import { audioBlobToBase64, audioBase64ToBuffer, waitForVoiceJob } from '../lib/plugin-audio.mjs';
import { ensureNativeAgentChat, ensureAgentChatAvailable, resolveNativeTask, readNativeAgentChat, listVoiceTargets, readNativeComments, postNativeComment } from '../lib/paperclip-client.mjs';
import { appendDictation, useVoiceMounts, type DraftBinding } from './composer-mounts';
import { VoiceIcon } from './voice-icons';

type Phase = 'off' | 'starting' | 'ready' | 'listening' | 'transcribing' | 'review' | 'sending' | 'submitted' | 'waiting' | 'speaking' | 'error';
type Target = { kind: 'chat' | 'issue'; ref: string };
type Comment = { id: string; authorAgentId?: string | null; authorType?: string; deletedAt?: string | null; body?: string };
type AudioResult = { audioBase64: string; mime: string; bytes: number };

const P: Record<string, CSSProperties> = {
  panel: { position: 'fixed', right: 16, bottom: 76, zIndex: 10050, maxWidth: 'calc(100vw - 32px)', width: 360, maxHeight: 'calc(100dvh - 105px)', overflowY: 'auto', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--popover)', color: 'var(--popover-foreground)', padding: 18, boxShadow: '0 10px 30px #0003', fontFamily: 'inherit', fontSize: 14 },
  field: { display: 'block', width: '100%', marginTop: 6, marginBottom: 14, background: 'var(--background)', color: 'var(--foreground)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 10px', fontSize: 14 },
  button: { borderRadius: 8, padding: '9px 12px', background: 'var(--secondary)', color: 'var(--secondary-foreground)', border: '1px solid var(--border)', marginRight: 6, marginBottom: 6, fontSize: 13, fontWeight: 500, cursor: 'pointer' },
  primary: { borderRadius: 8, padding: '10px 14px', background: 'var(--primary)', color: 'var(--primary-foreground)', border: '1px solid transparent', marginRight: 6, marginBottom: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  muted: { color: 'var(--muted-foreground)', fontSize: 12, lineHeight: 1.5 },
  title: { margin: 0, fontSize: 16, fontWeight: 600 },
};

function friendlyError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function apiComments(issueId: string): Promise<Comment[]> {
  return readNativeComments(issueId) as Promise<Comment[]>;
}

async function resolveIssue(companyId: string, target: Target): Promise<string> {
  if (target.kind === 'issue') return resolveNativeTask(companyId, target.ref);
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

export function TaskVoiceButton({ context }: PluginWidgetProps) {
  if (!context.companyId || !context.entityId) return null;
  return <button type="button" className="pc-voice-task-trigger" title="Sprachmodus für diesen Task öffnen" onClick={() => {
    window.dispatchEvent(new CustomEvent('paperclip-voice-open-task', { detail: { companyId: context.companyId, issueId: context.entityId } }));
  }} style={{ ...P.button, margin: 0, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M3 10v4M7 7v10M11 4v16M15 7v10M19 9v6M22 11v2" />
    </svg>
    Sprachmodus für diesen Task
  </button>;
}

export function VoiceOpenButton({ context }: PluginWidgetProps) {
  if (!context.companyId) return null;
  return <button type="button" className="pc-voice-global-fallback" style={P.button} onClick={() => window.dispatchEvent(new CustomEvent('paperclip-voice-open', { detail: { companyId: context.companyId } }))}>Sprachmodus</button>;
}

export function VoiceOverlay({ context }: PluginWidgetProps) {
  const companyId = context.companyId ?? '';
  const transcribe = usePluginAction('voice-transcribe');
  const speakComment = usePluginAction('voice-speak-comment');
  const speakStatus = usePluginAction('voice-speak-status');
  const poll = usePluginAction('voice-poll');
  const cancel = usePluginAction('voice-cancel');
  const health = usePluginData<{ ready: boolean }>('voice-health', { companyId });
  const [opened, setOpened] = useState(false);
  const [phase, setPhaseState] = useState<Phase>('off');
  const phaseRef = useRef<Phase>('off');
  const { pathname } = useHostLocation();
  const { drafts, navigation } = useVoiceMounts(companyId, pathname);
  const [mode, setModeState] = useState<'conversation' | 'dictation' | 'read'>('conversation');
  const modeRef = useRef(mode);
  const draftRef = useRef<DraftBinding | null>(null);
  const [targetOptions, setTargetOptions] = useState<Array<Target & { label: string }>>([]);
  const sessionPathRef = useRef<string | null>(null);
  const [target, setTargetState] = useState<Target | null>(null);
  const targetRef = useRef<Target | null>(null);
  const [lastTranscript, setLastTranscript] = useState('');
  const [lastReply, setLastReply] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [autoSend, setAutoSend] = useState(false);
  const autoSendRef = useRef(false);
  const [autoContinue, setAutoContinue] = useState(true);
  const autoContinueRef = useRef(true);
  const [silenceThreshold, setSilenceThreshold] = useState(0.035);
  const thresholdRef = useRef(0.035);
  const [conciseReply, setConciseReply] = useState(true);
  const conciseReplyRef = useRef(true);
  const [language, setLanguage] = useState<'de' | 'en'>('de');

  const sessionActiveRef = useRef(false);
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
  const setMode = (next: typeof mode) => { modeRef.current = next; setModeState(next); };
  const setTarget = (next: Target | null) => { targetRef.current = next; setTargetState(next); };
  const active = (epoch: number) => epoch === epochRef.current && sessionActiveRef.current && sessionPathRef.current === window.location.pathname;

  const teardown = useCallback(() => {
    sessionActiveRef.current = false;
    epochRef.current += 1;
    sessionPathRef.current = null;
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

  useEffect(() => {
    window.addEventListener('pagehide', teardown);
    return () => { window.removeEventListener('pagehide', teardown); teardown(); };
  }, [teardown]);
  useEffect(() => { teardown(); setTarget(routeTarget(window.location.pathname) as Target | null); }, [companyId, teardown]);

  useEffect(() => {
    const open = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.companyId !== companyId) return;
      const next = typeof detail.issueId === 'string' ? { kind: 'issue' as const, ref: detail.issueId } : routeTarget(pathname) as Target | null;
      draftRef.current = null; setMode('conversation');
      teardown(); setTarget(next); setError(null); setOpened(true);
    };
    window.addEventListener('paperclip-voice-open', open);
    window.addEventListener('paperclip-voice-open-task', open);
    return () => { window.removeEventListener('paperclip-voice-open', open); window.removeEventListener('paperclip-voice-open-task', open); };
  }, [companyId, pathname, teardown]);

  useEffect(() => {
    if (!opened || !companyId || mode !== 'conversation') return;
    let current = true;
    void listVoiceTargets(companyId).then(options => { if (current) setTargetOptions(options as Array<Target & { label: string }>); }).catch(() => { if (current) setTargetOptions([]); });
    return () => { current = false; };
  }, [opened, companyId, mode]);

  useEffect(() => {
    const binding = draftRef.current;
    if (binding && !drafts.includes(binding)) {
      teardown(); draftRef.current = null; setError('Die ursprüngliche Eingabe wurde geschlossen. Das Transkript wurde nicht eingefügt.');
    }
  }, [drafts, teardown]);

  // useHostLocation follows Paperclip's SPA navigation, including browser back.
  useLayoutEffect(() => {
    teardown();
    draftRef.current = null; setMode('conversation');
    setOpened(false); setError(null); setLastTranscript(''); setLastReply('');
    setTarget(routeTarget(pathname) as Target | null);
  }, [pathname, teardown]);

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
      { cancel: (payload: Record<string, unknown>) => cancel(payload) },
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
      if (!active(epoch)) return;
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
    if (!active(epoch) || phaseRef.current === 'sending') return;
    if (!text.trim()) throw new Error('Das Transkript ist leer.');
    if (modeRef.current === 'dictation') {
      const binding = draftRef.current;
      if (!binding) throw new Error('Die ursprüngliche Eingabe ist nicht mehr verfügbar.');
      appendDictation(binding, text);
      teardown(); draftRef.current = null; setOpened(false);
      return;
    }
    const selected = targetRef.current;
    if (!selected) throw new Error('Wähle zuerst einen Agenten oder eine Aufgabe.');
    setPhase('sending');
    const issue = activeIssueIdRef.current ?? await resolveIssue(companyId, selected);
    if (!active(epoch)) return;
    activeIssueIdRef.current = issue;

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
    // Imported recordings are a single dictation, with no live microphone or
    // playback context. Finish instead of entering the continuous voice loop.
    if (!streamRef.current) { teardown(); setPhase('submitted'); return; }
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
      if (modeRef.current === 'dictation' || !autoSendRef.current) { setPhase('review'); return; }
      await submitTranscript(text, epoch);
    } catch (cause) {
      if (active(epoch)) { teardown(); setError(friendlyError(cause)); setPhase('error'); }
    }
  }

  // Continue watching the SAME issue after the first response, including late
  // progress/final comments while another speech turn is being prepared.
  function ensureReplyMonitor(epoch: number): void {
    if (modeRef.current !== 'conversation') return;
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

  async function importRecording(file: File): Promise<void> {
    if (!['off', 'error', 'submitted'].includes(phaseRef.current)) return;
    if ((!targetRef.current && !draftRef.current) || !companyId) { setError('Wähle zuerst einen Chat oder eine Aufgabe.'); return; }
    teardown(); setError(null); setLastTranscript('');
    const epoch = epochRef.current;
    sessionPathRef.current = pathname; sessionActiveRef.current = true;
    setPhase('transcribing');
    try {
      const text = await audioJob<{ text: string }>(transcribe, {
        language, mimeType: file.type || (file.name.toLowerCase().endsWith('.wav') ? 'audio/wav' : ''),
        audioBase64: await audioBlobToBase64(file),
      }, epoch);
      if (!active(epoch)) return;
      if (!text.text?.trim()) throw new Error('Keine Sprache erkannt.');
      setLastTranscript(text.text); setPhase('review');
    } catch (cause) {
      if (!active(epoch)) return;
      teardown(); setError(friendlyError(cause)); setPhase('error');
    }
  }

  async function startSession(): Promise<void> {
    if (!['off', 'error', 'submitted'].includes(phaseRef.current)) return;
    if (!companyId || (!targetRef.current && !draftRef.current)) { setError('Wähle zuerst einen Chat oder eine Aufgabe.'); return; }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { setError('Dieser Browser unterstützt keine sichere Audioaufnahme. HTTPS/localhost erforderlich.'); return; }
    if (health.data?.ready === false) { setError('Der lokale Audiodienst ist noch nicht bereit. Bitte die Voice-Plugin-Einstellungen prüfen.'); return; }
    teardown();
    setError(null);
    setLastReply('');
    setLastTranscript('');
    setPhase('starting');
    const epoch = epochRef.current;
    sessionPathRef.current = window.location.pathname;
    sessionActiveRef.current = true;
    try {
      const ctx = new AudioContext();
      audioContextRef.current = ctx;
      await ctx.resume(); // unlock during the initial user gesture
      if (modeRef.current === 'conversation' && targetRef.current?.kind === 'chat') {
        await ensureAgentChatAvailable();
        if (epoch !== epochRef.current || sessionPathRef.current !== window.location.pathname) return;
      }
      if (epoch !== epochRef.current || sessionPathRef.current !== window.location.pathname) return;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (epoch !== epochRef.current || sessionPathRef.current !== window.location.pathname) { stream.getTracks().forEach((track) => track.stop()); return; }
      streamRef.current = stream;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(analyser);
      analyserRef.current = analyser;
      await startCapture(epoch);
    } catch (cause) {
      if (epoch !== epochRef.current || sessionPathRef.current !== window.location.pathname) return;
      teardown();
      setError(`Sprachmodus konnte nicht gestartet werden: ${friendlyError(cause)}`);
      setPhase('error');
    }
  }

  function openDictation(binding: DraftBinding): void {
    teardown(); draftRef.current = binding; setMode('dictation');
    setError(null); setLastTranscript(''); setLastReply(''); setOpened(true);
  }

  async function readLatestReply(): Promise<void> {
    const selected = routeTarget(pathname) as Target | null;
    if (!selected) return;
    teardown(); draftRef.current = null; setMode('read'); setTarget(selected);
    setError(null); setLastReply(''); setOpened(true); setPhase('starting');
    const epoch = epochRef.current;
    sessionActiveRef.current = true; sessionPathRef.current = pathname;
    try {
      const ctx = new AudioContext(); audioContextRef.current = ctx; await ctx.resume();
      const issueId = selected.kind === 'issue' ? await resolveNativeTask(companyId, selected.ref) : await readNativeAgentChat(companyId, selected.ref);
      if (!active(epoch)) return;
      const comments = await apiComments(issueId);
      if (!active(epoch)) return;
      const latest = comments.filter(isAgentReply).at(-1);
      if (!latest) throw new Error('Noch keine Agentenantwort zum Vorlesen vorhanden.');
      const audio = await audioJob<AudioResult>(speakComment, { issueId, commentId: latest.id, language }, epoch);
      if (!active(epoch)) return;
      setLastReply(latest.body ?? ''); await playAudio(audio, epoch);
      if (active(epoch)) teardown();
    } catch (cause) { if (active(epoch)) { teardown(); setError(friendlyError(cause)); setPhase('error'); } }
  }

  const targetLabel = mode === 'dictation' ? 'Diktat für diese Eingabe – kein automatischer Versand' : target ? (target.kind === 'issue' ? `Aufgabe ${target.ref.slice(0, 8)}` : `Chat ${target.ref}`) : 'Kein Ziel';
  const canStart = phase === 'off' || phase === 'error' || phase === 'submitted';
  const iconButton: CSSProperties = { width: 32, height: 32, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: 0, borderRadius: 8, cursor: 'pointer' };
  const panelHost = mode === 'dictation' ? draftRef.current?.root.closest<HTMLElement>('[role="dialog"]') : null;
  const panel = opened && <section id="paperclip-voice-dialog" className="pc-voice-panel" style={{ ...P.panel, ...(panelHost ? { position: 'relative', right: 'auto', bottom: 'auto', margin: 12, width: 'auto', maxWidth: 'none', maxHeight: '60dvh', flexShrink: 1 } : {}) }} aria-label={mode === 'dictation' ? 'Diktat' : mode === 'read' ? 'Antwort vorlesen' : 'Sprachmodus'} aria-live="polite">

      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <h2 style={P.title}>{mode === 'dictation' ? 'Diktat' : mode === 'read' ? 'Antwort vorlesen' : 'Sprachmodus'}</h2>
        <button type="button" style={{ ...P.button, background: 'transparent', border: 0, fontSize: 20, padding: '2px 6px', margin: 0, color: 'var(--muted-foreground)' }} onClick={() => { teardown(); setOpened(false); }} aria-label="Panel schließen">×</button>
      </header>
      <p style={P.muted}>{mode === 'dictation' ? 'Diktieren oder eine Aufnahme importieren, Text prüfen und in diese Eingabe übernehmen. Absenden erfolgt über den normalen Sendebutton.' : mode === 'read' ? 'Die letzte Agentenantwort wird lokal vorgelesen.' : 'Sprechen, Transkript prüfen und Antworten anhören. Automatisches Senden lässt sich in den Optionen einschalten.'}</p>
      <p style={{ ...P.muted, margin: '12px 0' }} role="status">{({ off: 'Bereit zum Starten', starting: 'Mikrofon wird geöffnet …', ready: 'Bereit', listening: 'Ich höre zu …', transcribing: 'Transkribiere …', review: 'Transkript prüfen', sending: 'Sende an Paperclip …', submitted: 'Nachricht gesendet. Die Antwort erscheint in Paperclip.', waiting: 'Warte auf Agentenantwort …', speaking: 'Sprachausgabe läuft …', error: 'Fehler' } as Record<Phase,string>)[phase]}</p>
      <p style={P.muted}>Audio: {health.loading ? 'Wird geprüft …' : health.data?.ready ? 'Bereit' : 'Lokaler Audiodienst nicht erreichbar'}</p>
      <label htmlFor="voice-language">Sprache</label>
      <select id="voice-language" style={P.field} value={language} disabled={!canStart} onChange={(event) => setLanguage(event.target.value as 'de' | 'en')}>
        <option value="de">Deutsch</option><option value="en">English</option>
      </select>
      <p style={P.muted}>Aktueller Chat: {targetLabel}</p>
      {mode === 'conversation' && <label>Chat oder Aufgabe<select aria-label="Chat oder Aufgabe" style={P.field} disabled={!canStart} value={target ? `${target.kind}:${target.ref}` : ''} onChange={event => {
        const selected = targetOptions.find(option => `${option.kind}:${option.ref}` === event.target.value);
        setTarget(selected ?? null);
      }}><option value="">Bitte wählen …</option>
        {target && !targetOptions.some(option => option.kind === target.kind && option.ref === target.ref) && <option value={`${target.kind}:${target.ref}`}>{targetLabel}</option>}
        {targetOptions.map(option => <option key={`${option.kind}:${option.ref}`} value={`${option.kind}:${option.ref}`}>{option.label}</option>)}
      </select></label>}
      {mode !== 'read' && <details style={{ margin: '12px 0', color: 'var(--muted-foreground)', fontSize: 13 }}>
      <summary style={{ cursor: 'pointer', padding: '5px 0' }}>Optionen</summary>
      {mode === 'conversation' && <label style={{ display: 'block', marginBottom: 7 }}><input type="checkbox" checked={autoSend} onChange={(event) => { autoSendRef.current = event.target.checked; setAutoSend(event.target.checked); }} /> Automatisch an Paperclip senden</label>}
      {mode === 'conversation' && <>
        <label style={{ display: 'block', marginBottom: 7 }}><input type="checkbox" checked={autoContinue} onChange={(event) => { autoContinueRef.current = event.target.checked; setAutoContinue(event.target.checked); }} /> Nach Antwort weiter zuhören</label>
        <label style={{ display: 'block', marginBottom: 7 }}><input type="checkbox" checked={conciseReply} onChange={(event) => { conciseReplyRef.current = event.target.checked; setConciseReply(event.target.checked); }} /> Knappe Antworten anfordern (sichtbar im Chat)</label>
      </>}
      <label style={P.muted} htmlFor="voice-threshold">Mikrofonempfindlichkeit (Auto-Stopp bei Sprechpause)</label>
      <input id="voice-threshold" type="range" min="0.015" max="0.09" step="0.005" value={silenceThreshold} onChange={(event) => { const n = Number(event.target.value); thresholdRef.current = n; setSilenceThreshold(n); }} style={{ width: '100%', margin: '4px 0 10px' }}/>
      <label htmlFor="voice-import" style={P.muted}>Aufnahme importieren (mit Textvorschau)</label>
      <input id="voice-import" type="file" accept="audio/webm,audio/ogg,audio/mp4,audio/wav,.wav" disabled={!canStart} onChange={event => {
        const file = event.currentTarget.files?.[0]; event.currentTarget.value = '';
        if (file) void importRecording(file);
      }} style={{ display: 'block', maxWidth: '100%', margin: '6px 0' }} />
      </details>}
      <div>
        {canStart && mode !== 'read' ? <button type="button" style={P.primary} onClick={() => void startSession()}>{mode === 'dictation' ? 'Diktat starten' : 'Sprachmodus starten'}</button> : null}
        {phase !== 'off' && <button type="button" style={P.button} onClick={() => { teardown(); setError(null); }}>Stoppen</button>}
        {phase === 'ready' && streamRef.current && <button type="button" style={P.button} onClick={() => { const epoch = epochRef.current; void startCapture(epoch); }}>Weitere Anweisung</button>}
        {phase === 'review' && <button type="button" style={P.button} onClick={() => void submitTranscript(lastTranscript, epochRef.current).catch(cause => { if (modeRef.current !== 'dictation') { teardown(); setPhase('error'); } setError(friendlyError(cause)); })}>{mode === 'dictation' ? 'In Eingabe übernehmen' : 'Transkript absenden'}</button>}
      </div>
      {lastTranscript && <div style={{ marginTop: 12 }}><strong>Zuletzt verstanden</strong><textarea style={{ ...P.field, minHeight: 60 }} value={lastTranscript} onChange={(event) => setLastTranscript(event.target.value)} disabled={phase !== 'review'} /></div>}
      {lastReply && <div style={{ marginTop: 10, maxHeight: 140, overflowY: 'auto' }}><strong>Letzte Antwort</strong><p style={{ ...P.muted, whiteSpace: 'pre-wrap' }}>{lastReply.slice(0, 1300)}{lastReply.length > 1300 ? ' …' : ''}</p></div>}
      {error && <p role="alert" style={{ color: 'var(--destructive)', padding: '8px 0', whiteSpace: 'pre-wrap' }}>{error}</p>}
      <p style={{ ...P.muted, marginTop: 10 }}>Auf dem Smartphone kann der Sprachmodus bei gesperrtem Bildschirm pausieren.</p>
    </section>;

  return <>
    <style>{`html[data-paperclip-voice-navigation] .pc-voice-global-fallback, html[data-paperclip-voice-composers] .pc-voice-task-trigger { display: none !important; } @media (max-width: 767px) { .pc-voice-panel { max-height: calc(100dvh - 84px); } }`}</style>
    {drafts.map(binding => createPortal(<>
      <button type="button" aria-label="Diktat in diese Eingabe" title="Diktat in diese Eingabe" style={iconButton} className="bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground" onClick={() => openDictation(binding)}><VoiceIcon kind="microphone" /></button>
      {routeTarget(pathname) && !binding.root.closest('[role="dialog"]') && <button type="button" aria-label="Letzte Agentenantwort vorlesen" title="Letzte Agentenantwort vorlesen" style={iconButton} className="bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground" onClick={() => void readLatestReply()}><VoiceIcon kind="speaker" /></button>}
    </>, binding.mount, `draft-${binding.id}`))}
    {navigation && createPortal(<button type="button" aria-label="Sprachmodus" className="flex items-center gap-2.5 mx-2 rounded-lg px-2 py-1.5 pointer-coarse:py-1 text-(length:--text-compact) font-medium transition-colors bg-transparent text-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground" style={{ border: 0, width: 'calc(100% - 16px)', cursor: 'pointer' }} onClick={() => window.dispatchEvent(new CustomEvent('paperclip-voice-open', { detail: { companyId } }))}><VoiceIcon kind="waves" /><span>Sprachmodus</span></button>, navigation)}
    {panelHost && panel ? createPortal(panel, panelHost) : panel}
  </>;
}
