/**
 * Authenticated, same-origin Paperclip issue/chat calls. These operations use
 * the *normal* UI API; no separate plugin-owned LLM sessions or message store.
 *
 * Caller owns retries. In particular, comment POST errors may have an unknown
 * commit outcome and must NEVER be retried automatically.
 */
export async function paperclipApi(path, { method = 'GET', body, doFetch = fetch } = {}) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) {
    throw new Error('Invalid Paperclip API path');
  }
  const response = await doFetch(`/api${path}`, {
    method,
    credentials: 'include',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    // Do not log or echo raw response bodies (potentially sensitive issue data).
    throw new Error(`Paperclip HTTP ${response.status}; the submission outcome may be unknown.`);
  }
  return response.json();
}

export async function ensureNativeAgentChat(companyId, agentRef, doFetch = fetch) {
  if (!companyId || !agentRef) throw new Error('Agent and company are required');
  const issue = await paperclipApi(`/companies/${encodeURIComponent(companyId)}/chats/${encodeURIComponent(agentRef)}`, {
    method: 'POST', body: {}, doFetch,
  });
  if (!issue?.id) throw new Error('Paperclip did not return an agent-chat issue; check Agent Chat settings.');
  return issue.id;
}

export async function resolveNativeTask(companyId, reference, doFetch = fetch) {
  if (!companyId || !reference) throw new Error('Task fehlt.');
  const issue = await paperclipApi(`/issues/${encodeURIComponent(reference)}`, { doFetch });
  if (!issue?.id || issue.companyId !== companyId) throw new Error('Task ist nicht zugänglich oder gehört zu einer anderen Organisation.');
  return issue.id;
}

export async function readNativeComments(issueId, doFetch = fetch) {
  if (!issueId) throw new Error('Issue ID is required');
  const comments = await paperclipApi(`/issues/${encodeURIComponent(issueId)}/comments?order=desc&limit=100`, { doFetch });
  if (!Array.isArray(comments)) throw new Error('Kommentare konnten nicht geladen werden.');
  return comments.reverse();
}

export function postNativeComment(issueId, message, clientRequestId, doFetch = fetch) {
  if (!issueId || !message || !clientRequestId) throw new Error('Missing issue, message or idempotency key');
  return paperclipApi(`/issues/${encodeURIComponent(issueId)}/comments`, {
    method: 'POST', body: { body: message, clientRequestId }, doFetch,
  });
}
