import { paperclipApi, postNativeComment, readNativeAgentChat } from './paperclip-client.mjs';

const OPEN = ['backlog', 'todo', 'in_progress', 'in_review', 'blocked'];
const TASK_STATUS = [...OPEN, 'done', 'cancelled'];
const PRIORITY = ['critical', 'high', 'medium', 'low'];
const PROJECT_STATUS = ['backlog', 'planned', 'in_progress', 'completed', 'cancelled'];
const GOAL_STATUS = ['planned', 'active', 'achieved', 'cancelled'];
const ROUTINE_STATUS = ['active', 'paused', 'archived'];
const PAGE_SIZE = 100;
const PAGE_LIMIT = 5;
const RESULT_LIMIT = 18;
const READ_RESOURCES = ['dashboard', 'tasks', 'task', 'comments', 'projects', 'project', 'goals', 'agents', 'runs', 'approvals', 'routines', 'routine_runs', 'chat'];
const CHANGE_ACTIONS = ['update_task', 'comment', 'create_project', 'update_project', 'create_goal', 'update_goal', 'pause_agent', 'resume_agent', 'run_agent', 'cancel_run', 'run_routine', 'update_routine', 'message_agent', 'mark_read', 'mark_unread', 'approve_work', 'reject_work'];
const WORK_PAGES = { dashboard: '/dashboard', tasks: '/issues', projects: '/projects', agents: '/agents/all', goals: '/goals', routines: '/routines', approvals: '/approvals/pending' };
const WORK_DETAILS = { project: 'projects', agent: 'agents', goal: 'goals', routine: 'routines', approval: 'approvals' };

export const WORKSPACE_READ_TOOL = {
  type: 'function', name: 'paperclip_read',
  description: 'Read the signed-in user’s Paperclip work. Use this for an overview of open tasks, a status question, or any lookup. Never create a task for a read request.',
  parameters: {
    type: 'object', required: ['resource'], additionalProperties: false,
    properties: {
      resource: { type: 'string', enum: READ_RESOURCES },
      reference: { type: 'string', description: 'Task number, exact project or routine name, or agent name for a detail, comments, routine runs, or chat.' },
      query: { type: 'string', description: 'Optional search query for tasks.' },
      status: { type: 'string', enum: ['open', 'all', ...TASK_STATUS], description: 'Task status. The default for tasks is open.' },
      agent: { type: 'string', description: 'Optional exact agent name to filter tasks or agent runs.' },
      project: { type: 'string', description: 'Optional exact project name to filter tasks or routines.' },
      mine: { type: 'boolean', description: 'For tasks assigned to the signed-in person.' },
      offset: { type: 'integer', minimum: 0, description: 'Continue a bounded task overview using the returned nextOffset.' },
    },
  },
};

export const WORKSPACE_CHANGE_TOOL = {
  type: 'function', name: 'paperclip_propose_change',
  description: 'Prepare one explicit Paperclip change for spoken approval. The app will name the operation and ask. This tool itself only prepares it. For new tasks use propose_tasks.',
  parameters: {
    type: 'object', required: ['action'], additionalProperties: false,
    properties: {
      action: { type: 'string', enum: CHANGE_ACTIONS },
      reference: { type: 'string', description: 'Existing task identifier, exact workspace entity name or ID, or run ID. Omit for creation.' },
      title: { type: 'string', description: 'New title or name for a task, project or goal.' },
      description: { type: 'string', description: 'New task, project or goal description.' },
      status: { type: 'string', description: 'New status in Paperclip. Use done for a completed task.' },
      priority: { type: 'string', enum: PRIORITY },
      agent: { type: 'string', description: 'Exact assignee name for an update_task operation.' },
      project: { type: 'string', description: 'Exact project name to assign a task to that project.' },
      message: { type: 'string', description: 'Text to post as a task comment or send to an agent chat.' },
    },
  },
};

export const WORKSPACE_OPEN_TOOL = {
  type: 'function', name: 'paperclip_open',
  description: 'Open a Paperclip work page or item in the current browser when the user asks to open or show it.',
  parameters: {
    type: 'object', required: ['destination'], additionalProperties: false,
    properties: {
      destination: { type: 'string', enum: [...Object.keys(WORK_PAGES), ...Object.keys(WORK_DETAILS), 'task'] },
      reference: { type: 'string', description: 'Exact name, issue identifier or ID when opening a specific item.' },
    },
  },
};

const CHANGE_NAMES = {
  de: ['Aufgabe ändern', 'Kommentar senden', 'Projekt anlegen', 'Projekt ändern', 'Ziel anlegen', 'Ziel ändern', 'Agent pausieren', 'Agent fortsetzen', 'Agent starten', 'Lauf abbrechen', 'Routine starten', 'Routine ändern', 'Chatnachricht senden', 'Aufgabe als gelesen markieren', 'Aufgabe als ungelesen markieren', 'Arbeitsfreigabe erteilen', 'Arbeitsfreigabe ablehnen'],
  en: ['Update task', 'Post comment', 'Create project', 'Update project', 'Create goal', 'Update goal', 'Pause agent', 'Resume agent', 'Run agent', 'Cancel run', 'Run routine', 'Update routine', 'Send chat message', 'Mark task as read', 'Mark task as unread', 'Approve work', 'Reject work approval'],
  nl: ['Taak wijzigen', 'Reactie plaatsen', 'Project aanmaken', 'Project wijzigen', 'Doel aanmaken', 'Doel wijzigen', 'Agent pauzeren', 'Agent hervatten', 'Agent starten', 'Uitvoering stoppen', 'Routine starten', 'Routine wijzigen', 'Chatbericht versturen', 'Taak als gelezen markeren', 'Taak als ongelezen markeren', 'Werk goedkeuren', 'Werk afwijzen'],
  no: ['Endre oppgave', 'Legge inn kommentar', 'Opprette prosjekt', 'Endre prosjekt', 'Opprette mål', 'Endre mål', 'Pause agent', 'Gjenoppta agent', 'Starte agent', 'Avbryte kjøring', 'Starte rutine', 'Endre rutine', 'Sende chatmelding', 'Markere oppgaven som lest', 'Markere oppgaven som ulest', 'Godkjenne arbeid', 'Avvise godkjenning'],
};

const CHANGE_QUESTIONS = {
  de: 'Soll ich die Änderung ausführen?', en: 'Shall I make the change?',
  nl: 'Zal ik de wijziging uitvoeren?', no: 'Skal jeg utføre endringen?',
};

function inputObject(raw) {
  if (typeof raw !== 'string' || raw.length > 12_000) throw new Error('invalid_arguments');
  try {
    const value = JSON.parse(raw);
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  } catch { /* Malformed tool input is handled below. */ }
  throw new Error('invalid_arguments');
}

function text(value, max = 160) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function normalized(value) {
  return text(value).normalize('NFKC').toLocaleLowerCase('en');
}

function shareText(value, max = 300) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\b(?:sk-[\w-]{12,}|gh[pousr]_[\w-]{12,}|github_pat_[\w-]{12,}|Bearer\s+[\w.-]{12,})/gi, '[redacted]').slice(0, max);
}

function required(value, max) {
  const clean = text(value, max);
  if (!clean || value.trim().length > max) throw new Error('missing_or_invalid_text');
  return clean;
}

function approvedField(value, values) {
  if (!values.includes(value)) throw new Error('invalid_status_or_priority');
  return value;
}

function selectFields(value, fields) {
  const out = {};
  for (const field of fields) {
    const candidate = value?.[field];
    if (typeof candidate === 'string') out[field] = shareText(candidate);
    else if (candidate === null || typeof candidate === 'number' || typeof candidate === 'boolean') out[field] = candidate;
  }
  return out;
}

export function workspaceErrorCode(error) {
  const message = error instanceof Error ? error.message : '';
  if (/^[a-z_]+$/.test(message)) return message;
  if (/Paperclip HTTP (401|403)/.test(message)) return 'permission_denied';
  if (/Paperclip HTTP 404/.test(message)) return 'not_found';
  return 'paperclip_unavailable';
}

export function createVoiceWorkspace({ companyId, language, doFetch = fetch }) {
  const company = `/companies/${encodeURIComponent(companyId)}`;
  const request = (path, options = {}) => paperclipApi(path, { doFetch, signal: AbortSignal.timeout(12_000), ...options });
  const write = (path, body, method = 'POST') => request(path, { method, body });
  const endpoint = (resource, id, suffix = '') => `/${resource}/${encodeURIComponent(id)}${suffix}`;

  async function list(resource, query = '') {
    const rows = await request(`${company}/${resource}${query}`);
    if (!Array.isArray(rows)) throw new Error('unexpected_paperclip_response');
    return rows.filter(row => row && (row.companyId === undefined || row.companyId === companyId));
  }

  async function named(resource, reference) {
    const key = normalized(reference);
    if (!key) throw new Error('missing_reference');
    const rows = await list(resource);
    const matches = rows.filter(row => [row.id, row.name, row.title, row.urlKey].some(value => normalized(value) === key));
    if (matches.length !== 1) throw new Error(matches.length ? 'ambiguous_reference' : 'not_found');
    return matches[0];
  }

  async function issue(reference) {
    const ref = required(reference, 100);
    if (!/^[a-z0-9-]+$/i.test(ref)) throw new Error('use_task_identifier');
    const row = await request(endpoint('issues', ref));
    if (row?.companyId !== companyId || !row.id || row.conversationAgentId) throw new Error('not_found');
    return row;
  }

  function compactTask(row) {
    return selectFields(row, ['identifier', 'title', 'status', 'priority', 'assigneeAgentId', 'projectId', 'dueAt', 'updatedAt']);
  }

  async function tasks(input) {
    const status = input.status ?? 'open';
    const statuses = status === 'open' ? OPEN.join(',') : status === 'all' ? '' : approvedField(status, TASK_STATUS);
    const filters = new URLSearchParams({ view: 'compact', limit: String(PAGE_SIZE), sortField: 'id', sortDir: 'desc' });
    const query = text(input.query);
    if (statuses) filters.set('status', statuses);
    if (query) filters.set('q', query);
    if (input.mine === true) filters.set('assigneeUserId', 'me');
    if (input.agent) filters.set('assigneeAgentId', (await named('agents', input.agent)).id);
    if (input.project) filters.set('projectId', (await named('projects', input.project)).id);
    const offset = Number.isSafeInteger(input.offset) && input.offset >= 0 ? input.offset : 0;
    const found = [];
    let complete = false;
    for (let page = 0; page < PAGE_LIMIT; page++) {
      filters.set('offset', String(offset + page * PAGE_SIZE));
      const rows = await list('issues', `?${filters}`);
      found.push(...rows.filter(row => !row.conversationAgentId && (!statuses || statuses.split(',').includes(row.status))));
      if (rows.length < PAGE_SIZE) { complete = true; break; }
    }
    const counts = {};
    for (const row of found) counts[row.status] = (counts[row.status] ?? 0) + 1;
    return { items: found.slice(0, RESULT_LIMIT).map(compactTask), counts, scanned: found.length, offset, complete,
      ...(found.length > RESULT_LIMIT ? { nextItemOffset: offset + RESULT_LIMIT } : {}),
      ...(complete ? {} : { nextOffset: offset + PAGE_LIMIT * PAGE_SIZE }) };
  }

  async function comments(id) {
    const rows = await request(endpoint('issues', id, '/comments?order=desc&limit=10'));
    if (!Array.isArray(rows)) throw new Error('unexpected_paperclip_response');
    return rows.filter(row => !row.deletedAt).slice(0, 10).map(row => ({
      ...selectFields(row, ['authorType', 'authorAgentId', 'createdAt']), body: shareText(row.body, 900),
    }));
  }

  async function read(raw) {
    try {
      const input = inputObject(raw);
      switch (input.resource) {
        case 'dashboard': {
          const dashboard = await request(`${company}/dashboard`);
          return { status: 'ok', tasks: selectFields(dashboard.tasks, ['open', 'inProgress', 'blocked', 'done']),
            agents: selectFields(dashboard.agents, ['active', 'running', 'paused', 'error']), pendingApprovals: dashboard.pendingApprovals };
        }
        case 'tasks': return { status: 'ok', ...await tasks(input) };
        case 'task': {
          const row = await issue(input.reference);
          return { status: 'ok', item: { ...compactTask(row), description: shareText(row.description, 2500) } };
        }
        case 'comments': return { status: 'ok', items: await comments((await issue(input.reference)).id) };
        case 'chat': {
          const agent = await named('agents', input.reference);
          const chatId = await readNativeAgentChat(companyId, agent.id, doFetch);
          return { status: 'ok', items: await comments(chatId) };
        }
        case 'projects': return { status: 'ok', items: (await list('projects')).slice(0, RESULT_LIMIT).map(row => selectFields(row, ['id', 'name', 'status', 'targetDate', 'leadAgentId'])) };
        case 'project': {
          const project = await named('projects', input.reference);
          return { status: 'ok', item: { ...selectFields(project, ['id', 'name', 'status', 'targetDate', 'leadAgentId']), description: shareText(project.description, 1800) } };
        }
        case 'goals': return { status: 'ok', items: (await list('goals')).slice(0, RESULT_LIMIT).map(row => selectFields(row, ['id', 'title', 'status', 'level'])) };
        case 'agents': return { status: 'ok', items: (await list('agents')).slice(0, RESULT_LIMIT).map(row => selectFields(row, ['id', 'name', 'role', 'title', 'status'])) };
        case 'runs': {
          const agent = input.agent ? await named('agents', input.agent) : null;
          const query = new URLSearchParams({ limit: '12', summary: 'true' });
          if (agent) query.set('agentId', agent.id);
          const runs = await list('heartbeat-runs', `?${query}`);
          return { status: 'ok', items: runs.map(row => selectFields(row, ['id', 'agentId', 'status', 'startedAt', 'finishedAt', 'errorCode'])) };
        }
        case 'approvals': return { status: 'ok', items: (await list('approvals', '?status=pending')).slice(0, RESULT_LIMIT).map(row => selectFields(row, ['id', 'type', 'status', 'requestedByAgentId', 'createdAt'])) };
        case 'routines': {
          const project = input.project ? await named('projects', input.project) : null;
          const query = project ? `?projectId=${encodeURIComponent(project.id)}` : '';
          return { status: 'ok', items: (await list('routines', query)).slice(0, RESULT_LIMIT).map(row => selectFields(row, ['id', 'title', 'status', 'assigneeAgentId', 'projectId'])) };
        }
        case 'routine_runs': {
          const routine = await named('routines', input.reference);
          const runs = await request(endpoint('routines', routine.id, '/runs?limit=10'));
          if (!Array.isArray(runs)) throw new Error('unexpected_paperclip_response');
          return { status: 'ok', items: runs.map(row => selectFields(row, ['id', 'status', 'createdAt', 'startedAt', 'finishedAt', 'issueId'])) };
        }
        default: throw new Error('unsupported_resource');
      }
    } catch (error) { return { status: 'read_failed', reason: workspaceErrorCode(error) }; }
  }

  async function prepare(raw) {
    const input = inputObject(raw);
    const action = input.action;
    const name = (CHANGE_NAMES[language] ?? CHANGE_NAMES.de)[CHANGE_ACTIONS.indexOf(action)];
    if (!name) throw new Error('unsupported_change');
    const change = await prepareAction(action, input);
    const question = CHANGE_QUESTIONS[language] ?? CHANGE_QUESTIONS.de;
    return { prompt: `${name}. ${change.subject}. ${question}`, execute: change.execute };
  }

  async function prepareAction(action, input) {
    if (['update_task', 'comment', 'mark_read', 'mark_unread'].includes(action)) {
      const task = await issue(input.reference);
      const subject = task.identifier;
      if (action === 'comment') {
        const message = required(input.message, 3500);
        return { subject, execute: requestId => postNativeComment(task.id, message, requestId, doFetch) };
      }
      if (action !== 'update_task') {
        return { subject, execute: () => write(endpoint('issues', task.id, '/read'), {}, action === 'mark_read' ? 'POST' : 'DELETE') };
      }
      const body = {};
      const details = [];
      for (const field of ['title', 'description']) {
        if (input[field] !== undefined) body[field] = required(input[field], field === 'title' ? 240 : 5000);
      }
      if (input.status !== undefined) details.push(body.status = approvedField(input.status, TASK_STATUS));
      if (input.priority !== undefined) details.push(body.priority = approvedField(input.priority, PRIORITY));
      if (input.agent !== undefined) {
        const agent = await named('agents', input.agent);
        body.assigneeAgentId = agent.id;
        details.push(text(agent.name, 70));
      }
      if (input.project !== undefined) {
        const project = await named('projects', input.project);
        body.projectId = project.id;
        details.push(text(project.name, 70));
      }
      if (body.title) details.push(text(body.title, 80));
      if (!Object.keys(body).length) throw new Error('missing_change');
      return { subject: [subject, ...details].join(', '), execute: () => write(endpoint('issues', task.id), body, 'PATCH') };
    }

    if (action.endsWith('_project') || action.endsWith('_goal')) {
      const project = action.endsWith('_project');
      const resource = project ? 'projects' : 'goals';
      const titleKey = project ? 'name' : 'title';
      const create = action.startsWith('create_');
      const entry = create ? null : await named(resource, input.reference);
      const body = {};
      if (create || input.title !== undefined) body[titleKey] = required(input.title, 200);
      if (input.description !== undefined) body.description = required(input.description, 5000);
      if (input.status !== undefined) body.status = approvedField(input.status, project ? PROJECT_STATUS : GOAL_STATUS);
      if (!Object.keys(body).length) throw new Error('missing_change');
      const subject = [text(entry?.[titleKey] ?? body[titleKey], 90), entry && body[titleKey] ? text(body[titleKey], 90) : '', body.status].filter(Boolean).join(', ');
      return { subject, execute: () => create ? write(`${company}/${resource}`, body) : write(endpoint(resource, entry.id), body, 'PATCH') };
    }

    if (['pause_agent', 'resume_agent', 'run_agent', 'message_agent'].includes(action)) {
      const agent = await named('agents', input.reference);
      const subject = text(agent.name, 90);
      if (action === 'message_agent') {
        const message = required(input.message, 3500);
        return { subject, execute: async requestId => {
          const chat = await write(`${company}/chats/${encodeURIComponent(agent.id)}`, {});
          if (!chat?.id || chat.companyId !== companyId) throw new Error('unexpected_paperclip_response');
          return postNativeComment(chat.id, message, requestId, doFetch);
        } };
      }
      const command = {pause_agent: 'pause', resume_agent: 'resume', run_agent: 'heartbeat/invoke'}[action];
      return { subject, execute: () => write(endpoint('agents', agent.id, `/${command}?companyId=${encodeURIComponent(companyId)}`), {}) };
    }

    if (action === 'cancel_run') {
      const id = required(input.reference, 60);
      if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('use_run_identifier');
      const run = await request(endpoint('heartbeat-runs', id));
      if (run?.companyId !== companyId || run.id !== id) throw new Error('not_found');
      const agent = await named('agents', run.agentId);
      return { subject: `${text(agent.name, 80)} (${id.slice(0, 8)})`, execute: () => write(endpoint('heartbeat-runs', id, '/cancel'), {}) };
    }

    if (action === 'approve_work' || action === 'reject_work') {
      const approval = await named('approvals', input.reference);
      if (approval.status !== 'pending' || !['approve_ceo_strategy', 'request_board_approval'].includes(approval.type)) {
        throw new Error('approval_requires_paperclip_review');
      }
      const agent = approval.requestedByAgentId ? await named('agents', approval.requestedByAgentId) : null;
      const subject = [text(agent?.name, 90), approval.id.slice(0, 8)].filter(Boolean).join(', ');
      const decisionNote = input.message === undefined ? undefined : required(input.message, 1500);
      const decision = action === 'approve_work' ? '/approve' : '/reject';
      return { subject, execute: () => write(endpoint('approvals', approval.id, decision), { decisionNote }) };
    }

    const routine = await named('routines', input.reference);
    if (action === 'run_routine') return { subject: text(routine.title, 100), execute: () => write(endpoint('routines', routine.id, '/run'), {}) };
    const status = approvedField(input.status, ROUTINE_STATUS);
    return { subject: `${text(routine.title, 90)}, ${status}`, execute: () => write(endpoint('routines', routine.id), { status }, 'PATCH') };
  }

  async function destination(raw) {
    const input = inputObject(raw);
    if (Object.hasOwn(WORK_PAGES, input.destination)) return WORK_PAGES[input.destination];
    if (input.destination === 'task') {
      const task = await issue(input.reference);
      return endpoint('issues', task.identifier ?? task.id);
    }
    if (!Object.hasOwn(WORK_DETAILS, input.destination)) throw new Error('unsupported_view');
    const resource = WORK_DETAILS[input.destination];
    const item = await named(resource, input.reference);
    return endpoint(resource, item.id);
  }

  return { read, prepare, destination, resolveAssignee: reference => named('agents', reference) };
}
