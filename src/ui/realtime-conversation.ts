import { approvedTaskWriter, readTaskProposal, taskApproval, taskSpeech, workspaceChangeSpeech } from '../lib/realtime-task.mjs';
import { CONFIRMATION_TIMEOUT_MS } from '../lib/voice-confirmation.mjs';
import { createVoiceWorkspace, workspaceErrorCode } from '../lib/paperclip-workspace.mjs';

type Phase = 'listening' | 'capturing' | 'thinking' | 'confirming' | 'saving' | 'speaking';
type Action = (params: Record<string, unknown>) => Promise<unknown>;
type EventItem = { type?: string; name?: string; call_id?: string; arguments?: string };
type RealtimeEvent = {
  type?: string;
  item_id?: string;
  response_id?: string;
  transcript?: string;
  response?: { id?: string; metadata?: Record<string, string>; status?: string; output?: EventItem[] };
};
type PreparedTask = ReturnType<typeof readTaskProposal>[number] & { assigneeId?: string; assigneeName?: string };
type PreparedChange = Awaited<ReturnType<ReturnType<typeof createVoiceWorkspace>['prepare']>>;
type PendingApproval = {
  proposalId: string;
  questionId?: string;
  asked?: boolean;
  inputId?: string;
  committed?: boolean;
} & ({ kind: 'tasks'; tasks: PreparedTask[] } | { kind: 'change'; change: PreparedChange });

export function startRealtimeConversation(options: {
  companyId: string;
  agentId: string;
  language: string;
  workspaceAccess?: boolean;
  connect: Action;
  disconnect: Action;
  onPhase: (phase: Phase) => void;
  onMicLevel: (level: number) => void;
  onReply: (text: string) => void;
  onTasks: (identifiers: string[]) => void;
  onNavigate?: (path: string) => boolean;
  onError: (error: unknown) => void;
  onPlaybackBlocked: (blocked: boolean) => void;
  waitCue: () => Promise<void>;
}) {
  const { companyId, agentId, language } = options;
  const writeTasks = approvedTaskWriter({ companyId, agentId });
  const workspace = options.workspaceAccess ? createVoiceWorkspace({ companyId, language }) : null;
  const speech = taskSpeech(language);
  const changeSpeech = workspaceChangeSpeech(language);
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
  let saving = false;
  let speechTurns = 0;
  let pendingTasks: PendingApproval | undefined;
  let confirmationTimer: ReturnType<typeof setTimeout> | undefined;
  let queuedResponse: Record<string, unknown> | undefined;
  const startup = setTimeout(() => fail(new Error('Die Audioverbindung konnte nicht rechtzeitig starten.')), 30_000);

  function release(id: string) {
    void options.disconnect({ companyId, sessionId: id }).catch(() => undefined);
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    clearTimeout(startup);
    clearTimeout(disconnected);
    clearPendingTasks();
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

  function reply(response: Record<string, unknown> = {}) {
    if (responding) { queuedResponse = response; return; }
    responding = true;
    options.onPhase('thinking');
    send({ type: 'response.create', response });
  }

  function say(text: string, proposalId?: string) {
    reply({
      tool_choice: 'none',
      instructions: `Speak only this sentence or message, exactly as written: ${JSON.stringify(text)}`,
      ...(proposalId ? { metadata: { proposalId } } : {}),
    });
  }

  function setApprovalTranscription(enabled: boolean) {
    send({ type: 'session.update', session: {
      type: 'realtime', audio: { input: { transcription: enabled ? { model: 'gpt-4o-mini-transcribe' } : null } },
    } });
  }

  function clearPendingTasks() {
    clearTimeout(confirmationTimer);
    if (pendingTasks) setApprovalTranscription(false);
    pendingTasks = undefined;
  }

  function countDownConfirmation() {
    clearTimeout(confirmationTimer);
    confirmationTimer = setTimeout(() => {
      clearPendingTasks();
      if (!stopped && !talking && !saving) options.onPhase('listening');
    }, CONFIRMATION_TIMEOUT_MS);
  }

  async function handleTools(items: EventItem[]) {
    const calls = items.filter(item => item.type === 'function_call' && typeof item.call_id === 'string' && !seen.has(item.call_id));
    if (!calls.length) return;
    const turn = speechTurns;
    const proposalCount = calls.filter(item => item.name === 'propose_tasks' || item.name === 'paperclip_propose_change').length;
    let draft: PendingApproval | undefined;
    let prompt: string | undefined;
    const results = await Promise.all(calls.map(async item => {
      const callId = item.call_id!;
      seen.add(callId);
      if (stopped || talking || !/^[a-zA-Z0-9_-]{1,160}$/.test(callId)) {
        return { callId, output: { status: 'not_proposed', reason: 'interrupted_or_invalid_call' } };
      }
      if (item.name === 'paperclip_read' && workspace) {
        return { callId, output: await workspace.read(item.arguments) };
      }
      try {
        if (item.name === 'paperclip_open' && workspace) {
          const path = await workspace.destination(item.arguments);
          const opened = !stopped && !talking && speechTurns === turn && options.onNavigate?.(path);
          return { callId, output: { status: opened ? 'opened' : 'not_opened' } };
        }
        if (saving || proposalCount !== 1) throw new Error('one_proposal_at_a_time');
        if (item.name === 'paperclip_propose_change' && workspace) {
          const change = await workspace.prepare(item.arguments);
          draft = { proposalId: callId, kind: 'change', change };
          prompt = change.prompt;
          return { callId, output: { status: 'awaiting_approval' } };
        }
        if (item.name === 'propose_tasks') {
          const proposed = readTaskProposal(item.arguments, Boolean(workspace));
          if (!proposed.length) throw new Error('invalid_task_details');
          const tasks = await Promise.all(proposed.map(async task => {
            if (task.assignee && workspace) {
              const agent = await workspace.resolveAssignee(task.assignee);
              return { ...task, assigneeId: agent.id, assigneeName: String(agent.name) };
            }
            if (!agentId) throw new Error('assignee_required');
            return { ...task, assigneeName: undefined };
          }));
          draft = { proposalId: callId, kind: 'tasks', tasks };
          const assignees = [...new Set(tasks.map(task => task.assigneeName).filter(Boolean))];
          prompt = [assignees.join(', ').slice(0, 140), speech.ask(tasks.length)].filter(Boolean).join('. ');
          return { callId, output: { status: 'awaiting_approval', count: tasks.length } };
        }
        throw new Error('unsupported_tool');
      } catch (error) {
        return { callId, output: { status: 'not_proposed', reason: workspaceErrorCode(error) } };
      }
    }));
    const current = !stopped && !talking && turn === speechTurns;
    for (const { callId, output } of results) {
      send({ type: 'conversation.item.create', item: {
        type: 'function_call_output', call_id: callId,
        output: JSON.stringify(current ? output : { status: 'superseded' }),
      } });
    }
    if (!current) return;
    if (draft && prompt) {
      clearPendingTasks();
      pendingTasks = draft;
      setApprovalTranscription(true);
      countDownConfirmation();
      say(prompt, draft.proposalId);
    } else if (!talking && !saving) reply();
  }

  async function saveApproved(draft: PendingApproval) {
    const id = sessionId;
    if (!id || stopped) return;
    const turn = speechTurns;
    saving = true;
    options.onPhase('saving');
    let cue: Promise<void> | undefined;
    const timer = setTimeout(() => {
      if (!stopped && speechTurns === turn && !talking) cue = options.waitCue().catch(() => undefined);
    }, 1600);
    try {
      let receipt: string;
      let identifiers: string[] = [];
      if (draft.kind === 'tasks') {
        const result = await writeTasks(id, draft.proposalId, draft.tasks);
        identifiers = result.identifiers;
        receipt = [identifiers.length ? speech.receipt(identifiers) : '', result.unknownCount ? speech.unknown : ''].filter(Boolean).join(' ');
      } else {
        try {
          await draft.change.execute(crypto.randomUUID());
          receipt = changeSpeech.confirmed;
        } catch { receipt = changeSpeech.unknown; }
      }
      clearTimeout(timer);
      await cue;
      if (stopped) return;
      if (identifiers.length) options.onTasks(identifiers);
      if (speechTurns === turn && !talking) say(receipt);
    } finally {
      clearTimeout(timer);
      saving = false;
    }
  }

  function handleApproval(itemId: string | undefined, transcript: string | undefined) {
    const draft = pendingTasks;
    if (!draft?.committed || draft.inputId !== itemId) return;
    clearPendingTasks();
    const wording = draft.kind === 'tasks' ? speech : changeSpeech;
    if (transcript === undefined) { say(wording.unclear); return; }
    const decision = taskApproval(transcript, language);
    if (decision === 'approve') void saveApproved(draft).catch(fail);
    else if (decision === 'discard') say(wording.declined);
    else reply();
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
        queuedResponse = undefined;
        if (pendingTasks?.asked && !pendingTasks.inputId && event.item_id) pendingTasks.inputId = event.item_id;
        else clearPendingTasks();
        options.onPhase('capturing');
        break;
      case 'input_audio_buffer.speech_stopped':
        talking = false;
        options.onMicLevel(0);
        options.onPhase('thinking');
        break;
      case 'input_audio_buffer.committed':
        if (event.item_id && pendingTasks?.inputId === event.item_id) {
          pendingTasks.committed = true;
          clearTimeout(confirmationTimer);
          confirmationTimer = setTimeout(() => handleApproval(event.item_id, undefined), 6000);
        } else reply();
        break;
      case 'conversation.item.input_audio_transcription.completed':
        handleApproval(event.item_id, event.transcript);
        break;
      case 'conversation.item.input_audio_transcription.failed':
        handleApproval(event.item_id, undefined);
        break;
      case 'response.created':
        responding = true;
        if (pendingTasks && event.response?.metadata?.proposalId === pendingTasks.proposalId && event.response.id) {
          pendingTasks.questionId = event.response.id;
        }
        break;
      case 'output_audio_buffer.started': options.onPhase('speaking'); break;
      case 'output_audio_buffer.stopped': {
        if (pendingTasks && event.response_id && event.response_id === pendingTasks.questionId && !talking) {
          pendingTasks.asked = true;
          countDownConfirmation();
          options.onPhase('confirming');
          break;
        }
        if (!talking) options.onPhase(saving ? 'saving' : 'listening');
        break;
      }
      case 'output_audio_buffer.cleared':
        if (!talking) options.onPhase(saving ? 'saving' : 'listening');
        break;
      case 'response.output_audio_transcript.done':
        if (typeof event.transcript === 'string') options.onReply(event.transcript);
        break;
      case 'response.done':
        responding = false;
        if (event.response?.status === 'completed') {
          void handleTools(event.response.output ?? []).catch(fail);
        } else if (event.response?.status === 'failed' || event.response?.status === 'incomplete') {
          fail(new Error('OpenAI Realtime konnte die Antwort nicht fertigstellen.'));
        }
        if (queuedResponse && !responding && !talking) {
          const next = queuedResponse;
          queuedResponse = undefined;
          reply(next);
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
