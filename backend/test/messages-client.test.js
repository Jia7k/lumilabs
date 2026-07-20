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
    state.selectedUser = PROTOTYPE_USERS.beta;
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

test('successful POST clears the draft and reloads the committed thread', async () => {
  const client = clientHarness();
  const saved = {
    id: 51,
    sender_id: 3,
    receiver_id: 2,
    portfolio_id: null,
    content: 'Persist me',
    read_at: null,
    created_at: '2026-07-20T09:10:00.000Z',
  };
  client.hooks.request = async (requestPath, options) => {
    if (requestPath === '/messages') {
      assert.equal(options.method, 'POST');
      assert.deepEqual(JSON.parse(options.body), {
        receiver_id: 2,
        content: 'Persist me',
        portfolio_id: null,
      });
      return saved;
    }
    if (requestPath === '/messages/conversations/2') {
      return [{ ...saved, sender_name: 'Beta' }];
    }
    if (requestPath === '/messages/conversations') {
      return [{
        id: 51,
        sender_id: 3,
        receiver_id: 2,
        partner_id: 2,
        partner_name: 'Alpha',
        partner_role: 'investor',
        portfolio_id: null,
        portfolio_name: null,
        content: 'Persist me',
        created_at: '2026-07-20T09:10:00.000Z',
        unread_count: 0,
      }];
    }
    throw new Error(`Unexpected request: ${requestPath}`);
  };

  await client.run('sendActiveMessage({ preventDefault() {} })');

  assert.equal(client.run('els.messageInput.value'), '');
  assert.equal(client.run('state.messages.length'), 1);
  assert.equal(client.run('state.messages[0].id'), 51);
  assert.deepEqual(client.hooks.requests, [
    '/messages',
    '/messages/conversations/2',
    '/messages/conversations',
  ]);
  assert.deepEqual(client.hooks.events, [
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
    fetch = async () => ({
      ok: false,
      headers: { get: () => 'application/json' },
      json: async () => ({ errors: [{ msg: 'Message content is required' }] })
    });
  `);

  await assert.rejects(
    client.run("originalApiFetch('/messages', { method: 'POST' })"),
    /Message content is required/
  );
});
