# Messaging Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make sends in an existing Alpha/Beta conversation atomically persist a message and notification in MySQL and remain visible after refresh.

**Architecture:** Preserve the existing `POST /api/messages` contract and public prototype identity headers. Change the route to use one `mysql2/promise` connection and transaction for the message, notification, and response read-back; then make the browser distinguish POST failure from a post-commit refresh failure and reload the active thread from the database.

**Tech Stack:** Browser JavaScript, Node.js 18+, Express 4, express-validator 7, mysql2/promise 3, Node's built-in `node:test`, Apache 2.4, systemd.

## Global Constraints

- Modify only messaging-related files.
- Keep the shared public prototype identity model: Alpha is user ID `2`; Beta is user ID `3`.
- Support sends in both Alpha-to-Beta and Beta-to-Alpha directions.
- Support existing or URL-selected conversations only; do not add recipient discovery or new-conversation UI.
- Save the message and `new_message` notification atomically: both commit or both roll back.
- Keep the existing 2,000-character limit and portfolio relationship checks.
- Add no new runtime or test dependency.
- Do not expose any non-messaging API namespace.
- Leave the two approved labelled live verification messages in the shared demo database.
- Keep the existing SFTP password out of source files, commits, logs, and pull-request text.

---

## File Map

- `backend/src/routes/messages.js`: validate sends, resolve Alpha/Beta, own the MySQL transaction, and return the committed row.
- `backend/test/messages-route.test.js`: exercise POST behavior with a deterministic fake pool connection and no real database writes.
- `js/messages.js`: orchestrate POST success/failure, reload the committed thread, preserve drafts on POST failure, and surface useful API errors.
- `backend/test/messages-client.test.js`: execute the classic browser script in a Node VM and verify the send-state transitions without adding jsdom.
- `backend/test/messages-server.test.js`: retain the existing deployed GET smoke coverage; no functional edit is expected.
- `backend/messages-server.js`: retain the isolated messaging entry point; no functional edit is expected.

### Task 1: Atomic Backend Send

**Files:**
- Create: `backend/test/messages-route.test.js`
- Modify: `backend/src/routes/messages.js:178-251`

**Interfaces:**
- Consumes: the existing prototype headers and JSON body `{ receiver_id: number, content: string, portfolio_id: number | null }`.
- Produces: `POST /api/messages` returning HTTP `201` with the committed message row; on a write failure it returns HTTP `500` after rollback.
- Database contract: `db.getConnection() -> Promise<PoolConnection>`; the connection supplies `beginTransaction()`, `query(sql, params)`, `commit()`, `rollback()`, and `release()`.

- [ ] **Step 1: Write the failing route tests**

Create `backend/test/messages-route.test.js` with a fake connection that records transaction operations. The test must use the real Express route while temporarily shadowing the exported pool's `query` and `getConnection` methods:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/config/db');
const { createMessagingApp } = require('../messages-server');

async function listen(app) {
  const server = await new Promise((resolve, reject) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    listener.once('error', reject);
  });
  return {
    origin: 'http://127.0.0.1:' + server.address().port,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    }),
  };
}

function prototypeHeaders(key) {
  const users = {
    alpha: { name: 'Alpha', role: 'investor' },
    beta: { name: 'Beta', role: 'business_owner' },
  };
  return {
    'Content-Type': 'application/json',
    'X-LumiLabs-Prototype-User': key,
    'X-LumiLabs-Prototype-Name': users[key].name,
    'X-LumiLabs-Prototype-Role': users[key].role,
  };
}

function fakeConnection({ saved, receiver, portfolio = null, failNotification = false }) {
  const calls = { begin: 0, queries: [], commit: 0, rollback: 0, release: 0 };
  return {
    calls,
    async beginTransaction() { calls.begin += 1; },
    async query(sql, params) {
      calls.queries.push({ sql, params });
      if (sql.includes('SELECT id, name FROM users')) return [[receiver], []];
      if (sql.includes('SELECT id, name, owner_id FROM portfolios')) return [[portfolio], []];
      if (sql.includes('INSERT INTO messages')) return [{ insertId: saved.id }, []];
      if (sql.includes('INSERT INTO notifications')) {
        if (failNotification) throw new Error('notification insert failed');
        return [{ insertId: 90 }, []];
      }
      if (sql.includes('SELECT * FROM messages WHERE id')) return [[saved], []];
      throw new Error('Unexpected transaction query: ' + sql);
    },
    async commit() { calls.commit += 1; },
    async rollback() { calls.rollback += 1; },
    release() { calls.release += 1; },
  };
}

function stubPool(t, { sender, connection }) {
  let getConnectionCalls = 0;
  db.query = async (sql, params) => {
    assert.match(sql, /SELECT id, email, name, role FROM users WHERE id/);
    assert.deepEqual(params, [sender.id]);
    return [[sender], []];
  };
  db.getConnection = async () => {
    getConnectionCalls += 1;
    return connection;
  };
  t.after(() => {
    delete db.query;
    delete db.getConnection;
  });
  return () => getConnectionCalls;
}

async function postMessage(t, key, body) {
  const server = await listen(createMessagingApp());
  t.after(server.close);
  const response = await fetch(server.origin + '/api/messages', {
    method: 'POST',
    headers: prototypeHeaders(key),
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  return { response, payload };
}

test('Beta send commits one message and notification', { concurrency: false }, async (t) => {
  const saved = {
    id: 41,
    sender_id: 3,
    receiver_id: 2,
    portfolio_id: 1,
    content: 'Beta persistence test',
    read_at: null,
    created_at: '2026-07-20T09:00:00.000Z',
  };
  const connection = fakeConnection({
    saved,
    receiver: { id: 2, name: 'Alpha' },
    portfolio: { id: 1, name: 'X3', owner_id: 3 },
  });
  const getConnectionCalls = stubPool(t, {
    sender: { id: 3, email: 'beta@example.com', name: 'Beta', role: 'business_owner' },
    connection,
  });

  const { response, payload } = await postMessage(t, 'beta', {
    receiver_id: 2,
    content: '  Beta persistence test  ',
    portfolio_id: 1,
  });

  assert.equal(response.status, 201);
  assert.deepEqual(payload, saved);
  assert.equal(getConnectionCalls(), 1);
  assert.equal(connection.calls.begin, 1);
  assert.equal(connection.calls.commit, 1);
  assert.equal(connection.calls.rollback, 0);
  assert.equal(connection.calls.release, 1);

  const messageInsert = connection.calls.queries.find(({ sql }) => sql.includes('INSERT INTO messages'));
  assert.deepEqual(messageInsert.params, [3, 2, 1, 'Beta persistence test']);
  const notificationInsert = connection.calls.queries.find(({ sql }) => sql.includes('INSERT INTO notifications'));
  assert.deepEqual(notificationInsert.params, [2, 'Beta sent you a message about "X3"', 1, 3]);
});

test('Alpha send uses Alpha as sender and Beta as receiver', { concurrency: false }, async (t) => {
  const saved = {
    id: 42,
    sender_id: 2,
    receiver_id: 3,
    portfolio_id: null,
    content: 'Alpha persistence test',
    read_at: null,
    created_at: '2026-07-20T09:01:00.000Z',
  };
  const connection = fakeConnection({
    saved,
    receiver: { id: 3, name: 'Beta' },
  });
  stubPool(t, {
    sender: { id: 2, email: 'alpha@example.com', name: 'Alpha', role: 'investor' },
    connection,
  });

  const { response } = await postMessage(t, 'alpha', {
    receiver_id: 3,
    content: 'Alpha persistence test',
    portfolio_id: null,
  });

  assert.equal(response.status, 201);
  const messageInsert = connection.calls.queries.find(({ sql }) => sql.includes('INSERT INTO messages'));
  assert.deepEqual(messageInsert.params, [2, 3, null, 'Alpha persistence test']);
});

test('notification failure rolls back the message transaction', { concurrency: false }, async (t) => {
  const connection = fakeConnection({
    saved: { id: 43 },
    receiver: { id: 2, name: 'Alpha' },
    failNotification: true,
  });
  stubPool(t, {
    sender: { id: 3, email: 'beta@example.com', name: 'Beta', role: 'business_owner' },
    connection,
  });

  const { response, payload } = await postMessage(t, 'beta', {
    receiver_id: 2,
    content: 'Rollback test',
    portfolio_id: null,
  });

  assert.equal(response.status, 500);
  assert.equal(payload.error, 'Server error');
  assert.equal(connection.calls.commit, 0);
  assert.equal(connection.calls.rollback, 1);
  assert.equal(connection.calls.release, 1);
});

test('invalid content does not acquire a transaction connection', { concurrency: false }, async (t) => {
  const connection = fakeConnection({
    saved: { id: 44 },
    receiver: { id: 2, name: 'Alpha' },
  });
  const getConnectionCalls = stubPool(t, {
    sender: { id: 3, email: 'beta@example.com', name: 'Beta', role: 'business_owner' },
    connection,
  });

  const { response, payload } = await postMessage(t, 'beta', {
    receiver_id: 2,
    content: '   ',
    portfolio_id: null,
  });

  assert.equal(response.status, 400);
  assert.ok(Array.isArray(payload.errors));
  assert.equal(getConnectionCalls(), 0);
});
```

- [ ] **Step 2: Run the route test and verify the red state**

Run:

```bash
node --test backend/test/messages-route.test.js
```

Expected: FAIL because the current handler uses independent `db.query()` calls; the fake transaction reports no `beginTransaction()`, `commit()`, or `rollback()`.

- [ ] **Step 3: Implement the transactional POST handler**

In `backend/src/routes/messages.js`, keep the existing middleware and validators, but replace the POST handler's database block with this transaction shape:

```js
    let connection;
    let transactionOpen = false;

    try {
      connection = await db.getConnection();
      await connection.beginTransaction();
      transactionOpen = true;

      const [receiver] = await connection.query(
        'SELECT id, name FROM users WHERE id = ?',
        [receiver_id]
      );
      if (receiver.length === 0) {
        await connection.rollback();
        transactionOpen = false;
        return res.status(404).json({ error: 'Receiver not found' });
      }

      let portfolioName = null;
      if (portfolio_id) {
        const [portfolioRows] = await connection.query(
          'SELECT id, name, owner_id FROM portfolios WHERE id = ?',
          [portfolio_id]
        );
        if (portfolioRows.length === 0) {
          await connection.rollback();
          transactionOpen = false;
          return res.status(404).json({ error: 'Portfolio not found' });
        }

        const portfolio = portfolioRows[0];
        const canDiscussPortfolio =
          Number(portfolio.owner_id) === senderId || Number(portfolio.owner_id) === receiver_id;
        if (!canDiscussPortfolio) {
          await connection.rollback();
          transactionOpen = false;
          return res.status(403).json({
            error: 'Portfolio is not related to this conversation',
          });
        }
        portfolioName = portfolio.name;
      }

      const [result] = await connection.query(
        'INSERT INTO messages (sender_id, receiver_id, portfolio_id, content) VALUES (?, ?, ?, ?)',
        [senderId, receiver_id, portfolio_id, content]
      );

      await connection.query(
        `INSERT INTO notifications (user_id, type, title, body, related_portfolio_id, related_user_id)
         VALUES (?, 'new_message', 'New Message', ?, ?, ?)`,
        [
          receiver_id,
          portfolioName
            ? req.user.name + ' sent you a message about "' + portfolioName + '"'
            : req.user.name + ' sent you a message',
          portfolio_id,
          senderId,
        ]
      );

      const [messages] = await connection.query(
        'SELECT * FROM messages WHERE id = ?',
        [result.insertId]
      );
      if (messages.length !== 1) {
        throw new Error('Inserted message could not be read back');
      }

      await connection.commit();
      transactionOpen = false;
      return res.status(201).json(messages[0]);
    } catch (err) {
      if (connection && transactionOpen) {
        try {
          await connection.rollback();
        } catch (rollbackError) {
          console.error('Message transaction rollback failed', rollbackError);
        }
      }
      console.error(err);
      return res.status(500).json({ error: 'Server error' });
    } finally {
      if (connection) {
        try {
          connection.release();
        } catch (releaseError) {
          console.error('Message connection release failed', releaseError);
        }
      }
    }
```

Do not change the GET handlers, prototype identity mapping, request schema, or non-messaging routes.

- [ ] **Step 4: Run backend messaging tests and verify green**

Run:

```bash
node --test backend/test/messages-route.test.js backend/test/messages-server.test.js backend/test/messages-deployment-files.test.js
node --check backend/src/routes/messages.js
```

Expected: all non-gated tests PASS, the existing live smoke test is SKIP without `MESSAGES_SMOKE_ORIGIN`, and the syntax check exits `0`.

- [ ] **Step 5: Commit the backend transaction**

```bash
git add -- backend/src/routes/messages.js backend/test/messages-route.test.js
git diff --cached --check
git commit -m "fix: persist messages atomically"
```

Expected: the commit contains exactly the route and its messaging test.

### Task 2: Browser Send and Database Reload

**Files:**
- Create: `backend/test/messages-client.test.js`
- Modify: `js/messages.js:447-537`

**Interfaces:**
- Consumes: a selected `state.active` conversation and the committed message returned by `POST /api/messages`.
- Produces: `reloadActiveConversationFromDatabase(partnerId): Promise<void>`, which replaces thread and conversation state with GET results.
- Failure rule: POST rejection preserves the draft; GET rejection after HTTP `201` reports `Message saved, but conversation could not be refreshed` and does not restore the draft.

- [ ] **Step 1: Write failing browser-flow tests**

Create `backend/test/messages-client.test.js`. Load `js/messages.js` into a VM with only the DOM hook it needs at evaluation time, then replace rendering and network functions with deterministic hooks:

```js
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
    toasts: [],
    post: async () => {
      throw new Error('post hook was not configured');
    },
    reload: async () => {},
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
    apiFetch = async (path, options) => testHooks.post(path, options);
    reloadActiveConversationFromDatabase =
      async (partnerId) => testHooks.reload(partnerId);
    renderThread = () => testHooks.events.push('render');
    showToast = (message) => testHooks.toasts.push(message);
  `, context);

  return {
    hooks,
    run: (code) => vm.runInContext(code, context),
  };
}

test('successful POST clears the draft and reloads the committed thread', async () => {
  const client = clientHarness();
  client.hooks.post = async (path, options) => {
    client.hooks.events.push('post');
    assert.equal(path, '/messages');
    assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(options.body), {
      receiver_id: 2,
      content: 'Persist me',
      portfolio_id: null,
    });
    return {
      id: 51,
      sender_id: 3,
      receiver_id: 2,
      portfolio_id: null,
      content: 'Persist me',
      read_at: null,
      created_at: '2026-07-20T09:10:00.000Z',
    };
  };
  client.hooks.reload = async (partnerId) => {
    client.hooks.events.push('reload:' + partnerId);
  };

  await client.run('sendActiveMessage({ preventDefault() {} })');

  assert.equal(client.run('els.messageInput.value'), '');
  assert.deepEqual(client.hooks.events, ['post', 'render', 'reload:2']);
  assert.ok(client.hooks.toasts.includes('Message sent'));
});

test('POST failure preserves the draft and does not reload', async () => {
  const client = clientHarness();
  client.hooks.post = async () => {
    throw new Error('Receiver not found');
  };
  client.hooks.reload = async () => {
    throw new Error('reload must not run');
  };

  await client.run('sendActiveMessage({ preventDefault() {} })');

  assert.equal(client.run('els.messageInput.value'), 'Persist me');
  assert.deepEqual(client.hooks.events, []);
  assert.deepEqual(client.hooks.toasts, ['Receiver not found']);
});

test('reload failure after commit does not restore the draft', async () => {
  const client = clientHarness();
  client.hooks.post = async () => ({
    id: 52,
    sender_id: 3,
    receiver_id: 2,
    portfolio_id: null,
    content: 'Persist me',
    read_at: null,
    created_at: '2026-07-20T09:11:00.000Z',
  });
  client.hooks.reload = async () => {
    throw new Error('GET failed');
  };

  await client.run('sendActiveMessage({ preventDefault() {} })');

  assert.equal(client.run('els.messageInput.value'), '');
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
```

- [ ] **Step 2: Run the browser test and verify the red state**

Run:

```bash
node --test backend/test/messages-client.test.js
```

Expected: FAIL because `sendActiveMessage` currently uses a locally appended row plus `loadConversations()`, does not call `reloadActiveConversationFromDatabase()`, and `apiFetch` ignores `errors[0].msg`.

- [ ] **Step 3: Implement committed-send and refresh separation**

In `js/messages.js`, add this database reload helper near `sendActiveMessage`:

```js
async function reloadActiveConversationFromDatabase(partnerId) {
  const messageRows = await apiFetch(
    '/messages/conversations/' + encodeURIComponent(partnerId)
  );
  const conversationRows = await apiFetch('/messages/conversations');

  state.messages = messageRows.map(normalizeMessage);
  state.conversations = conversationRows.map(normalizeConversation);
  state.active = state.conversations.find(
    (conversation) => sameId(conversation.partner_id, partnerId)
  ) || state.active;
  if (state.active) state.active.unread_count = 0;

  renderThread();
  renderConversations();
  renderActiveHeader();
}
```

Replace `sendActiveMessage` with a two-phase flow: the inner POST catch preserves the draft, while a later reload catch knows the row has already committed.

```js
async function sendActiveMessage(event) {
  event.preventDefault();
  if (!state.active) return;

  const content = els.messageInput.value.trim();
  if (!content) return;

  const receiverId = Number(state.active.partner_id);
  const portfolioId = state.active.portfolio_id ? Number(state.active.portfolio_id) : null;
  if (!Number.isInteger(receiverId) || receiverId <= 0) {
    showToast('Invalid receiver');
    return;
  }

  setSending(true);
  try {
    let saved;
    try {
      saved = await apiFetch('/messages', {
        method: 'POST',
        body: JSON.stringify({
          receiver_id: receiverId,
          content,
          portfolio_id: Number.isInteger(portfolioId) ? portfolioId : null,
        }),
      });
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Message could not be sent');
      return;
    }

    state.messages.push(normalizeMessage({
      ...saved,
      sender_name: state.user.name,
      portfolio_name: state.active.portfolio_name,
    }));
    els.messageInput.value = '';
    renderThread();
    showToast('Message sent');

    try {
      await reloadActiveConversationFromDatabase(receiverId);
    } catch (err) {
      console.error(err);
      showToast('Message saved, but conversation could not be refreshed');
    }
  } finally {
    setSending(false);
  }
}
```

Finally, make `apiFetch` surface validator errors:

```js
  if (!response.ok) {
    const message = payload?.error
      || payload?.errors?.[0]?.msg
      || 'API request failed';
    throw new Error(message);
  }
```

- [ ] **Step 4: Run client and backend regression tests**

Run:

```bash
node --test backend/test/messages-client.test.js backend/test/messages-route.test.js backend/test/messages-server.test.js backend/test/messages-deployment-files.test.js
node --check js/messages.js
node --check backend/test/messages-client.test.js
```

Expected: all non-gated tests PASS, the live GET smoke test remains SKIP without its environment variable, and both syntax checks exit `0`.

- [ ] **Step 5: Commit the browser persistence flow**

```bash
git add -- js/messages.js backend/test/messages-client.test.js
git diff --cached --check
git commit -m "fix: reload messages after sending"
```

Expected: the commit contains exactly the messaging client and its messaging test.

### Task 3: Regression, Live Deployment, and Git Publication

**Files:**
- Verify: all messaging files changed on this branch
- Deploy: `backend/src/routes/messages.js`, `js/messages.js`
- Do not modify: any non-messaging file

**Interfaces:**
- Public page: `http://35.212.144.149/messages.html`
- Public API: `http://35.212.144.149/api/messages`
- Deployment target: `user@35.212.144.149`
- Git branch: `agent/fix-messaging-api` targeting `main`

- [ ] **Step 1: Run the complete local messaging verification**

```bash
node --test backend/test/messages-client.test.js backend/test/messages-route.test.js backend/test/messages-server.test.js backend/test/messages-deployment-files.test.js
node --check backend/src/routes/messages.js
node --check backend/messages-server.js
node --check js/messages.js
git diff --check origin/main...HEAD
git status --short
```

Expected: every non-gated test PASS, syntax checks exit `0`, the diff check is silent, and the working tree is clean.

- [ ] **Step 2: Audit branch scope before deployment**

```bash
git diff --name-only origin/main...HEAD
```

Expected: only the approved messaging runtime files, messaging tests, messaging deployment files, and the messaging design/plan documents appear. Stop if any unrelated path appears.

- [ ] **Step 3: Upload only the two changed runtime files**

Open SFTP without embedding the password in command history:

```bash
sftp user@35.212.144.149
```

At the `sftp>` prompt, run:

```text
put backend/src/routes/messages.js /var/www/html/backend/src/routes/messages.js
put js/messages.js /var/www/html/js/messages.js
bye
```

Expected: both uploads report success; no other remote file is replaced.

- [ ] **Step 4: Restart only the isolated messaging service and check health**

```bash
ssh user@35.212.144.149 'sudo systemctl restart lumilabs-messaging && sudo systemctl is-active lumilabs-messaging'
curl --fail --silent --show-error http://35.212.144.149/api/messages/health
```

Expected: systemd prints `active`; health returns `{"status":"ok"}`.

- [ ] **Step 5: Send the approved Beta-to-Alpha verification message**

Use a unique UTC label and keep the response in shell memory rather than a file:

```bash
LUMI_VERIFY_STAMP=$(date -u +%Y%m%dT%H%M%SZ)
LUMI_BETA_RESPONSE=$(curl --fail --silent --show-error \
  -X POST http://35.212.144.149/api/messages \
  -H 'Content-Type: application/json' \
  -H 'X-LumiLabs-Prototype-User: beta' \
  -H 'X-LumiLabs-Prototype-Name: Beta' \
  -H 'X-LumiLabs-Prototype-Role: business_owner' \
  --data '{"receiver_id":2,"content":"[Codex verification '"$LUMI_VERIFY_STAMP"'] Beta to Alpha","portfolio_id":null}')
LUMI_BETA_ID=$(printf '%s' "$LUMI_BETA_RESPONSE" | jq -r '.id')
printf '%s\n' "$LUMI_BETA_RESPONSE"
```

Expected: HTTP success JSON contains a positive `id`, `sender_id: 3`, `receiver_id: 2`, and the labelled content.

- [ ] **Step 6: Send the approved Alpha-to-Beta verification message**

```bash
LUMI_ALPHA_RESPONSE=$(curl --fail --silent --show-error \
  -X POST http://35.212.144.149/api/messages \
  -H 'Content-Type: application/json' \
  -H 'X-LumiLabs-Prototype-User: alpha' \
  -H 'X-LumiLabs-Prototype-Name: Alpha' \
  -H 'X-LumiLabs-Prototype-Role: investor' \
  --data '{"receiver_id":3,"content":"[Codex verification '"$LUMI_VERIFY_STAMP"'] Alpha to Beta","portfolio_id":null}')
LUMI_ALPHA_ID=$(printf '%s' "$LUMI_ALPHA_RESPONSE" | jq -r '.id')
printf '%s\n' "$LUMI_ALPHA_RESPONSE"
```

Expected: HTTP success JSON contains a positive `id`, `sender_id: 2`, `receiver_id: 3`, and the labelled content.

- [ ] **Step 7: Reload the thread from both identities and prove persistence**

```bash
curl --fail --silent --show-error \
  -H 'X-LumiLabs-Prototype-User: beta' \
  -H 'X-LumiLabs-Prototype-Name: Beta' \
  -H 'X-LumiLabs-Prototype-Role: business_owner' \
  http://35.212.144.149/api/messages/conversations/2 \
  | jq --argjson beta_id "$LUMI_BETA_ID" --argjson alpha_id "$LUMI_ALPHA_ID" \
    'map(select(.id == $beta_id or .id == $alpha_id)) | length == 2'

curl --fail --silent --show-error \
  -H 'X-LumiLabs-Prototype-User: alpha' \
  -H 'X-LumiLabs-Prototype-Name: Alpha' \
  -H 'X-LumiLabs-Prototype-Role: investor' \
  http://35.212.144.149/api/messages/conversations/3 \
  | jq --argjson beta_id "$LUMI_BETA_ID" --argjson alpha_id "$LUMI_ALPHA_ID" \
    'map(select(.id == $beta_id or .id == $alpha_id)) | length == 2'
```

Expected: both commands print `true`.

- [ ] **Step 8: Confirm the two notification rows on the server**

Run a read-only grouped query using the deployed backend's environment without printing credentials:

```bash
ssh user@35.212.144.149 "cd /var/www/html/backend && /opt/lumilabs-messaging/current/bin/node -e \
'require(\"dotenv\").config(); const db=require(\"./src/config/db\"); \
db.query(\"SELECT user_id,related_user_id,MAX(id) AS latest_id FROM notifications WHERE type = ? AND created_at >= NOW() - INTERVAL 10 MINUTE AND ((user_id = 2 AND related_user_id = 3) OR (user_id = 3 AND related_user_id = 2)) GROUP BY user_id,related_user_id ORDER BY user_id\", [\"new_message\"]) \
.then(([rows]) => { console.log(JSON.stringify(rows)); return db.end(); }) \
.catch((error) => { console.error(error); process.exitCode=1; });'"
```

Expected: exactly two recent `new_message` identity groups, one with `user_id: 2, related_user_id: 3` and one with `user_id: 3, related_user_id: 2`.

- [ ] **Step 9: Verify the browser refresh behavior**

Open `http://35.212.144.149/messages.html`, select Beta, open Alpha, and confirm both labelled rows are visible. Refresh the page and confirm they remain. Switch to Alpha, open Beta, refresh again, and confirm the same two database-backed rows remain.

Expected: both messages remain visible after each full page refresh, and sending controls are enabled only for the selected existing thread.

- [ ] **Step 10: Push Git and open the draft pull request**

```bash
git status -sb
git push origin agent/fix-messaging-api
gh pr list --head agent/fix-messaging-api --state all --json number,url,state,isDraft
```

If no pull request exists, create a draft PR targeting `main` with title `Fix messaging persistence`. Its body must explain the original missing messaging deployment path, the atomic POST transaction, the browser reload behavior, exact test commands, live verification, and the messaging-only file scope.

Expected: the remote branch points to local `HEAD`, the draft PR targets `main`, and no unrelated local commits are included.

- [ ] **Step 11: Perform final remote-state verification**

```bash
git status -sb
git rev-parse HEAD
git ls-remote --heads origin agent/fix-messaging-api
gh pr view --json number,url,state,isDraft,baseRefName,headRefName,title
```

Expected: the worktree is clean, local and remote branch hashes match, and the PR is open as a draft from `agent/fix-messaging-api` to `main`.
