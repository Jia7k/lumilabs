const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '..', '..', 'js', 'messages.js'),
  'utf8',
);

const summary = {
  id: 12,
  portfolio_id: 1,
  title: 'X3',
  status: 'active',
  archived_reason: null,
  unread_count: 1,
  participants: [
    { id: 8, name: 'Rachel Manager', role: 'relationship_manager' },
    { id: 3, name: 'Beta', role: 'business_owner' },
    { id: 6, name: 'testing1', role: 'investor' },
  ],
  latest_message: null,
};

function thread(messages = []) {
  return {
    conversation: { ...summary, can_send: true },
    participants: summary.participants,
    messages,
  };
}

function clientHarness() {
  const hooks = {
    requests: [],
    toasts: [],
    renders: [],
    request: async () => { throw new Error('request hook missing'); },
  };
  const context = vm.createContext({
    window: { LUMILABS_API_BASE: undefined, location: { search: '', href: '' } },
    document: { addEventListener() {} },
    localStorage: { getItem() { return null; }, removeItem() {} },
    console: { error() {}, log() {} },
    setTimeout,
    clearTimeout,
    URLSearchParams,
    encodeURIComponent,
    Intl,
    Date,
    testHooks: hooks,
  });
  vm.runInContext(source, context);
  vm.runInContext(`
    state.token = 'signed-test-token';
    state.user = { id: '8', name: 'Rachel Manager', role: 'relationship_manager' };
    state.conversations = [normalizeConversation(${JSON.stringify(summary)})];
    state.activeConversationId = '12';
    state.activeThread = normalizeThread(${JSON.stringify(thread())});
    Object.assign(els, {
      messageInput: { value: 'Hello group', disabled: false },
      sendBtn: { disabled: false, innerHTML: '' },
      messageList: { innerHTML: '', scrollTop: 0, scrollHeight: 0 },
      archiveNotice: { hidden: true, textContent: '', className: '' }
    });
    globalThis.originalApiFetch = apiFetch;
    apiFetch = async (path, options) => {
      testHooks.requests.push({ path, options });
      return testHooks.request(path, options);
    };
    renderThread = () => testHooks.renders.push('thread');
    renderConversations = () => testHooks.renders.push('list');
    renderActiveHeader = () => testHooks.renders.push('header');
    showToast = (message) => testHooks.toasts.push(message);
  `, context);
  return { hooks, run: (code) => vm.runInContext(code, context) };
}

test('a sent message reloads from the selected conversation and leaves composer reusable', async () => {
  const client = clientHarness();
  const saved = {
    id: 51,
    conversation_id: 12,
    sender_id: 8,
    sender_name: 'Rachel Manager',
    sender_role: 'relationship_manager',
    content: 'Hello group',
    created_at: '2026-07-22T09:10:00.000Z',
  };
  client.hooks.request = async (requestPath, options) => {
    if (requestPath === '/messages/conversations/12/messages') {
      assert.equal(options.method, 'POST');
      assert.deepEqual(JSON.parse(options.body), { content: 'Hello group' });
      return saved;
    }
    if (requestPath === '/messages/conversations/12') return thread([saved]);
    if (requestPath === '/messages/conversations/12/read') {
      assert.equal(options.method, 'PUT');
      assert.deepEqual(JSON.parse(options.body), { message_id: 51 });
      return { conversation_id: 12, last_read_message_id: 51 };
    }
    if (requestPath === '/messages/conversations') return [{ ...summary, latest_message: saved }];
    throw new Error(`Unexpected request: ${requestPath}`);
  };

  await client.run('sendActiveMessage({ preventDefault() {} })');

  assert.equal(client.run('els.messageInput.value'), '');
  assert.equal(client.run('els.messageInput.disabled'), false);
  assert.equal(client.run('els.sendBtn.disabled'), false);
  assert.equal(client.run('state.activeThread.messages[0].content'), 'Hello group');
  assert.deepEqual(client.hooks.requests.map(({ path: requestPath }) => requestPath), [
    '/messages/conversations/12/messages',
    '/messages/conversations/12',
    '/messages/conversations/12/read',
    '/messages/conversations',
  ]);
});

test('failed send preserves the exact draft and restores active composer', async () => {
  const client = clientHarness();
  client.run("els.messageInput.value = '  Keep my draft  '");
  client.hooks.request = async () => { throw new Error('Room unavailable'); };

  await client.run('sendActiveMessage({ preventDefault() {} })');

  assert.equal(client.run('els.messageInput.value'), '  Keep my draft  ');
  assert.equal(client.run('els.messageInput.disabled'), false);
  assert.equal(client.run('els.sendBtn.disabled'), false);
  assert.deepEqual(client.hooks.requests.map(({ path: requestPath }) => requestPath), [
    '/messages/conversations/12/messages',
  ]);
  assert.deepEqual(client.hooks.toasts, ['Room unavailable']);
});

test('successful thread load marks the last visible message read and refreshes unread list', async () => {
  const client = clientHarness();
  const message = {
    id: 55,
    conversation_id: 12,
    sender_id: 3,
    sender_name: 'Beta',
    sender_role: 'business_owner',
    content: 'Update',
    created_at: '2026-07-22T09:12:00.000Z',
  };
  client.hooks.request = async (requestPath) => {
    if (requestPath === '/messages/conversations/12') return thread([message]);
    if (requestPath === '/messages/conversations/12/read') return {};
    if (requestPath === '/messages/conversations') return [{ ...summary, unread_count: 0 }];
    throw new Error(`Unexpected request: ${requestPath}`);
  };

  await client.run("selectConversation('12')");
  assert.deepEqual(client.hooks.requests.map(({ path: requestPath }) => requestPath), [
    '/messages/conversations/12',
    '/messages/conversations/12/read',
    '/messages/conversations',
  ]);
});

test('thread with no messages skips the read endpoint', async () => {
  const client = clientHarness();
  client.hooks.request = async (requestPath) => {
    if (requestPath === '/messages/conversations/12') return thread([]);
    if (requestPath === '/messages/conversations') return [summary];
    throw new Error(`Unexpected request: ${requestPath}`);
  };
  await client.run("selectConversation('12')");
  assert.equal(
    client.hooks.requests.some(({ path: requestPath }) => requestPath.endsWith('/read')),
    false,
  );
});

test('a stale thread response cannot replace a newer room selection', async () => {
  const client = clientHarness();
  let resolveFirst;
  const first = new Promise((resolve) => { resolveFirst = resolve; });
  const secondSummary = { ...summary, id: 13, title: 'Second Room', unread_count: 0 };
  client.run(`state.conversations.push(normalizeConversation(${JSON.stringify(secondSummary)}))`);
  client.hooks.request = async (requestPath) => {
    if (requestPath === '/messages/conversations/12') return first;
    if (requestPath === '/messages/conversations/13') {
      return {
        conversation: { ...secondSummary, can_send: true },
        participants: summary.participants,
        messages: []
      };
    }
    if (requestPath === '/messages/conversations') return [summary, secondSummary];
    throw new Error(`Unexpected request: ${requestPath}`);
  };

  const firstSelection = client.run("selectConversation('12')");
  const secondSelection = client.run("selectConversation('13')");
  await secondSelection;
  resolveFirst(thread([{ id: 99, content: 'stale' }]));
  await firstSelection;

  assert.equal(client.run('state.activeConversationId'), '13');
  assert.equal(client.run('state.activeThread.conversation.title'), 'Second Room');
});

test('apiFetch surfaces validator errors and sends no prototype identity header', async () => {
  const client = clientHarness();
  client.run(`
    fetch = async (_url, options) => {
      testHooks.lastRequestOptions = options;
      return {
        ok: false,
        headers: { get: () => 'application/json' },
        json: async () => ({ errors: [{ msg: 'Message content is required' }] })
      };
    };
  `);
  await assert.rejects(
    client.run("originalApiFetch('/messages/conversations/12/messages', { method: 'POST' })"),
    /Message content is required/,
  );
  assert.equal(client.run('testHooks.lastRequestOptions.headers.Authorization'), 'Bearer signed-test-token');
  assert.equal(
    client.run("Object.keys(testHooks.lastRequestOptions.headers).some((name) => name.startsWith('X-LumiLabs-Prototype'))"),
    false,
  );
});
