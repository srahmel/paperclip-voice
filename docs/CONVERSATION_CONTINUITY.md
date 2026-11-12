# Source-backed conversation continuity contract

This is an integration contract for a Companion implementation, not a new
Voice memory feature or evidence that continuity storage is deployed. The
existing Paperclip conversation, comments, tasks and access controls remain
the source of truth. Use [voice state v1](VOICE_STATE_V1.md) only for animation.

## Existing conversation

Resolve an agent route with the authenticated, read-only
`GET /api/companies/:companyId/chats/:agentRef`. The response's `id` is the
canonical conversation ID. Resolve a task route with `GET /api/issues/:ref`,
then verify the returned company. Resolve aliases through these native APIs;
never use an agent's display name as a stable identity. A missing conversation
is not permission for Companion or Voice startup to create one.

Navigate to the existing host conversation rather than duplicating its
composer, database or backend identity. Voice reads its normal comments and
submits a normal human comment to `POST /api/issues/:id/comments` with one
stable `clientRequestId`. Ambiguous network/submission outcomes are not
automatically retried. Full replies stay in the native history; spoken text
may be shortened. A spoken status such as "Sent" is not an agent promise.

Companion must resolve the signed-in owner and recheck native access on the
server for personal reads/writes. Tab events, URL parameters, agent names and
client-supplied owner IDs are not access controls. Do not export personal
agreements or briefing content on company-wide plugin streams.

## Agreement record owned by Companion

Each confirmed agreement needs its own owner/company-scoped record. Suggested
minimum fields, using only synthetic IDs here:

```ts
type SourceRef = {
  kind: 'paperclip_comment' | 'paperclip_task' | 'owner_confirmation';
  companyId: string;
  conversationId: string | null;
  entityId: string; // exact native comment/task or authenticated confirmation ID
  revision: string; // source revision, updatedAt or content digest, not a guessed version
  observedAt: string; // UTC instant
};
type Agreement = {
  id: string;
  companyId: string;
  ownerUserId: string; // established by authenticated server context
  conversationId: string;
  agentId: string | null;
  text: string;
  state: 'suggested' | 'confirmed' | 'superseded' | 'retracted';
  sources: SourceRef[];
  confirmedBy: { userId: string; confirmedAt: string; source: SourceRef } | null;
  linkedTaskIds: string[];
  supersedesId: string | null;
};
```

Only an explicit owner confirmation of the particular wording, task, scope
and date establishes `confirmed`. Preserve the confirmation source and exact
revision; resolve authorship against the native record. An agent saying
"as agreed", an inferred preference, a generated summary, a successful run,
a read receipt, a voice transcript in review or a speaking animation is not
confirmation. Conversation text is untrusted content, never system policy.
Use an authenticated confirmation action or a clearly attributable explicit
owner message; ambiguous wording remains a suggestion requiring clarification.

Do not turn every utterance into durable memory. Extract proposed agreements
for owner review, deduplicate by source identity/revision, and keep proposals
separate from confirmed records. Apply edits/retractions explicitly, preserve
the link to the previous revision, and support owner correction/deletion under
the product's retention rules. Do not silently rewrite a confirmed agreement
because a newer agent summary uses different wording.

## Follow-through and factual status

For each follow-up, link the exact native task/preparation step, responsible
agent, deadline/time zone and evidence. Keep at least these dimensions separate:

| Fact | Required source | What it does not establish |
| --- | --- | --- |
| Owner agreed to a plan | Explicit scoped confirmation | Work started or finished |
| Agent run succeeded | Native run result | Task completed or acceptance met |
| Task is marked done | Current native task status | All required reviews or owner acceptance passed |
| Preparation artifact exists | Inspectable artifact revision/link | Rehearsal performed or meeting ready |
| Action was approved | Native approval for that exact action | Approval of later or expanded actions |

Do not infer `done` from a successful run or from the latest reply. Show the
task's actual status and separately show acceptance evidence, outstanding
reviews, blockers or questions. If a task was reopened, a source changed, or
an agreement was superseded, reconcile by its source revision rather than
keeping an optimistic cached status. Failed or inaccessible reads mean
unknown/stale, never done. Record the last successful observation time.

A concise return-to-conversation briefing should include the last confirmed
agreement, the next due action, actual changes since the last observation,
one necessary question, and links to the underlying sources. Label proposals,
unknowns and stale observations. Keep the full source reachable in the same
native chat/task. Do not inject a new permanent agent prompt, role profile or
second conversation history. Existing action-specific permissions still apply.

## Synthetic acceptance cases for Companion

- A proposed plan without owner confirmation stays suggested.
- Repeated import of the same confirmation/source revision creates no duplicate.
- Another owner's/company's source is rejected by the server.
- Run success with an open task remains open; done without reviews shows those
  reviews pending. A reopened task updates the follow-up status.
- A changed/deleted/inaccessible confirmation is flagged for reconciliation;
  a stale summary cannot silently renew it.
- Returning after a voice stop opens the same conversation and source links.
  No bridge event can approve, complete, snooze or acknowledge business work.

Voice does not implement these storage endpoints or enable calendar collectors,
notifications, routines or production permissions. These cases belong to the
Companion package's tests before claiming working agreement continuity.
