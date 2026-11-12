# Companion voice state v1

This interface is implemented by the local Voice overlay. It adds no worker,
model backend, microphone loop, message store, capability or company stream.
It is presentation state within one browser tab. No installation is performed
by building or running the synthetic tests.

## Events

Listen on `window` for `paperclip-companion:voice-state:v1`. `CustomEvent.detail`
contains exactly these eight fields:

```ts
type VoiceStateV1 = {
  version: 1;
  companyId: string;
  conversationId: string | null;
  agentId: string | null;
  sessionId: string;
  sequence: number;
  phase: 'off' | 'starting' | 'ready' | 'listening' | 'transcribing' |
    'review' | 'sending' | 'waiting' | 'speaking' | 'error';
  speechEnergy: number; // finite, in [0, 1]; zero outside speaking
};
```

`conversationId` is the canonical native Paperclip issue ID, including the
issue underlying an agent chat. It is **not** a route slug, task identifier,
agent ID, SDK session or URL. `agentId` is the native conversation agent.
For ordinary tasks it is null: their assignee is not necessarily the author
of the next spoken comment. A task may contain comments by several agents;
an agent-bound character must not accept null as its own identity. This avoids
attributing multi-agent task speech to the wrong character. Use the native
agent chat for the first character pilot. No names or role profiles are hard-coded.

Context is immutable within a session. The initial startup session has a null
conversation and agent while a **read-only** native lookup runs. Resolution
closes that session with `off`/zero energy and starts a fresh session bound to
the canonical IDs, before requesting microphone access. Missing or inaccessible
existing chats fail; voice startup never creates one. The host Agent Chat
setting is checked, never enabled by Voice. The existing native chat and
normal user identity remain authoritative.

`sessionId` is a fresh opaque UUID. `sequence` starts at 1 and increases on
every emission in that session, including snapshot responses. It does not
provide ordering across sessions or tabs. Terminal `off`/`error` invalidates
all later producer updates for that session. Stop, failure, navigation,
company changes, `pagehide` and unmount reset energy to zero and release audio.
Already submitted comments remain in Paperclip, and agent work may continue.

Request a snapshot after registering your listener:

```js
window.dispatchEvent(new CustomEvent('paperclip-companion:voice-state-request:v1', {
  detail: { version: 1, companyId, conversationId },
}));
```

Both IDs must match **exactly**, including null. Null is not a wildcard.
Matching requests replay the current state with a new sequence. There is no
reply if no snapshot exists, the version is wrong, or the context differs.
An off/error snapshot remains available after Stop in the same conversation.
Navigation, pagehide and unmount clear it. Requests never start voice, resolve
chats, send comments, or read private content.

## Consumer rules

1. Validate version, field types, phase, bounded finite energy, a nonempty
   session ID and positive safe-integer sequence. Ignore unknown versions.
2. Require the consumer's authorized company and canonical conversation ID.
   For a character bound to an agent, also require its agent ID. A null or
   mismatched agent must never select another agent implicitly.
3. Keep the last accepted sequence for the current session. Ignore duplicate
   or lower sequences. On a different session, retire the previous ID; ignore
   all future events from retired IDs. Do not compare UUIDs lexically or reset
   the retired set while retaining the same subscription/context.
4. On consumer navigation, clear local visual state and create a fresh scoped
   subscription; register first, then request a snapshot. Do not reuse cached
   speaking state from another company, conversation, tab or previous page.
5. No response means voice state is unknown/inactive; it is not an error or
   evidence of an active microphone. Stop/error must immediately zero the jaw.
   Dispose listeners and any renderer resources on unmount.

The producer emits synchronously on the tab's event target and rejects old
session tokens. A consumer does not need an asynchronous event replay queue.
The bridge is not a heartbeat or durable log. Treat frozen/background pages
as unavailable for live animation; physical mobile audio is still unverified.
Same-origin code can forge these events. They cannot grant access, confirm an
agreement, approve an action, identify the current user, or mark a task done.
There is no transcript, audio, message body, role profile, token or credential
in the event. Do not persist or broadcast it to other users.

## Suggested renderer mapping

| Voice phase | Character presentation |
| --- | --- |
| off, ready | resting |
| starting, transcribing, sending, waiting | processing |
| listening | listening |
| review | needs_input |
| speaking | speaking, using speechEnergy |
| error | unavailable |

`waiting` describes waiting for a comment or audio, not proven agent work.
`review` means the user can review a transcript, not business approval.
`working` and business-level `needs_input` require separately authorized native
task/run/interaction sources. Successful playback does not prove the user
heard, understood or accepted the response. The renderer adapter belongs to
the Companion/character packages and is not imported by Voice.

## Actual reply energy and cancellation

`reply-playback.mjs` connects each decoded reply through
`AudioBufferSourceNode -> AnalyserNode -> AudioContext.destination`. Every
50 ms while running, the analyser computes `clamp(RMS * 4, 0, 1)` from that
output. This is a bounded animation envelope, not calibrated loudness,
phonemes or proof that a physical loudspeaker is audible. Locally spoken
status clips use the same output path. The microphone analyser is used only
by the existing pause detector and is never exported as speech energy.

Speaking begins only after the output source starts, not while decoding or
fetching TTS. End, stop, output failure and suspended audio zero the envelope.
Suspension presents waiting, and resumed actual playback presents speaking.
A playback generation guards decode/resume, timers and ended callbacks;
the session epoch also guards transcription, comment polling and HTTP replies.
Stop settles the active playback promise, stops/disconnects the source, clears
the sampler and prevents old callbacks from touching the next playback.
Historical comments are baselined at startup, so starting voice does not read
the existing conversation backlog aloud.

## Compatibility

These names and meanings define v1. Do not rename fields, reinterpret null,
change conversation identity, or treat a new phase as known under v1. A future
extension must document backward compatibility; breaking changes use another
event version/name. Consumers should ignore unfamiliar optional fields, never
infer action authority from additional presentation fields.
