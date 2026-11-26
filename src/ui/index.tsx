import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useHostLocation, useHostNavigation, usePluginAction, usePluginData, type PluginWidgetProps } from '@paperclipai/plugin-sdk/ui';
import { createSpeechDetector, DEFAULT_SPEECH_LEVEL, rememberVoiceAgent, realtimeAgentTarget, routeTarget, vadDecision, voiceMessage, voiceSessionTarget, VOICE_LANGUAGES } from '../lib/voice-utils.mjs';
import { audioBlobToBase64, audioBase64ToBuffer, waitForVoiceJob } from '../lib/plugin-audio.mjs';
import { ensureNativeAgentChat, ensureAgentChatAvailable, resolveNativeTask, readNativeAgentChat, listVoiceTargets, readNativeComments, postNativeComment } from '../lib/paperclip-client.mjs';
import { appendDictation, useVoiceMounts, type DraftBinding } from './composer-mounts';
import { VoiceIcon } from './voice-icons';
import { startLocalConversation } from './local-conversation';
import { startRealtimeConversation } from './realtime-conversation';
import { CONFIRMATION_TIMEOUT_MS, MAX_CONFIRMATION_CHARS, voiceConfirmationDecision } from '../lib/voice-confirmation.mjs';

type Phase = 'off' | 'starting' | 'ready' | 'listening' | 'capturing' | 'transcribing' | 'confirming' | 'review' | 'sending' | 'submitted' | 'waiting' | 'speaking' | 'thinking' | 'saving' | 'error';
type Target = { kind: 'chat' | 'issue'; ref: string };
type PendingConfirmation = { text: string; target: Target; expiresAt: number };
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

const launcherStyle: CSSProperties = { ...P.button, margin: 0, display: 'inline-flex', alignItems: 'center', gap: 8 };

function MicrophoneWave({ level, capturing }: { level: number; capturing: boolean }) {
  return <span aria-hidden="true" style={{ display: 'inline-flex', height: 22, gap: 3, alignItems: 'center', flexShrink: 0, color: capturing ? 'var(--primary)' : 'var(--muted-foreground)' }}>
    {[5, 10, 16, 20, 16, 10, 5].map((height, index) => <span key={index} style={{
      width: 2, height: 3 + height * level, borderRadius: 2, background: 'currentColor',
      transition: 'height 100ms ease-out',
    }} />)}
  </span>;
}

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
  return <button type="button" className="pc-voice-task-trigger" title="Open voice mode for this task" onClick={() => {
    window.dispatchEvent(new CustomEvent('paperclip-voice-open-task', { detail: { companyId: context.companyId, issueId: context.entityId } }));
  }} style={launcherStyle}>
    <VoiceIcon kind="microphone" />
    <span>Voice mode</span>
  </button>;
}

export function VoiceOpenButton({ context }: PluginWidgetProps) {
  if (!context.companyId) return null;
  return <button type="button" className="pc-voice-global-fallback" style={launcherStyle} onClick={() => window.dispatchEvent(new CustomEvent('paperclip-voice-open', { detail: { companyId: context.companyId } }))}>
    <VoiceIcon kind="microphone" />
    <span>Voice mode</span>
  </button>;
}

export function VoiceOverlay({ context }: PluginWidgetProps) {
  const companyId = context.companyId ?? '';
  const transcribe = usePluginAction('voice-transcribe');
  const speakComment = usePluginAction('voice-speak-comment');
  const speakConfirmation = usePluginAction('voice-speak-confirmation');
  const speakStatus = usePluginAction('voice-speak-status');
  const poll = usePluginAction('voice-poll');
  const cancel = usePluginAction('voice-cancel');
  const startStream = usePluginAction('voice-stream-start');
  const updateStream = usePluginAction('voice-stream-update');
  const connectRealtime = usePluginAction('voice-realtime-connect');
  const disconnectRealtime = usePluginAction('voice-realtime-disconnect');
  type VoiceLanguage = keyof typeof VOICE_LANGUAGES;
  const health = usePluginData<{ ready: boolean; streamingReady?: boolean; realtime?: boolean; workspaceAccess?: boolean; language?: VoiceLanguage }>('voice-health', { companyId });
  const [opened, setOpened] = useState(false);
  const [phase, setPhaseState] = useState<Phase>('off');
  const phaseRef = useRef<Phase>('off');
  const { pathname } = useHostLocation();
  const hostNavigation = useHostNavigation();
  const { drafts, navigation } = useVoiceMounts(companyId, pathname);
  const [mode, setModeState] = useState<'conversation' | 'dictation' | 'read'>('conversation');
  const [generalLauncher, setGeneralLauncher] = useState(false);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);
  const [createdTasks, setCreatedTasks] = useState<string[]>([]);
  const realtimeMode = mode === 'conversation' && generalLauncher && health.data?.realtime === true;
  const modeRef = useRef(mode);
  const draftRef = useRef<DraftBinding | null>(null);
  const [targetOptions, setTargetOptions] = useState<Array<Target & { label: string }>>([]);
  const sessionPathRef = useRef<string | null>(null);
  const voiceNavigationRef = useRef<string | null>(null);
  const [target, setTargetState] = useState<Target | null>(null);
  const targetRef = useRef<Target | null>(null);
  const [lastTranscript, setLastTranscript] = useState('');
  const [lastReply, setLastReply] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [listeningHint, setListeningHint] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [autoContinue, setAutoContinue] = useState(true);
  const autoContinueRef = useRef(true);
  const [silenceThreshold, setSilenceThreshold] = useState(DEFAULT_SPEECH_LEVEL);
  const thresholdRef = useRef(DEFAULT_SPEECH_LEVEL);
  const [conciseReply, setConciseReply] = useState(true);
  const conciseReplyRef = useRef(true);
  const [languageChoice, setLanguageChoice] = useState<{ companyId: typeof companyId; language: VoiceLanguage }>();
  const language = (languageChoice?.companyId === companyId ? languageChoice?.language : undefined) ?? health.data?.language ?? 'de';

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
  const playbackEndedAtRef = useRef(0);
  const seenCommentIdsRef = useRef<Set<string>>(new Set());
  const activeIssueIdRef = useRef<string | null>(null);
  const localConversationRef = useRef<(() => void) | null>(null);
  const realtimeConversationRef = useRef<ReturnType<typeof startRealtimeConversation> | null>(null);
  const handsFreeRef = useRef(false);
  const pendingConfirmationRef = useRef<PendingConfirmation | null>(null);
  const confirmationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceOrderSinceRef = useRef<string | null>(null);
  const voiceTurnRef = useRef(0);
  const waitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const waitPlaybackRef = useRef<Promise<void> | null>(null);
  const waitAudioRef = useRef<Promise<AudioBuffer | null> | null>(null);
  const acceptedAudioRef = useRef<Promise<AudioBuffer | null> | null>(null);

  const setPhase = (next: Phase) => { phaseRef.current = next; setPhaseState(next); };
  const setMode = (next: typeof mode) => { modeRef.current = next; setModeState(next); };
  const setTarget = (next: Target | null) => { targetRef.current = next; setTargetState(next); };
  const active = (epoch: number) => epoch === epochRef.current && sessionActiveRef.current && sessionPathRef.current === window.location.pathname;
  const showMicLevel = (rms: number) => setMicLevel(Math.round(Math.min(1, rms / 0.03) * 10) / 10);

  const clearConfirmation = useCallback(() => {
    if (confirmationTimerRef.current) clearTimeout(confirmationTimerRef.current);
    confirmationTimerRef.current = null;
    pendingConfirmationRef.current = null;
  }, []);

  const teardown = useCallback(() => {
    sessionActiveRef.current = false;
    epochRef.current += 1;
    sessionPathRef.current = null;
    voiceNavigationRef.current = null;
    localConversationRef.current?.();
    localConversationRef.current = null;
    realtimeConversationRef.current?.stop();
    realtimeConversationRef.current = null;
    setPlaybackBlocked(false);
    handsFreeRef.current = false;
    clearConfirmation();
    voiceOrderSinceRef.current = null;
    if (waitTimerRef.current) clearTimeout(waitTimerRef.current);
    waitTimerRef.current = null;
    waitPlaybackRef.current = null;
    waitAudioRef.current = null;
    acceptedAudioRef.current = null;
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
    playbackEndedAtRef.current = 0;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    analyserRef.current = null;
    void audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = null;
    activeIssueIdRef.current = null;
    seenCommentIdsRef.current.clear();
    setMicLevel(0);
    setLastTranscript('');
    phaseRef.current = 'off';
    setPhaseState('off');
  }, [clearConfirmation]);

  useEffect(() => {
    window.addEventListener('pagehide', teardown);
    return () => { window.removeEventListener('pagehide', teardown); teardown(); };
  }, [teardown]);
  useEffect(() => { teardown(); setTargetOptions([]); setTarget(routeTarget(window.location.pathname) as Target | null); }, [companyId, teardown]);

  useEffect(() => {
    setListeningHint(false);
    if (phase !== 'listening') return;
    const timer = setTimeout(() => setListeningHint(true), 8000);
    return () => clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    const open = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.companyId !== companyId) return;
      const issueId = typeof detail.issueId === 'string' ? detail.issueId : undefined;
      const next = voiceSessionTarget(pathname, companyId, issueId) as Target | null;
      draftRef.current = null; setMode('conversation');
      teardown(); setGeneralLauncher(!issueId); setTarget(next); setCreatedTasks([]); setLastReply(''); setError(null); setOpened(true);
    };
    window.addEventListener('paperclip-voice-open', open);
    window.addEventListener('paperclip-voice-open-task', open);
    return () => { window.removeEventListener('paperclip-voice-open', open); window.removeEventListener('paperclip-voice-open-task', open); };
  }, [companyId, pathname, teardown]);

  useEffect(() => {
    if (opened && realtimeMode) setTarget(realtimeAgentTarget(pathname, companyId) as Target | null);
  }, [opened, realtimeMode, pathname, companyId]);

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
    if (realtimeConversationRef.current && voiceNavigationRef.current === pathname) {
      voiceNavigationRef.current = null;
      sessionPathRef.current = pathname;
      return;
    }
    teardown();
    draftRef.current = null; setMode('conversation');
    setOpened(false); setError(null); setLastTranscript(''); setLastReply('');
    setTarget(routeTarget(pathname) as Target | null);
  }, [pathname, teardown]);

  async function playDecoded(decoded: AudioBuffer, current: () => boolean): Promise<void> {
    const audioCtx = audioContextRef.current;
    if (!audioCtx || !current()) return;
    await audioCtx.resume();
    await new Promise<void>((resolve, reject) => {
      if (!current()) return resolve();
      playingSourceRef.current?.stop();
      const source = audioCtx.createBufferSource();
      playingSourceRef.current = source;
      source.buffer = decoded;
      source.connect(audioCtx.destination);
      source.onended = () => {
        if (playingSourceRef.current === source) {
          playingSourceRef.current = null;
          playbackEndedAtRef.current = performance.now();
        }
        resolve();
      };
      try { source.start(); }
      catch (cause) {
        if (playingSourceRef.current === source) playingSourceRef.current = null;
        reject(cause);
      }
    });
  }

  async function playAudio(result: AudioResult, epoch: number, turn = voiceTurnRef.current): Promise<void> {
    const audioCtx = audioContextRef.current;
    const current = () => active(epoch) && turn === voiceTurnRef.current;
    if (!audioCtx || !current() || !result.audioBase64) return;
    setPhase('speaking');
    const decoded = await audioCtx.decodeAudioData(audioBase64ToBuffer(result.audioBase64));
    await playDecoded(decoded, current);
  }

  function clearWaitTimer() {
    if (waitTimerRef.current) clearTimeout(waitTimerRef.current);
    waitTimerRef.current = null;
  }

  function scheduleWaitHint(epoch: number, phase: 'sending' | 'waiting', delayMs: number, acknowledged = Promise.resolve()) {
    clearWaitTimer();
    if (waitPlaybackRef.current) return;
    const turn = voiceTurnRef.current;
    const pendingAudio = waitAudioRef.current;
    const timer = setTimeout(() => {
      const current = () => waitTimerRef.current === timer && active(epoch) && voiceTurnRef.current === turn && phaseRef.current === phase;
      void pendingAudio?.then(async audio => {
        await acknowledged;
        if (audio && current() && !waitPlaybackRef.current) waitPlaybackRef.current = playDecoded(audio, current).catch(() => undefined);
      }).catch(() => undefined);
    }, delayMs);
    waitTimerRef.current = timer;
  }

  async function audioJob<T>(action: (params: Record<string, unknown>) => Promise<unknown>, params: Record<string, unknown>, epoch: number, turn?: number): Promise<T> {
    const result = await waitForVoiceJob(
      (payload: Record<string, unknown>) => action(payload),
      (payload: Record<string, unknown>) => poll(payload),
      { companyId, ...params },
      () => active(epoch) && (turn === undefined || turn === voiceTurnRef.current),
      { cancel: (payload: Record<string, unknown>) => cancel(payload), intervalMs: localConversationRef.current ? 400 : 1000 },
    );
    return result as T;
  }

  async function sayStatus(status: string, epoch: number): Promise<void> {
    setPhase('speaking');
    const result = await audioJob<AudioResult>(speakStatus, { status, language }, epoch);
    await playAudio(result, epoch);
  }

  async function waitForAgent(issue: string, epoch: number): Promise<void> {
    const turn = voiceTurnRef.current;
    const current = () => active(epoch) && turn === voiceTurnRef.current;
    setPhase('waiting');
    const acceptedAudio = acceptedAudioRef.current;
    const acknowledged = Promise.resolve(waitPlaybackRef.current).then(async () => {
      const audio = await acceptedAudio;
      if (audio && current() && phaseRef.current === 'waiting') return playDecoded(audio, current);
    }).catch(() => undefined);
    if (handsFreeRef.current) scheduleWaitHint(epoch, 'waiting', 3000, acknowledged);
    const deadline = Date.now() + 15 * 60 * 1000;
    while (current() && phaseRef.current === 'waiting' && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, localConversationRef.current ? 1000 : 1800));
      if (!current() || phaseRef.current !== 'waiting') return;
      const comments = await apiComments(issue);
      if (!current() || phaseRef.current !== 'waiting') return;
      const newReplies = comments.filter((comment) => !seenCommentIdsRef.current.has(comment.id) && isAgentReply(comment));
      for (const comment of comments) seenCommentIdsRef.current.add(comment.id);
      if (newReplies.length) {
        const latest = newReplies[newReplies.length - 1];
        clearWaitTimer();
        const spoken = await audioJob<AudioResult>(speakComment, { issueId: issue, commentId: latest.id, language, voiceOrderSince: voiceOrderSinceRef.current }, epoch, turn);
        await acknowledged;
        if (!current()) return;
        setLastReply(latest.body ?? '');
        await playAudio(spoken, epoch, turn);
        if (!current()) return;
        if (handsFreeRef.current || autoContinueRef.current) await startCapture(epoch);
        else setPhase('ready');
        return;
      }
    }
    if (current() && phaseRef.current === 'waiting') {
      setError('Noch keine Agentenantwort. Die Aufgabe läuft in Paperclip weiter; neue Agentenmeldungen werden weiter beobachtet.');
      if (handsFreeRef.current || autoContinueRef.current) await startCapture(epoch);
      else setPhase('ready');
    }
  }

  async function submitTranscript(text: string, epoch: number, approved?: PendingConfirmation): Promise<void> {
    if (!active(epoch) || phaseRef.current === 'sending') return;
    if (!text.trim()) throw new Error('Das Transkript ist leer.');
    if (modeRef.current === 'dictation') {
      const binding = draftRef.current;
      if (!binding) throw new Error('Die ursprüngliche Eingabe ist nicht mehr verfügbar.');
      appendDictation(binding, text);
      teardown(); draftRef.current = null; setOpened(false);
      return;
    }
    if (handsFreeRef.current && (!approved || pendingConfirmationRef.current !== approved || approved.text !== text || performance.now() >= approved.expiresAt)) {
      throw new Error('Die Nachricht braucht eine gültige Sprachbestätigung.');
    }
    const selected = approved?.target ?? targetRef.current;
    if (!selected) throw new Error('Wähle zuerst einen Agenten oder eine Aufgabe.');
    clearConfirmation();
    setPhase('sending');
    if (approved) {
      waitPlaybackRef.current = null;
      scheduleWaitHint(epoch, 'sending', 1200);
    }
    const issue = activeIssueIdRef.current ?? await resolveIssue(companyId, selected);
    if (!active(epoch)) return;
    activeIssueIdRef.current = issue;

    // Establish a baseline BEFORE submitting; never read an old reply aloud.
    const before = await apiComments(issue);
    for (const c of before) seenCommentIdsRef.current.add(c.id);
    if (!active(epoch)) return;
    const clientRequestId = crypto.randomUUID();
    const message = voiceMessage(text, conciseReplyRef.current, language, Boolean(approved));
    // Native authenticated Paperclip user operation, not a parallel plugin agent chat.
    // 5xx or transport failure is an UNKNOWN outcome: never retry automatically.
    try {
      const receipt = await postNativeComment(issue, message, clientRequestId);
      if (active(epoch) && approved && typeof receipt?.createdAt === 'string' && Number.isFinite(Date.parse(receipt.createdAt))) {
        voiceOrderSinceRef.current ??= receipt.createdAt;
      }
    }
    catch { throw new Error('Senden möglicherweise erfolgt. Bitte den Chat prüfen, bevor du erneut sendest.'); }
    if (!active(epoch)) return;
    // Imported recordings are a single dictation, with no live microphone or
    // playback context. Finish instead of entering the continuous voice loop.
    if (!streamRef.current) { teardown(); setPhase('submitted'); return; }
    if (handsFreeRef.current) { await waitForAgent(issue, epoch); return; }
    try { await sayStatus('submitted', epoch); }
    catch { throw new Error('Nachricht wurde gesendet, aber die Sprachausgabe ist ausgefallen. Bitte den Chat prüfen.'); }
    if (active(epoch)) await waitForAgent(issue, epoch);
  }

  async function readConfirmation(pending: PendingConfirmation, epoch: number, repeat = false): Promise<void> {
    setPhase('speaking');
    if (repeat) {
      await sayStatus('retry', epoch);
    } else {
      const prompt = await audioJob<AudioResult>(speakConfirmation, { transcript: pending.text, language }, epoch);
      if (!prompt.audioBase64) throw new Error('Die Sprachbestätigung konnte nicht abgespielt werden.');
      await playAudio(prompt, epoch);
    }
    if (!active(epoch) || pendingConfirmationRef.current !== pending) return;
    pending.expiresAt = performance.now() + CONFIRMATION_TIMEOUT_MS;
    confirmationTimerRef.current = setTimeout(() => {
      if (!active(epoch) || pendingConfirmationRef.current !== pending) return;
      clearConfirmation();
      setLastTranscript('');
      setError('Bestätigung abgelaufen. Bitte sage die Nachricht erneut.');
      if (phaseRef.current === 'confirming') setPhase('listening');
    }, CONFIRMATION_TIMEOUT_MS);
    await startCapture(epoch);
  }

  async function receiveTranscript(text: string, epoch: number): Promise<void> {
    if (!active(epoch)) return;
    const pending = pendingConfirmationRef.current;
    if (!text) {
      if (modeRef.current === 'dictation') await sayStatus('no_speech', epoch);
      else setError(pending ? 'Bestätigung nicht verstanden. Sag Ja, Nein oder Korrektur.' : 'Kein Satz erkannt. Ich höre weiter zu.');
      await startCapture(epoch);
      return;
    }
    if (!handsFreeRef.current) {
      setLastTranscript(text);
      setPhase('review');
      return;
    }
    const decision = voiceConfirmationDecision(text, language);
    if (pending && performance.now() < pending.expiresAt) {
      if (decision.kind === 'approve') { await submitTranscript(pending.text, epoch, pending); return; }
      if (decision.kind === 'discard') {
        clearConfirmation();
        setLastTranscript('');
        await sayStatus('cancelled', epoch);
        await startCapture(epoch);
        return;
      }
      if (decision.kind === 'unclear') {
        if (confirmationTimerRef.current) clearTimeout(confirmationTimerRef.current);
        pending.expiresAt = 0;
        await readConfirmation(pending, epoch, true);
        return;
      }
    } else if (decision.kind === 'approve' || decision.kind === 'discard') {
      setError('Es wartet keine Nachricht auf Bestätigung.');
      await startCapture(epoch);
      return;
    }
    const draft = decision.kind === 'correct' ? decision.text : text;
    clearConfirmation();
    if (draft.length > MAX_CONFIRMATION_CHARS) {
      setLastTranscript('');
      await sayStatus('too_long', epoch);
      await startCapture(epoch);
      return;
    }
    const target = pending?.target ?? targetRef.current;
    if (!target) throw new Error('Wähle zuerst einen Agenten oder eine Aufgabe.');
    const proposal = { text: draft, target, expiresAt: 0 };
    pendingConfirmationRef.current = proposal;
    setLastTranscript(draft);
    await readConfirmation(proposal, epoch);
  }

  async function processRecording(blob: Blob, epoch: number): Promise<void> {
    if (!active(epoch)) return;
    try {
      setPhase('transcribing');
      if (blob.size < 500 || blob.size > 2 * 1024 * 1024) throw new Error('Audioaufnahme ist zu kurz oder zu groß (max. 2 MiB).');
      const audioBase64 = await audioBlobToBase64(blob);
      if (!active(epoch)) return;
      const transcription = await audioJob<{ text: string }>(transcribe, { audioBase64, mimeType: blob.type || 'audio/webm', language }, epoch);
      await receiveTranscript(transcription.text?.trim() ?? '', epoch);
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
      const turn = voiceTurnRef.current;
      const current = () => active(epoch) && turn === voiceTurnRef.current;
      void (async () => {
        try {
          const comments = await apiComments(currentIssue);
          if (!current() || phaseRef.current !== 'listening' || utteranceStartedRef.current) return;
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
          const spoken = await audioJob<AudioResult>(speakComment, { issueId: currentIssue, commentId: latest.id, language, voiceOrderSince: voiceOrderSinceRef.current }, epoch, turn);
          if (!current()) return;
          setLastReply(latest.body ?? '');
          await playAudio(spoken, epoch, turn);
          if (!current()) return;
          if (handsFreeRef.current || autoContinueRef.current) await startCapture(epoch);
          else setPhase('ready');
        } catch (cause) {
          if (current()) { teardown(); setError(`Antwort-Beobachtung: ${friendlyError(cause)}`); setPhase('error'); }
        } finally {
          monitorBusyRef.current = false;
        }
      })();
    }, 2500);
  }

  async function startCapture(epoch: number): Promise<void> {
    if (!active(epoch)) return;
    const echoPause = playbackEndedAtRef.current + 250 - performance.now();
    if (playbackEndedAtRef.current && echoPause > 0) {
      await new Promise(resolve => setTimeout(resolve, echoPause));
      if (!active(epoch)) return;
    }
    setMicLevel(0);
    if (localConversationRef.current) {
      setPhase(pendingConfirmationRef.current ? 'confirming' : 'listening');
      ensureReplyMonitor(epoch);
      return;
    }
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
    const detectsSpeech = createSpeechDetector(() => thresholdRef.current);
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
    setPhase(pendingConfirmationRef.current ? 'confirming' : 'listening');
    const samples = new Float32Array(analyser.fftSize);
    silenceIntervalRef.current = setInterval(() => {
      if (!active(epoch) || recorder.state === 'inactive') return;
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) sum += sample * sample;
      const rms = Math.sqrt(sum / samples.length);
      showMicLevel(rms);
      const now = performance.now();
      const dt = now - lastTick;
      lastTick = now;
      const speech = detectsSpeech(rms, spoke);
      const next = vadDecision({ speech, elapsedMs: now - started, silenceMs: silenceMs + dt, spoke });
      if (!spoke && next.spoke) {
        voiceTurnRef.current++;
        clearWaitTimer();
        setError(null);
        setPhase('capturing');
      }
      spoke = next.spoke;
      utteranceStartedRef.current = spoke;
      silenceMs = next.silenceMs;
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

  async function startSession(handsFree = false): Promise<void> {
    if (!['off', 'error', 'submitted'].includes(phaseRef.current)) return;
    if (!companyId || (!targetRef.current && !draftRef.current)) { setError('Wähle zuerst einen Chat oder eine Aufgabe.'); return; }
    const canStream = handsFree && language === 'de' && health.data?.streamingReady === true && typeof AudioWorkletNode !== 'undefined';
    if (!navigator.mediaDevices?.getUserMedia || (!canStream && !window.MediaRecorder)) { setError('Dieser Browser unterstützt keine sichere Audioaufnahme. HTTPS/localhost erforderlich.'); return; }
    if (health.data?.ready === false) { setError('Der lokale Audiodienst ist noch nicht bereit. Bitte die Voice-Plugin-Einstellungen prüfen.'); return; }
    teardown();
    handsFreeRef.current = handsFree;
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
        await ensureAgentChatAvailable(fetch, { allowEnable: !handsFree });
        if (epoch !== epochRef.current || sessionPathRef.current !== window.location.pathname) return;
      }
      if (epoch !== epochRef.current || sessionPathRef.current !== window.location.pathname) return;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (epoch !== epochRef.current || sessionPathRef.current !== window.location.pathname) { stream.getTracks().forEach((track) => track.stop()); return; }
      streamRef.current = stream;
      for (const track of stream.getAudioTracks()) track.addEventListener('ended', () => {
        if (!active(epoch)) return;
        teardown(); setError('Die Mikrofonverbindung wurde getrennt. Wähle ein verfügbares Mikrofon und starte erneut.'); setPhase('error');
      }, { once: true });
      const input = ctx.createMediaStreamSource(stream);
      if (handsFree) {
        const preload = (status: string) => audioJob<AudioResult>(speakStatus, { status, language }, epoch).then(result => {
          if (!active(epoch) || !result.audioBase64) return null;
          return ctx.decodeAudioData(audioBase64ToBuffer(result.audioBase64));
        }).catch(() => null);
        waitAudioRef.current = preload('waiting');
        acceptedAudioRef.current = waitAudioRef.current.then(() => active(epoch) ? preload('accepted') : null);
      }
      if (canStream && ctx.audioWorklet && ctx.sampleRate >= 16_000) {
        const onError = (cause: unknown) => {
          if (active(epoch)) { teardown(); setError(friendlyError(cause)); setPhase('error'); }
        };
        const stop = await startLocalConversation({
          context: ctx, input, companyId, start: startStream, update: updateStream,
          active: () => active(epoch),
          canListen: () => !playingSourceRef.current && ['listening', 'capturing', 'confirming'].includes(phaseRef.current),
          threshold: () => thresholdRef.current,
          onLevel: showMicLevel,
          onStartSpeech: () => {
            voiceTurnRef.current++;
            clearWaitTimer();
            utteranceStartedRef.current = true;
            setError(null);
            setPhase('capturing');
          },
          onEndSpeech: () => {
            utteranceStartedRef.current = false;
            setPhase('transcribing');
          },
          recoverText: async jobId => (await audioJob<{ text: string }>(async () => ({ jobId }), {}, epoch)).text,
          onText: text => {
            const turn = voiceTurnRef.current;
            void receiveTranscript(text, epoch).catch(cause => { if (voiceTurnRef.current === turn) onError(cause); });
          },
          onError,
        });
        if (!active(epoch)) { stop(); return; }
        localConversationRef.current = stop;
        await startCapture(epoch);
        return;
      }
      if (!window.MediaRecorder) throw new Error('Dieser Browser unterstützt keine Audioaufnahme für diese Sprache.');
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      input.connect(analyser);
      analyserRef.current = analyser;
      await startCapture(epoch);
    } catch (cause) {
      if (epoch !== epochRef.current || sessionPathRef.current !== window.location.pathname) return;
      teardown();
      setError(`Sprachmodus konnte nicht gestartet werden: ${friendlyError(cause)}`);
      setPhase('error');
    }
  }

  function startRealtimeSession() {
    if (!realtimeMode || !['off', 'error'].includes(phaseRef.current)) return;
    const selected = targetRef.current;
    const defaultAgent = selected?.kind === 'chat' && targetOptions.some(option => option.kind === 'chat' && option.ref === selected.ref) ? selected.ref : '';
    const workspaceAccess = health.data?.workspaceAccess === true;
    if (!defaultAgent && !workspaceAccess) {
      setError('Wähle zuerst einen Agenten für mögliche Aufgaben.');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined') {
      setError('Dieser Browser unterstützt kein WebRTC mit sicherem Mikrofonzugriff.');
      return;
    }
    teardown();
    setError(null);
    setLastReply('');
    setCreatedTasks([]);
    setPhase('starting');
    const epoch = epochRef.current;
    sessionPathRef.current = window.location.pathname;
    sessionActiveRef.current = true;
    if (defaultAgent) rememberVoiceAgent(companyId, defaultAgent);
    let waitClip: AudioBuffer | undefined;
    if (health.data?.ready && typeof AudioContext !== 'undefined') {
      try {
        const ctx = new AudioContext();
        audioContextRef.current = ctx;
        void ctx.resume().then(() => audioJob<AudioResult>(speakStatus, { status: 'waiting', language }, epoch)).then(async result => {
          if (active(epoch) && result.audioBase64) waitClip = await ctx.decodeAudioData(audioBase64ToBuffer(result.audioBase64));
        }).catch(() => undefined);
      } catch { /* A missing wait clip must not delay the conversation. */ }
    }
    const onError = (cause: unknown) => {
      if (!active(epoch)) return;
      teardown();
      setError(friendlyError(cause));
      setPhase('error');
    };
    try {
      realtimeConversationRef.current = startRealtimeConversation({
        companyId, agentId: defaultAgent, language, workspaceAccess,
        connect: connectRealtime, disconnect: disconnectRealtime,
        onPhase(next) {
          if (!active(epoch)) return;
          if (next === 'capturing') playingSourceRef.current?.stop();
          setPhase(next);
        },
        onMicLevel: showMicLevel, onReply: setLastReply, onTasks: setCreatedTasks, onError,
        onNavigate(path) {
          if (!active(epoch) || !context.companyPrefix) return false;
          const destination = `/${encodeURIComponent(context.companyPrefix)}${path}`;
          if (destination !== window.location.pathname) {
            voiceNavigationRef.current = destination;
            hostNavigation.navigate(destination);
          }
          return true;
        },
        onPlaybackBlocked: setPlaybackBlocked,
        waitCue: () => waitClip ? playDecoded(waitClip, () => active(epoch) && phaseRef.current === 'saving') : Promise.resolve(),
      });
    } catch (cause) { onError(cause); }
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

  const targetLabel = mode === 'dictation' ? 'Diktat für diese Eingabe – kein automatischer Versand' : target ? (targetOptions.find(option => option.kind === target.kind && option.ref === target.ref)?.label ?? (target.kind === 'issue' ? `Aufgabe ${target.ref.slice(0, 8)}` : 'Ausgewählter Chat')) : 'Kein Ziel';
  const canStart = phase === 'off' || phase === 'error' || phase === 'submitted';
  const canStartHandsFree = canStart && !realtimeMode && mode === 'conversation' && health.data?.ready === true;
  const visibleTargets = realtimeMode ? targetOptions.filter(option => option.kind === 'chat') : targetOptions;
  const handsFreeActive = handsFreeRef.current;
  const iconButton: CSSProperties = { width: 32, height: 32, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: 0, borderRadius: 8, cursor: 'pointer' };
  const panelHost = mode === 'dictation' ? draftRef.current?.root.closest<HTMLElement>('[role="dialog"]') : null;
  const panel = opened && <section id="paperclip-voice-dialog" className="pc-voice-panel" style={{ ...P.panel, ...(panelHost ? { position: 'relative', right: 'auto', bottom: 'auto', margin: 12, width: 'auto', maxWidth: 'none', maxHeight: '60dvh', flexShrink: 1 } : {}) }} aria-label={mode === 'dictation' ? 'Diktat' : mode === 'read' ? 'Antwort vorlesen' : 'Sprachmodus'} aria-live="polite">

      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <h2 style={P.title}>{mode === 'dictation' ? 'Diktat' : mode === 'read' ? 'Antwort vorlesen' : 'Sprachmodus'}</h2>
        <button type="button" style={{ ...P.button, background: 'transparent', border: 0, fontSize: 20, padding: '2px 6px', margin: 0, color: 'var(--muted-foreground)' }} onClick={() => { teardown(); setOpened(false); }} aria-label="Panel schließen">×</button>
      </header>
      <p style={P.muted}>{mode === 'dictation' ? 'Diktieren oder eine Aufnahme importieren, Text prüfen und in diese Eingabe übernehmen. Absenden erfolgt über den normalen Sendebutton.' : mode === 'read' ? 'Die letzte Agentenantwort wird lokal vorgelesen.' : realtimeMode ? health.data?.workspaceAccess ? 'Frag nach Aufgaben, Projekten oder Agenten. Voice fragt vor Änderungen einmal nach. OpenAI erhält die für deine Anfrage benötigten Paperclip-Ergebnisse.' : 'Sprich mit Voice. Vor dem Anlegen der besprochenen Aufgaben fragt Voice einmal nach. Das Gesprächsaudio wird an OpenAI übertragen.' : 'Im Freisprechen liest Voice deine Nachricht vor und wartet auf dein Ja. Mit Vorschau kannst du das Transkript bearbeiten.'}</p>
      <p style={{ ...P.muted, margin: '12px 0', display: 'flex', alignItems: 'center', gap: 8 }} role="status">
        {(['listening', 'capturing', 'confirming'].includes(phase)) && <MicrophoneWave level={micLevel} capturing={phase === 'capturing'} />}
        {({ off: 'Bereit zum Starten', starting: realtimeMode ? 'Sprachverbindung wird aufgebaut …' : 'Mikrofon wird geöffnet …', ready: 'Bereit', listening: listeningHint ? 'Noch keine Sprache erkannt. Prüfe das Mikrofon oder sprich näher hinein.' : 'Ich höre zu …', capturing: 'Sprache erkannt. Ich nehme auf …', transcribing: 'Transkribiere …', confirming: realtimeMode ? 'Warte auf deine Freigabe …' : 'Warte auf Ja, Nein oder Korrektur …', review: 'Transkript prüfen', sending: 'Sende an Paperclip …', submitted: 'Nachricht gesendet. Die Antwort erscheint in Paperclip.', waiting: 'Nachricht gesendet. Warte auf Agentenantwort …', thinking: 'Voice antwortet gleich …', saving: 'Paperclip verarbeitet die Änderung …', speaking: 'Sprachausgabe läuft …', error: 'Fehler' } as Record<Phase,string>)[phase]}
      </p>
      {!realtimeMode && <p style={P.muted}>Lokale Spracherkennung: {health.loading ? 'Wird geprüft …' : health.data?.ready ? 'Bereit' : 'Nicht erreichbar'}</p>}
      <label htmlFor="voice-language">Sprache</label>
      <select id="voice-language" style={P.field} value={language} disabled={!canStart} onChange={(event) => setLanguageChoice({ companyId, language: event.target.value as VoiceLanguage })}>
        {Object.entries(VOICE_LANGUAGES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      {!realtimeMode && <p style={P.muted}>Aktueller Chat: {targetLabel}</p>}
      {mode === 'conversation' && <label>{realtimeMode ? 'Agent für Aufgaben' : 'Chat oder Aufgabe'}<select style={P.field} disabled={!canStart} value={target ? `${target.kind}:${target.ref}` : ''} onChange={event => {
        const selected = visibleTargets.find(option => `${option.kind}:${option.ref}` === event.target.value);
        if (selected?.kind === 'chat' || !selected) rememberVoiceAgent(companyId, selected?.ref);
        setTarget(selected ?? null);
      }}><option value="">Bitte wählen …</option>
        {target && !visibleTargets.some(option => option.kind === target.kind && option.ref === target.ref) && <option value={`${target.kind}:${target.ref}`}>{targetLabel}</option>}
        {visibleTargets.map(option => <option key={`${option.kind}:${option.ref}`} value={`${option.kind}:${option.ref}`}>{realtimeMode ? option.label.replace(/^Chat: /, '') : option.label}</option>)}
      </select></label>}
      {mode !== 'read' && !realtimeMode && <details style={{ margin: '12px 0', color: 'var(--muted-foreground)', fontSize: 13 }}>
      <summary style={{ cursor: 'pointer', padding: '5px 0' }}>Optionen</summary>
      {mode === 'conversation' && <>
        <label style={{ display: 'block', marginBottom: 7 }}><input type="checkbox" checked={handsFreeActive || autoContinue} disabled={handsFreeActive} onChange={(event) => { autoContinueRef.current = event.target.checked; setAutoContinue(event.target.checked); }} /> Nach Antwort weiter zuhören</label>
        <label style={{ display: 'block', marginBottom: 7 }}><input type="checkbox" checked={conciseReply} onChange={(event) => { conciseReplyRef.current = event.target.checked; setConciseReply(event.target.checked); }} /> Knappe Antworten anfordern (sichtbar im Chat)</label>
      </>}
      <label style={P.muted} htmlFor="voice-threshold">Sprechschwelle (links für leise Stimmen)</label>
      <input id="voice-threshold" type="range" min="0.004" max="0.05" step="0.002" value={silenceThreshold} onChange={(event) => { const n = Number(event.target.value); thresholdRef.current = n; setSilenceThreshold(n); }} style={{ width: '100%', margin: '4px 0 10px' }}/>
      <label htmlFor="voice-import" style={P.muted}>Aufnahme importieren (mit Textvorschau)</label>
      <input id="voice-import" type="file" accept="audio/webm,audio/ogg,audio/mp4,audio/wav,.wav" disabled={!canStart} onChange={event => {
        const file = event.currentTarget.files?.[0]; event.currentTarget.value = '';
        if (file) void importRecording(file);
      }} style={{ display: 'block', maxWidth: '100%', margin: '6px 0' }} />
      </details>}
      <div>
        {canStart && realtimeMode && <button type="button" style={P.primary} onClick={startRealtimeSession}>Gespräch starten</button>}
        {realtimeMode && playbackBlocked && <button type="button" style={P.button} onClick={() => void realtimeConversationRef.current?.play()}>Ton aktivieren</button>}
        {canStartHandsFree && <button type="button" style={P.primary} onClick={() => void startSession(true)}>Freisprechen starten</button>}
        {canStart && mode !== 'read' && !realtimeMode ? <button type="button" style={canStartHandsFree ? P.button : P.primary} disabled={generalLauncher && mode === 'conversation' && health.loading} onClick={() => void startSession()}>{mode === 'dictation' ? 'Diktat starten' : 'Aufnahme mit Vorschau starten'}</button> : null}
        {phase !== 'off' && <button type="button" style={P.button} onClick={() => { teardown(); setError(null); }}>Stoppen</button>}
        {phase === 'ready' && streamRef.current && <button type="button" style={P.button} onClick={() => { const epoch = epochRef.current; void startCapture(epoch); }}>Weitere Anweisung</button>}
        {phase === 'review' && <button type="button" style={P.button} onClick={() => void submitTranscript(lastTranscript, epochRef.current).catch(cause => { if (modeRef.current !== 'dictation') { teardown(); setPhase('error'); } setError(friendlyError(cause)); })}>{mode === 'dictation' ? 'In Eingabe übernehmen' : 'Transkript absenden'}</button>}
      </div>
      {realtimeMode && createdTasks.length > 0 && <p role="status">{createdTasks.length === 1 ? 'Aufgabe' : 'Aufgaben'} {createdTasks.join(', ')} angelegt.</p>}
      {lastTranscript && <div style={{ marginTop: 12 }}><strong>{pendingConfirmationRef.current ? 'Entwurf zur Bestätigung' : 'Zuletzt verstanden'}</strong><textarea style={{ ...P.field, minHeight: 60 }} value={lastTranscript} onChange={(event) => setLastTranscript(event.target.value)} disabled={phase !== 'review'} /></div>}
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
    {navigation && createPortal(<button type="button" className="flex items-center gap-2.5 mx-2 rounded-lg px-2 py-1.5 pointer-coarse:py-1 text-(length:--text-compact) font-medium transition-colors bg-transparent text-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground" style={{ border: 0, width: 'calc(100% - 16px)', cursor: 'pointer' }} onClick={() => window.dispatchEvent(new CustomEvent('paperclip-voice-open', { detail: { companyId } }))}><VoiceIcon kind="microphone" /><span>Voice mode</span></button>, navigation)}
    {panelHost && panel ? createPortal(panel, panelHost) : panel}
  </>;
}
