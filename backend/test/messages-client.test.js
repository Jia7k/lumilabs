const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '..', '..', 'js', 'messages.js'),
  'utf8'
);

function clientHarness() {
  const hooks = {
    events: [],
    requests: [],
    toasts: [],
    request: async () => {
      throw new Error('request hook was not configured');
    },
  };

  const context = vm.createContext({
    window: { LUMILABS_API_BASE: undefined },
    document: { addEventListener() {} },
    console: { error() {}, log() {} },
    setTimeout,
    clearTimeout,
    URLSearchParams,
    Intl,
    Date,
    testHooks: hooks,
  });

  vm.runInContext(source, context);
  vm.runInContext(`
    state.token = 'signed-test-token';
    state.user = { id: 3, name: 'Beta', role: 'business_owner' };
    state.active = {
      partner_id: '2',
      partner_name: 'Alpha',
      partner_role: 'investor',
      partner_role_label: 'Investor',
      portfolio_id: '',
      portfolio_name: ''
    };
    state.messages = [];
    Object.assign(els, {
      messageInput: { value: 'Persist me', disabled: false },
      sendBtn: { disabled: false, innerHTML: '' }
    });
    globalThis.originalApiFetch = apiFetch;
    apiFetch = async (path, options) => {
      testHooks.requests.push(path);
      return testHooks.request(path, options);
    };
    renderThread = () => testHooks.events.push('render-thread');
    renderConversations = () => testHooks.events.push('render-conversations');
    renderActiveHeader = () => testHooks.events.push('render-header');
    showToast = (message) => testHooks.toasts.push(message);
  `, context);

  return {
    hooks,
    run: (code) => vm.runInContext(code, context),
  };
}

test('successful POSTs clear each draft and keep the composer reusable', async () => {
  const client = clientHarness();
  const savedMessages = [];
  client.hooks.request = async (requestPath, options) => {
    if (requestPath === '/messages') {
      assert.equal(options.method, 'POST');
      const body = JSON.parse(options.body);
      assert.equal(body.receiver_id, 2);
      assert.equal(body.portfolio_id, null);
      const saved = {
        id: 51 + savedMessages.length,
        sender_id: 3,
        receiver_id: 2,
        portfolio_id: null,
        content: body.content,
        read_at: null,
        created_at: '2026-07-20T09:10:00.000Z',
      };
      savedMessages.push(saved);
      return saved;
    }
    if (requestPath === '/messages/conversations/2') {
      return savedMessages.map((message) => ({
        ...message,
        sender_name: 'Beta',
      }));
    }
    if (requestPath === '/messages/conversations') {
      const latest = savedMessages[savedMessages.length - 1];
      return [{
        ...latest,
        partner_id: 2,
        partner_name: 'Alpha',
        partner_role: 'investor',
        portfolio_name: null,
        unread_count: 0,
      }];
    }
    throw new Error(`Unexpected request: ${requestPath}`);
  };

  await client.run('sendActiveMessage({ preventDefault() {} })');

  assert.equal(client.run('els.messageInput.value'), '');
  assert.equal(client.run('state.messages.length'), 1);
  assert.equal(client.run('state.messages[0].id'), 51);
  assert.equal(client.run('els.messageInput.disabled'), false);
  assert.equal(client.run('els.sendBtn.disabled'), false);

  client.run("els.messageInput.value = 'Persist again'");
  await client.run('sendActiveMessage({ preventDefault() {} })');

  assert.deepEqual(savedMessages.map(({ content }) => content), [
    'Persist me',
    'Persist again',
  ]);
  assert.equal(client.run('els.messageInput.value'), '');
  assert.equal(client.run('els.messageInput.disabled'), false);
  assert.equal(client.run('els.sendBtn.disabled'), false);
  assert.equal(client.run('state.messages.length'), 2);
  assert.deepEqual(client.hooks.requests, [
    '/messages',
    '/messages/conversations/2',
    '/messages/conversations',
    '/messages',
    '/messages/conversations/2',
    '/messages/conversations',
  ]);
  assert.deepEqual(client.hooks.events, [
    'render-thread',
    'render-thread',
    'render-conversations',
    'render-header',
    'render-thread',
    'render-thread',
    'render-conversations',
    'render-header',
  ]);
  assert.ok(client.hooks.toasts.includes('Message sent'));
});

test('POST failure preserves the draft and does not reload', async () => {
  const client = clientHarness();
  client.hooks.request = async () => {
    throw new Error('Receiver not found');
  };

  await client.run('sendActiveMessage({ preventDefault() {} })');

  assert.equal(client.run('els.messageInput.value'), 'Persist me');
  assert.deepEqual(client.hooks.requests, ['/messages']);
  assert.deepEqual(client.hooks.events, []);
  assert.deepEqual(client.hooks.toasts, ['Receiver not found']);
});

test('reload failure after commit does not restore the draft', async () => {
  const client = clientHarness();
  client.hooks.request = async (requestPath) => {
    if (requestPath === '/messages') {
      return {
        id: 52,
        sender_id: 3,
        receiver_id: 2,
        portfolio_id: null,
        content: 'Persist me',
        read_at: null,
        created_at: '2026-07-20T09:11:00.000Z',
      };
    }
    throw new Error('GET failed');
  };

  await client.run('sendActiveMessage({ preventDefault() {} })');

  assert.equal(client.run('els.messageInput.value'), '');
  assert.deepEqual(client.hooks.requests, [
    '/messages',
    '/messages/conversations/2',
  ]);
  assert.deepEqual(client.hooks.toasts, [
    'Message sent',
    'Message saved, but conversation could not be refreshed',
  ]);
});

test('apiFetch surfaces the first express-validator message', async () => {
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
    client.run("originalApiFetch('/messages', { method: 'POST' })"),
    /Message content is required/
  );

  assert.equal(
    client.run("testHooks.lastRequestOptions.headers.Authorization"),
    'Bearer signed-test-token',
  );
  assert.equal(
    client.run("Object.keys(testHooks.lastRequestOptions.headers).some((name) => name.startsWith('X-LumiLabs-Prototype'))"),
    false,
  );
});

test('message client contains no prototype identity mechanism', () => {
  assert.doesNotMatch(source, /X-LumiLabs-Prototype|PROTOTYPE_USERS|SELECTED_USER_KEY/);
});

test('initial inbox failures render the visible error state', () => {
  assert.match(
    source,
    /const conversationsLoaded = await loadConversations\(\);[\s\S]*if \(!conversationsLoaded\) \{[\s\S]*renderLoadError/,
  );
  assert.doesNotMatch(source, /Alpha\/Beta exist/);
});

test('a stale thread response cannot replace a newer selection', async () => {
  const client = clientHarness();
  let resolveFirstThread;
  const firstThread = new Promise((resolve) => {
    resolveFirstThread = resolve;
  });

  client.run(`
    state.active = null;
    state.conversations = [
      {
        partner_id: '2', partner_name: 'Alpha', partner_role: 'investor',
        partner_role_label: 'Investor', portfolio_id: '', portfolio_name: '',
        content: '', created_at: new Date().toISOString(), unread_count: 0, sender_id: ''
      },
      {
        partner_id: '4', partner_name: 'Gamma', partner_role: 'investor',
        partner_role_label: 'Investor', portfolio_id: '', portfolio_name: '',
        content: '', created_at: new Date().toISOString(), unread_count: 0, sender_id: ''
      }
    ];
  `);
  client.hooks.request = async (requestPath) => {
    if (requestPath === '/messages/conversations/2') return firstThread;
    if (requestPath === '/messages/conversations/4') {
      return [{
        id: 70,
        sender_id: 4,
        receiver_id: 3,
        sender_name: 'Gamma',
        content: 'newer thread',
        created_at: '2026-07-22T10:00:00.000Z',
      }];
    }
    if (requestPath === '/messages/conversations') {
      return [{
        id: 70,
        partner_id: 4,
        partner_name: 'Gamma',
        partner_role: 'investor',
        content: 'newer thread',
        created_at: '2026-07-22T10:00:00.000Z',
        unread_count: 0,
        sender_id: 4,
      }];
    }
    throw new Error(`Unexpected request: ${requestPath}`);
  };

  const firstSelection = client.run("selectConversation('2')");
  const secondSelection = client.run("selectConversation('4')");
  await secondSelection;
  resolveFirstThread([{
    id: 69,
    sender_id: 2,
    receiver_id: 3,
    sender_name: 'Alpha',
    content: 'stale thread',
    created_at: '2026-07-22T09:59:00.000Z',
  }]);
  await firstSelection;

  assert.equal(client.run('state.active.partner_id'), '4');
  assert.equal(client.run('state.messages[0].content'), 'newer thread');
});
