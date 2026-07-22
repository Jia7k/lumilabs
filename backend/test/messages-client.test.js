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

function fakeElement() {
  const listeners = new Map();
  return {
    innerHTML: '',
    textContent: '',
    value: '',
    disabled: false,
    hidden: false,
    className: '',
    scrollTop: 0,
    scrollHeight: 100,
    style: {},
    listeners,
    classList: {
      add() {},
      remove() {},
      toggle() { return false; },
    },
    setAttribute() {},
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
  };
}

function clientHarness() {
  const hooks = {
    requests: [],
    toasts: [],
    request: async () => { throw new Error('request hook missing'); },
  };
  const ids = [
    'business-nav', 'investor-nav', 'relationship-manager-nav', 'nav-msg-badge',
    'role-menu', 'role-menu-button', 'user-avatar', 'user-name', 'user-role',
    'mode-label', 'refresh-btn', 'unread-count', 'conversation-search',
    'conversation-list', 'thread-avatar', 'thread-title', 'thread-subtitle',
    'thread-participants', 'thread-status', 'message-list', 'archive-notice',
    'message-form', 'message-input', 'send-btn', 'toast',
  ];
  const elements = new Map(ids.map((id) => [id, fakeElement()]));
  const documentListeners = new Map();
  const body = fakeElement();
  const storage = new Map([['lumilabsToken', 'signed-test-token']]);
  const context = vm.createContext({
    window: { LUMILABS_API_BASE: undefined, location: { search: '', href: '' } },
    document: {
      body,
      getElementById(id) { return elements.get(id) || null; },
      addEventListener(type, handler) {
        if (!documentListeners.has(type)) documentListeners.set(type, []);
        documentListeners.get(type).push(handler);
      },
    },
    localStorage: {
      getItem(key) { return storage.get(key) || null; },
      removeItem(key) { storage.delete(key); },
    },
    apiFetch: async () => { throw new Error('request hook missing'); },
    signOut() {},
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
    state.user = { id: '8', name: 'Rachel Manager', role: 'relationship_manager' };
    state.conversations = [normalizeConversation(${JSON.stringify(summary)})];
    state.activeConversationId = '12';
    state.activeThread = normalizeThread(${JSON.stringify(thread())});
    cacheElements();
    els.messageInput.value = 'Hello group';
    apiFetch = async (path, options) => {
      testHooks.requests.push({ path, options });
      return testHooks.request(path, options);
    };
    showToast = (message) => testHooks.toasts.push(message);
  `, context);
  return {
    hooks,
    context,
    elements,
    storage,
    listenerCount() {
      let count = [...documentListeners.values()].reduce((sum, handlers) => sum + handlers.length, 0);
      for (const element of elements.values()) {
        count += [...element.listeners.values()].reduce((sum, handlers) => sum + handlers.length, 0);
      }
      return count;
    },
    run: (code) => vm.runInContext(code, context),
  };
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

test('an unavailable explicit starter ID never selects the first room', async () => {
  const client = clientHarness();
  client.run(`
    window.location.search = '?conversationId=999';
    state.activeConversationId = null;
    state.activeThread = null;
    renderConversations();
  `);

  await client.run('selectInitialConversation()');

  assert.equal(client.run('state.activeConversationId'), null);
  assert.equal(client.run('state.activeThread'), null);
  assert.equal(client.run('els.messageInput.disabled'), true);
  assert.equal(client.run('els.sendBtn.disabled'), true);
  assert.match(client.run('els.messageList.innerHTML'), /Conversation unavailable/);
  assert.match(client.run('els.conversationList.innerHTML'), /X3/);
  assert.equal(client.hooks.requests.length, 0);
});

for (const search of ['', '?conversationId=abc', '?conversationId=0', '?conversationId=-2']) {
  test(`starter ${search || 'without an ID'} selects the first room`, async () => {
    const client = clientHarness();
    client.run(`
      window.location.search = ${JSON.stringify(search)};
      state.activeConversationId = null;
      state.activeThread = null;
    `);
    client.hooks.request = async (requestPath) => {
      if (requestPath === '/messages/conversations/12') return thread([]);
      if (requestPath === '/messages/conversations') return [summary];
      throw new Error(`Unexpected request: ${requestPath}`);
    };

    await client.run('selectInitialConversation()');

    assert.equal(client.run('state.activeConversationId'), '12');
  });
}

test('refresh removal clears the active thread and invalidates stale work', async () => {
  const client = clientHarness();
  const previousVersion = client.run('state.selectionVersion');
  client.hooks.request = async (requestPath) => {
    if (requestPath === '/messages/conversations') return [];
    throw new Error(`Unexpected request: ${requestPath}`);
  };

  await client.run('refreshMessages()');

  assert.equal(client.run('state.activeConversationId'), null);
  assert.equal(client.run('state.activeThread'), null);
  assert.ok(client.run('state.selectionVersion') > previousVersion);
  assert.equal(client.run('els.messageInput.disabled'), true);
  assert.equal(client.run('els.archiveNotice.hidden'), true);
  assert.equal(client.run('els.threadParticipants.innerHTML'), '');
  assert.match(client.run('els.messageList.innerHTML'), /Conversation unavailable/);
});

test('a pending thread response cannot restore a room removed by refresh', async () => {
  const client = clientHarness();
  let resolveThread;
  const pendingThread = new Promise((resolve) => { resolveThread = resolve; });
  let listCalls = 0;
  client.hooks.request = async (requestPath) => {
    if (requestPath === '/messages/conversations/12') return pendingThread;
    if (requestPath === '/messages/conversations') {
      listCalls += 1;
      return [];
    }
    throw new Error(`Unexpected request: ${requestPath}`);
  };

  const selection = client.run("selectConversation('12')");
  await client.run('refreshMessages()');
  resolveThread(thread([{ id: 99, content: 'stale message' }]));
  await selection;

  assert.equal(listCalls, 1);
  assert.equal(client.run('state.activeConversationId'), null);
  assert.equal(client.run('state.activeThread'), null);
  assert.doesNotMatch(client.run('els.messageList.innerHTML'), /stale message/);
});

test('temporary identity failure preserves the page and renders data-only Retry', async () => {
  const client = clientHarness();
  client.run(`
    state.user = null;
    window.location.href = 'messages.html';
  `);
  client.hooks.request = async (requestPath) => {
    assert.equal(requestPath, '/messages/me');
    throw Object.assign(new Error('service unavailable'), {
      status: 500,
      isNetworkError: false,
    });
  };

  assert.equal(await client.run('loadMessagesWorkspace()'), false);
  assert.equal(client.run('window.location.href'), 'messages.html');
  assert.equal(client.storage.get('lumilabsToken'), 'signed-test-token');
  assert.match(client.run('els.conversationList.innerHTML'), /Messages unavailable/);
  assert.match(client.run('els.conversationList.innerHTML'), /data-retry-messages/);
  assert.equal(client.run('els.messageInput.disabled'), true);
});

test('workspace retry is data-only and never binds handlers twice', async () => {
  const client = clientHarness();
  let identityCalls = 0;
  client.run('state.user = null');
  client.hooks.request = async (requestPath) => {
    if (requestPath === '/messages/me') {
      identityCalls += 1;
      if (identityCalls === 1) {
        throw Object.assign(new Error('temporary'), { status: 500 });
      }
      return { id: 8, name: 'Rachel Manager', role: 'relationship_manager' };
    }
    if (requestPath === '/messages/conversations') return [];
    throw new Error(`Unexpected request: ${requestPath}`);
  };

  await client.run('initMessages()');
  const listenersAfterInit = client.listenerCount();
  await client.run('loadMessagesWorkspace()');

  assert.equal(identityCalls, 2);
  assert.equal(client.listenerCount(), listenersAfterInit);
});
