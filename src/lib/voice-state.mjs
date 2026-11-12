/** Tab-local presentation state. This is never an authorization or business event. */
export const VOICE_STATE_EVENT = 'paperclip-companion:voice-state:v1';
export const VOICE_STATE_REQUEST_EVENT = 'paperclip-companion:voice-state-request:v1';
export const VOICE_PHASES = Object.freeze(['off', 'starting', 'ready', 'listening', 'transcribing', 'review', 'sending', 'waiting', 'speaking', 'error']);

export function clampSpeechEnergy(value) {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

export function createVoiceStateBridge({ eventTarget = window, createSessionId = () => crypto.randomUUID() } = {}) {
  let snapshot = null;
  let live = false;
  let disposed = false;

  function publish() {
    if (!snapshot || disposed) return;
    snapshot = Object.freeze({ ...snapshot, sequence: snapshot.sequence + 1 });
    eventTarget.dispatchEvent(new CustomEvent(VOICE_STATE_EVENT, { detail: snapshot }));
  }

  function end(sessionId, phase = 'off') {
    if (!snapshot || snapshot.sessionId !== sessionId || !live || disposed) return;
    if (phase !== 'off' && phase !== 'error') throw new Error('Invalid terminal voice phase');
    live = false; // Invalidate callbacks before dispatching the terminal state.
    snapshot = { ...snapshot, phase, speechEnergy: 0 };
    publish();
  }

  function start({ companyId, conversationId = null, agentId = null }) {
    if (disposed) throw new Error('Voice bridge is disposed');
    if (typeof companyId !== 'string' || !companyId ||
        (conversationId !== null && (typeof conversationId !== 'string' || !conversationId)) ||
        (agentId !== null && (typeof agentId !== 'string' || !agentId))) throw new Error('Invalid voice context');
    if (snapshot) end(snapshot.sessionId);
    const sessionId = createSessionId();
    snapshot = { version: 1, companyId, conversationId, agentId, sessionId, sequence: 0, phase: 'starting', speechEnergy: 0 };
    live = true;
    publish();
    return sessionId;
  }

  function update(sessionId, phase, speechEnergy = 0) {
    if (!snapshot || snapshot.sessionId !== sessionId || !live || disposed) return;
    if (!VOICE_PHASES.includes(phase)) throw new Error('Invalid voice phase');
    if (phase === 'off' || phase === 'error') return end(sessionId, phase);
    snapshot = { ...snapshot, phase, speechEnergy: phase === 'speaking' ? clampSpeechEnergy(speechEnergy) : 0 };
    publish();
  }

  function request(event) {
    const detail = event.detail;
    if (!snapshot || !detail || detail.version !== 1 ||
        detail.companyId !== snapshot.companyId || detail.conversationId !== snapshot.conversationId) return;
    publish(); // Replays the current state with a new sequence; never starts audio.
  }
  eventTarget.addEventListener(VOICE_STATE_REQUEST_EVENT, request);

  function clear() {
    if (snapshot) end(snapshot.sessionId);
    snapshot = null;
  }

  return {
    start, update, end, clear,
    dispose() {
      clear();
      disposed = true;
      eventTarget.removeEventListener(VOICE_STATE_REQUEST_EVENT, request);
    },
  };
}
