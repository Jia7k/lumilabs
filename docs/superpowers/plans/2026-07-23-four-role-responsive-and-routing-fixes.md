# Four-Role Responsive and Routing Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the responsive overflow, message composer, role-routing, portfolio-ID, Browse-menu, and degraded sign-out defects confirmed in the four-role walkthrough.

**Architecture:** Preserve the existing Express/MySQL and vanilla HTML/CSS/JavaScript structure. Add scoped mobile contracts instead of redesigning pages, centralize composer state in the existing messages client, enforce supported messaging roles at both client and route boundaries, and validate complete positive integer identifiers before data access.

**Tech Stack:** Node.js `node:test`, Express 4, `express-validator`, vanilla JavaScript, HTML, CSS, and the in-app browser.

## Global Constraints

- Preserve the existing Lumi5 colors, typography, card hierarchy, desktop layout, and managed-message left/right alignment.
- Do not change the database schema, database rows, accounts, credentials, managed-room membership, archive behavior, or message persistence.
- Use test-driven development: add each regression test and observe its expected failure before changing production code.
- At 390 pixels, protected pages must have no document-level horizontal overflow; wide administrator tables may scroll only within their wrappers.
- Messaging is available only to `business_owner`, `investor`, and `relationship_manager`.
- Do not push, deploy, or mutate live application data.
- Keep cache-keyed local assets synchronized at release key `20260723.6`.

---

## File Map

- Modify `css/style.css`: scoped protected-page responsive contract and table scroll wrapper.
- Modify `businessownerdashboard.html`: mark the shared page shell as protected.
- Modify `mybusinesses.html`: mark the shared page shell as protected.
- Modify `createportfolio.html`: mark the shared page shell as protected and bump the editor asset key.
- Modify `moderatordashboard.html`: mark the shared page shell as protected and wrap the moderation table.
- Modify `audit-logs.html`: mark the shared page shell as protected and wrap the audit table.
- Modify `investordashboard.html`: add investor-dashboard mobile rules.
- Modify `browse.html`: add Browse mobile rules and bump the Browse asset key.
- Modify `my-interests.html`: add My Interests mobile rules.
- Modify `messages.html`: constrain mobile grids, wire resilient sign-out, and bump messaging assets.
- Modify `js/messages.js`: centralized composer state, admin redirect, and synchronized API fallback key.
- Modify `backend/src/routes/messages.js`: supported-role guards.
- Modify `js/createportfolio.js`: strict edit-ID parsing and invalid-link routing.
- Modify `backend/src/routes/portfolios.js`: canonical positive-safe-integer route validation.
- Modify `js/browse.js`: account-menu binding before workspace I/O.
- Modify `backend/test/frontend-flow-contract.test.js`: responsive wrappers and release-key contracts.
- Modify `backend/test/messages-layout.test.js`: message grid containment contracts.
- Modify `backend/test/messages-client.test.js`: composer and administrator redirect behavior.
- Modify `backend/test/managed-messages-client.test.js`: actual degraded sign-out wiring.
- Modify `backend/test/messages-route.test.js`: administrator route denial before data access.
- Modify `backend/test/createportfolio-client.test.js`: canonical edit-ID behavior.
- Modify `backend/test/portfolio-request-boundaries.test.js`: malformed route IDs rejected before data access.
- Modify `backend/test/browse-client.test.js`: menu binding before deferred data settles.

---

### Task 1: Make Shared and Investor Pages Responsive

**Files:**
- Modify: `backend/test/frontend-flow-contract.test.js`
- Modify: `css/style.css`
- Modify: `businessownerdashboard.html`
- Modify: `mybusinesses.html`
- Modify: `createportfolio.html`
- Modify: `moderatordashboard.html`
- Modify: `audit-logs.html`
- Modify: `investordashboard.html`
- Modify: `browse.html`
- Modify: `my-interests.html`

**Interfaces:**
- Consumes: existing `.nav`, `.stats-grid`, `.content-row`, `.pf-form-row`, investor page grids, and administrator `.table` markup.
- Produces: `.protected-page` and `.table-scroll` presentation contracts plus scoped investor breakpoints.

- [ ] **Step 1: Add failing shared responsive contracts**

Append to `backend/test/frontend-flow-contract.test.js`:

```js
test('shared protected pages collapse without widening the document', () => {
  const css = read('css/style.css');
  for (const page of [
    'businessownerdashboard.html',
    'mybusinesses.html',
    'createportfolio.html',
    'moderatordashboard.html',
    'audit-logs.html',
  ]) {
    assert.match(read(page), /<body class=["'][^"']*\bprotected-page\b/);
  }
  assert.match(css, /\.table-scroll\s*\{[^}]*overflow-x:\s*auto/s);
  assert.match(
    css,
    /@media \(max-width:\s*900px\)[\s\S]*?\.protected-page \.stats-grid\s*\{[^}]*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
  );
  assert.match(
    css,
    /@media \(max-width:\s*699px\)[\s\S]*?\.protected-page \.nav\s*\{[^}]*flex-wrap:\s*wrap/,
  );
  assert.match(
    css,
    /@media \(max-width:\s*699px\)[\s\S]*?\.protected-page \.content-row\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
  );
  assert.match(
    css,
    /@media \(max-width:\s*699px\)[\s\S]*?\.protected-page \.pf-form-row\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
  );
});

test('administrator data tables scroll inside their cards on narrow screens', () => {
  for (const page of ['moderatordashboard.html', 'audit-logs.html']) {
    assert.match(
      read(page),
      /<div class=["']table-scroll["']>[\s\S]*?<table class=["']table["'][\s\S]*?<\/table>[\s\S]*?<\/div>/,
      page,
    );
  }
});

test('standalone investor pages define narrow-screen layout contracts', () => {
  const dashboard = read('investordashboard.html');
  const browse = read('browse.html');
  const interests = read('my-interests.html');
  for (const [page, source] of [
    ['investordashboard.html', dashboard],
    ['browse.html', browse],
    ['my-interests.html', interests],
  ]) {
    assert.match(source, /@media \(max-width:\s*699px\)/, page);
    assert.match(
      source,
      /@media \(max-width:\s*699px\)[\s\S]*?\.nav\s*\{[^}]*flex-wrap:\s*wrap/,
      page,
    );
    assert.match(
      source,
      /@media \(max-width:\s*699px\)[\s\S]*?\.nav-links\s*\{[^}]*overflow-x:\s*auto/,
      page,
    );
  }
  assert.match(
    dashboard,
    /@media \(max-width:\s*699px\)[\s\S]*?\.stats-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
  );
  assert.match(
    browse,
    /@media \(max-width:\s*699px\)[\s\S]*?\.filter-input\s*\{[^}]*min-width:\s*0/,
  );
  assert.match(
    interests,
    /@media \(max-width:\s*699px\)[\s\S]*?\.interest-card\s*\{[^}]*flex-direction:\s*column/,
  );
});
```

- [ ] **Step 2: Run the responsive contracts and verify RED**

Run:

```bash
node --test backend/test/frontend-flow-contract.test.js
```

Expected: the three new tests fail because the protected-page class, table wrappers, and investor mobile media rules are absent.

- [ ] **Step 3: Mark shared authenticated page shells**

Use these body classes:

```html
<!-- businessownerdashboard.html -->
<body class="biz-dashboard protected-page">

<!-- mybusinesses.html -->
<body class="protected-page">

<!-- createportfolio.html -->
<body class="protected-page">

<!-- moderatordashboard.html -->
<body class="dashboard protected-page">

<!-- audit-logs.html -->
<body class="audit protected-page">
```

- [ ] **Step 4: Add the shared responsive CSS**

Add to `css/style.css` beside the shared table and layout rules:

```css
.table-scroll {
  max-width: 100%;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}

.table-scroll > .table {
  min-width: 640px;
}

@media (max-width: 900px) {
  .protected-page .stats-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .protected-page .content-row {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 699px) {
  .protected-page .nav {
    height: auto;
    min-height: 56px;
    padding: 10px 16px;
    flex-wrap: wrap;
  }

  .protected-page .nav-logo {
    margin-right: 0;
  }

  .protected-page .nav-links {
    order: 3;
    flex: 1 0 100%;
    width: 100%;
    overflow-x: auto;
    padding-bottom: 2px;
  }

  .protected-page .nav-btn {
    flex: 0 0 auto;
    white-space: nowrap;
  }

  .protected-page .nav-right {
    gap: 8px;
  }

  .protected-page .user-info {
    display: none;
  }

  .protected-page .main {
    min-width: 0;
    padding: 20px 16px 36px;
  }

  .protected-page .stats-grid,
  .protected-page .content-row,
  .protected-page .pf-form-row,
  .protected-page .biz-info-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .protected-page .page-header,
  .protected-page .pf-header,
  .protected-page .card-header {
    align-items: stretch;
    flex-direction: column;
  }

  .protected-page .pf-header-left {
    min-width: 0;
  }

  .protected-page .pf-header-actions {
    width: 100%;
  }

  .protected-page .pf-header-actions .btn {
    flex: 1;
  }
}
```

- [ ] **Step 5: Wrap administrator tables**

In `moderatordashboard.html`, insert the opening wrapper immediately before the
Moderation Queue `<table class="table">`:

```html
<div class="table-scroll">
```

Insert this closing tag immediately after that table's `</table>`:

```html
</div>
```

Apply the same two insertions immediately before and after the Action History
table in `audit-logs.html`.

- [ ] **Step 6: Add investor dashboard breakpoints**

Before `</style>` in `investordashboard.html`, add:

```css
@media (max-width: 900px) {
  .stats-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .layout-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 699px) {
  .nav {
    height: auto;
    min-height: 56px;
    padding: 10px 16px;
    flex-wrap: wrap;
  }

  .nav-logo { margin-right: 0; }
  .nav-links {
    order: 3;
    flex: 1 0 100%;
    width: 100%;
    overflow-x: auto;
  }
  .nav-btn { flex: 0 0 auto; white-space: nowrap; }
  .user-info { display: none; }
  .main { min-width: 0; padding: 20px 16px 36px; }
  .stats-grid,
  .recent-grid {
    grid-template-columns: minmax(0, 1fr);
  }
  .rec-item {
    align-items: flex-start;
    flex-wrap: wrap;
  }
}
```

- [ ] **Step 7: Add Browse breakpoints**

Before `</style>` in `browse.html`, add:

```css
@media (max-width: 699px) {
  .nav {
    height: auto;
    min-height: 56px;
    padding: 10px 16px;
    flex-wrap: wrap;
  }

  .nav-logo { margin-right: 0; }
  .nav-links {
    order: 3;
    flex: 1 0 100%;
    width: 100%;
    overflow-x: auto;
  }
  .nav-btn { flex: 0 0 auto; white-space: nowrap; }
  .user-info { display: none; }
  .main { min-width: 0; padding: 20px 16px 36px; }
  .filters { align-items: stretch; }
  .filter-input,
  .filter-select,
  .btn-filter {
    min-width: 0;
    width: 100%;
  }
  .results-row {
    align-items: flex-start;
    flex-direction: column;
    gap: 8px;
  }
  .card-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
```

- [ ] **Step 8: Add My Interests breakpoints**

Before `</style>` in `my-interests.html`, add:

```css
@media (max-width: 699px) {
  .nav {
    height: auto;
    min-height: 56px;
    padding: 10px 16px;
    flex-wrap: wrap;
  }

  .nav-logo { margin-right: 0; }
  .nav-links {
    order: 3;
    flex: 1 0 100%;
    width: 100%;
    overflow-x: auto;
  }
  .nav-btn { flex: 0 0 auto; white-space: nowrap; }
  .user-info { display: none; }
  .main { min-width: 0; padding: 20px 16px 36px; }
  .page-header,
  .interest-card {
    align-items: stretch;
    flex-direction: column;
  }
  .page-title {
    align-items: flex-start;
    flex-wrap: wrap;
  }
  .interest-info { min-width: 0; }
  .interest-meta { flex-wrap: wrap; }
  .interest-actions,
  .interest-actions > * {
    width: 100%;
  }
}
```

- [ ] **Step 9: Run the responsive contracts and verify GREEN**

Run:

```bash
node --test backend/test/frontend-flow-contract.test.js
```

Expected: every frontend flow contract passes.

- [ ] **Step 10: Commit the responsive fix**

```bash
git add \
  backend/test/frontend-flow-contract.test.js \
  css/style.css \
  businessownerdashboard.html \
  mybusinesses.html \
  createportfolio.html \
  moderatordashboard.html \
  audit-logs.html \
  investordashboard.html \
  browse.html \
  my-interests.html
git commit -m "fix: make authenticated pages responsive"
```

---

### Task 2: Contain Mobile Messaging and Centralize Composer State

**Files:**
- Modify: `backend/test/messages-layout.test.js`
- Modify: `backend/test/messages-client.test.js`
- Modify: `backend/test/managed-messages-client.test.js`
- Modify: `messages.html`
- Modify: `js/messages.js`

**Interfaces:**
- Consumes: active conversation state and `#message-input` input events.
- Produces: `updateComposerState()`, shrink-safe message layout, and actual `signOutMessages()` button wiring.

- [ ] **Step 1: Add failing message-layout assertions**

Append to `backend/test/messages-layout.test.js`:

```js
test('message thread and composer use shrinkable explicit columns', () => {
  assert.match(
    firstRule('.thread-panel'),
    /grid-template-columns:\s*minmax\(0,\s*1fr\)\s*;/,
  );
  assert.match(firstRule('.thread-header'), /min-width:\s*0\s*;/);
  assert.match(firstRule('.message-list'), /min-width:\s*0\s*;/);
  assert.match(firstRule('.composer-zone'), /min-width:\s*0\s*;/);
  const composer = firstRule('.compose-form');
  assert.match(composer, /min-width:\s*0\s*;/);
  assert.match(
    composer,
    /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto\s*;/,
  );
  const input = firstRule('.compose-input');
  assert.match(input, /min-width:\s*0\s*;/);
  assert.match(input, /width:\s*100%\s*;/);
  assert.match(firstRule('.message-bubble'), /overflow-wrap:\s*anywhere\s*;/);
});

test('narrow message shell uses a shrinkable single column', () => {
  const match = html.match(
    /@media\s*\(max-width:\s*820px\)[\s\S]*?\.messaging-shell\s*\{([^}]*)\}/,
  );
  assert.ok(match);
  assert.match(
    match[1],
    /grid-template-columns:\s*minmax\(0,\s*1fr\)\s*;/,
  );
});
```

- [ ] **Step 2: Add failing composer-state tests**

In the `clientHarness()` setup block in
`backend/test/messages-client.test.js`, call the current availability function
after caching elements:

```js
cacheElements();
setComposeEnabled(true);
```

In `backend/test/messages-client.test.js`, change the successful-send
expectation to:

```js
assert.equal(client.run('els.messageInput.disabled'), false);
assert.equal(client.run('els.sendBtn.disabled'), true);
```

Append:

```js
test('writable room enables typing but requires a non-whitespace draft to send', () => {
  const client = clientHarness();
  client.run(`
    els.messageInput.value = '';
    setComposeEnabled(true);
  `);
  assert.equal(client.run('els.messageInput.disabled'), false);
  assert.equal(client.run('els.sendBtn.disabled'), true);

  client.run(`
    els.messageInput.value = '   ';
    updateComposerState();
  `);
  assert.equal(client.run('els.sendBtn.disabled'), true);

  client.run(`
    els.messageInput.value = 'Ready to send';
    updateComposerState();
  `);
  assert.equal(client.run('els.sendBtn.disabled'), false);
});

test('input events update Send without changing active-room writability', async () => {
  const client = clientHarness();
  client.run(`
    bindEvents();
    els.messageInput.value = '';
    setComposeEnabled(true);
  `);
  await client.elements.get('message-input').listeners.get('input')[0]({});
  assert.equal(client.run('els.sendBtn.disabled'), true);

  client.run("els.messageInput.value = 'New draft'");
  await client.elements.get('message-input').listeners.get('input')[0]({});
  assert.equal(client.run('els.sendBtn.disabled'), false);
});

test('archived rooms cannot enable Send through draft input', () => {
  const client = clientHarness();
  client.run(`
    state.activeThread.conversation.status = 'archived';
    state.activeThread.conversation.can_send = false;
    els.messageInput.value = 'Blocked draft';
    setComposeEnabled(false);
    updateComposerState();
  `);
  assert.equal(client.run('els.messageInput.disabled'), true);
  assert.equal(client.run('els.sendBtn.disabled'), true);
});
```

- [ ] **Step 3: Make the degraded sign-out contract fail**

In `backend/test/managed-messages-client.test.js`, replace:

```js
assert.match(html, /onclick="signOut\(\)"/);
```

with:

```js
assert.match(html, /onclick="signOutMessages\(\)"/);
assert.doesNotMatch(html, /id="messages-signout"[^>]*onclick="signOut\(\)"/);
```

- [ ] **Step 4: Run focused messaging tests and verify RED**

Run:

```bash
node --test \
  backend/test/messages-layout.test.js \
  backend/test/messages-client.test.js \
  backend/test/managed-messages-client.test.js
```

Expected: layout containment, empty-send behavior, and sign-out wiring tests fail.

- [ ] **Step 5: Constrain message CSS and wire sign-out**

In `messages.html`, apply:

```css
.thread-panel {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: auto minmax(0, 1fr) auto;
  background: #FFFFFF;
}

.thread-header,
.message-list,
.composer-zone {
  min-width: 0;
}

.message-bubble {
  overflow-wrap: anywhere;
}

.compose-form {
  min-width: 0;
  padding: 14px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  background: transparent;
}

.compose-input {
  width: 100%;
  min-width: 0;
}
```

Inside the existing 820-pixel media query, use:

```css
.messaging-shell {
  height: auto;
  min-height: 0;
  grid-template-columns: minmax(0, 1fr);
}
```

Change the sign-out button to:

```html
<button class="role-option"
        id="messages-signout"
        type="button"
        onclick="signOutMessages()"
        role="menuitem">
```

- [ ] **Step 6: Centralize composer state**

In `js/messages.js`, add:

```js
let composeAvailable = false;
```

In `bindEvents()`, before the form submit listener, add:

```js
els.messageInput.addEventListener('input', updateComposerState);
```

Replace `setComposeEnabled` and `setSending` with:

```js
function updateComposerState() {
  const canWrite = Boolean(
    composeAvailable
    && !state.sending
    && state.activeThread?.conversation?.status === 'active'
    && state.activeThread?.conversation?.can_send,
  );
  els.messageInput.disabled = !canWrite;
  els.sendBtn.disabled = !canWrite || !els.messageInput.value.trim();
}

function setComposeEnabled(enabled) {
  composeAvailable = Boolean(enabled);
  updateComposerState();
}

function setSending(sending) {
  state.sending = sending;
  updateRefreshDisabled();
  updateComposerState();
  els.sendBtn.innerHTML = sending
    ? '<i class="ti ti-loader-2"></i> Sending'
    : '<i class="ti ti-send"></i> Send';
}
```

The existing send `finally` block calls `setSending(false)`, which now derives
the correct state from the cleared or restored draft.

- [ ] **Step 7: Run focused messaging tests and verify GREEN**

Run:

```bash
node --test \
  backend/test/messages-layout.test.js \
  backend/test/messages-client.test.js \
  backend/test/managed-messages-client.test.js
```

Expected: every focused messaging test passes.

- [ ] **Step 8: Commit the message layout and composer fix**

```bash
git add \
  backend/test/messages-layout.test.js \
  backend/test/messages-client.test.js \
  backend/test/managed-messages-client.test.js \
  messages.html \
  js/messages.js
git commit -m "fix: contain and validate message composer"
```

---

### Task 3: Enforce the Managed-Messaging Role Boundary

**Files:**
- Modify: `backend/test/messages-client.test.js`
- Modify: `backend/test/messages-route.test.js`
- Modify: `js/messages.js`
- Modify: `backend/src/routes/messages.js`

**Interfaces:**
- Consumes: `/messages/me` identity and JWT `req.user.role`.
- Produces: administrator client redirect and API HTTP 403 before message data access.

- [ ] **Step 1: Add the failing administrator client test**

Append to `backend/test/messages-client.test.js`:

```js
test('administrator identity returns to moderation before loading an inbox', async () => {
  const client = clientHarness();
  client.run(`
    state.user = null;
    window.location.href = 'messages.html';
  `);
  client.hooks.request = async (requestPath) => {
    assert.equal(requestPath, '/messages/me');
    return {
      id: 1,
      name: 'Victor',
      role: 'admin',
    };
  };

  assert.equal(await client.run('loadMessagesWorkspace()'), false);
  assert.equal(client.run('window.location.href'), 'moderatordashboard.html');
  assert.deepEqual(
    client.hooks.requests.map(({ path: requestPath }) => requestPath),
    ['/messages/me'],
  );
  assert.equal(client.storage.get('lumilabsToken'), 'signed-test-token');
});
```

- [ ] **Step 2: Add failing route-boundary tests**

Append to `backend/test/messages-route.test.js`:

```js
const admin = {
  id: 1,
  email: 'victor@example.test',
  name: 'Victor',
  role: 'admin',
};

for (const [method, path, body] of [
  ['GET', '/conversations'],
  ['GET', '/conversations/12'],
  ['PUT', '/conversations/12/read', { message_id: 42 }],
  ['POST', '/conversations/12/messages', { content: 'Blocked' }],
]) {
  test(`administrator receives 403 for ${method} ${path} before data access`, {
    concurrency: false,
  }, async (t) => {
    const originalQuery = db.query;
    const originalGetConnection = db.getConnection;
    let dataCalls = 0;
    db.query = async () => {
      dataCalls += 1;
      throw new Error('administrator request reached db.query');
    };
    db.getConnection = async () => {
      dataCalls += 1;
      throw new Error('administrator request reached db.getConnection');
    };
    t.after(() => {
      db.query = originalQuery;
      db.getConnection = originalGetConnection;
    });

    const { response, payload } = await request(t, path, admin, {
      method,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    assert.equal(response.status, 403);
    assert.deepEqual(payload, { error: 'Insufficient permissions' });
    assert.equal(dataCalls, 0);
  });
}
```

- [ ] **Step 3: Run role-policy tests and verify RED**

Run:

```bash
node --test \
  backend/test/messages-client.test.js \
  backend/test/messages-route.test.js
```

Expected: the client loads an administrator inbox and the API routes do not
return the required role-level 403.

- [ ] **Step 4: Redirect unsupported client roles**

In `js/messages.js`, add:

```js
const MESSAGE_ROLES = new Set([
  'business_owner',
  'investor',
  'relationship_manager',
]);
```

Immediately after `/messages/me` returns and before assigning `state.user`, add:

```js
if (!MESSAGE_ROLES.has(user.role)) {
  window.location.href = user.role === 'admin'
    ? 'moderatordashboard.html'
    : 'index.html';
  return false;
}
```

- [ ] **Step 5: Guard message data routes**

In `backend/src/routes/messages.js`, change the middleware import to:

```js
const { authenticate, requireRole } = require('../middleware/auth');
```

Add:

```js
const requireMessagingRole = requireRole(
  'business_owner',
  'investor',
  'relationship_manager',
);
```

Keep `GET /me` authenticated-only so the page can route a valid administrator
session. Add `requireMessagingRole` immediately after `authenticate` on:

```text
GET /conversations
GET /conversations/:conversationId
PUT /conversations/:conversationId/read
POST /conversations/:conversationId/messages
```

- [ ] **Step 6: Run role-policy tests and verify GREEN**

Run:

```bash
node --test \
  backend/test/messages-client.test.js \
  backend/test/messages-route.test.js
```

Expected: every client and route policy test passes with zero database calls for
administrator requests.

- [ ] **Step 7: Commit the messaging role boundary**

```bash
git add \
  backend/test/messages-client.test.js \
  backend/test/messages-route.test.js \
  js/messages.js \
  backend/src/routes/messages.js
git commit -m "fix: enforce managed messaging roles"
```

---

### Task 4: Validate Portfolio Identifiers End to End

**Files:**
- Modify: `backend/test/createportfolio-client.test.js`
- Modify: `backend/test/portfolio-request-boundaries.test.js`
- Modify: `js/createportfolio.js`
- Modify: `backend/src/routes/portfolios.js`

**Interfaces:**
- Consumes: `?id=` edit query values and `:id`/`:docId` API path parameters.
- Produces: canonical positive-safe-integer IDs or HTTP/client rejection before data access.

- [ ] **Step 1: Extend the editor harness and add failing strict-ID tests**

Change `editorHarness()` to accept:

```js
function editorHarness({
  locationSearch = '',
  user = null,
} = {}) {
```

Use `locationSearch` in `window.location.search`, leave the initial
`requirePageRole` result unauthenticated while the source evaluates, add
`getPortfolio` to `API`, and track calls:

```js
const hooks = {
  alerts: [],
  created: [],
  focused: [],
  loaded: [],
  updated: [],
};

window: { location: { search: locationSearch, href: '' } },
requirePageRole: async () => null,
API: {
  async getPortfolio(id) {
    hooks.loaded.push(id);
    return {
      id,
      owner_id: user?.id,
      name: 'Loaded',
      sector: 'Fintech',
      mvp_status: 'Beta',
      funding_goal: '1000.00',
      status: 'draft',
      documents: [],
    };
  },
  async createPortfolio(payload) {
    hooks.created.push(payload);
    return { id: 99 };
  },
  async updatePortfolio(id, payload) {
    hooks.updated.push({ id, payload });
    return {};
  },
},
```

Immediately after `vm.runInContext(source, context)`, install the requested
identity without changing the source file's automatic unauthenticated
initialization:

```js
if (user) {
  context.editorUser = user;
  vm.runInContext(
    'requirePageRole = async () => editorUser;',
    context,
  );
}
```

Append:

```js
test('portfolio edit IDs accept only canonical positive safe integers', () => {
  const editor = editorHarness();
  for (const valid of ['1', '22', String(Number.MAX_SAFE_INTEGER)]) {
    assert.equal(editor.run(`normalizeEditPortfolioId(${JSON.stringify(valid)})`), Number(valid));
  }
  for (const invalid of [
    null, '', '0', '-1', '01', '1.5', '2e1', '22junk', ' 22',
    String(Number.MAX_SAFE_INTEGER + 1),
  ]) {
    assert.equal(editor.run(`normalizeEditPortfolioId(${JSON.stringify(invalid)})`), null);
  }
});

test('malformed edit link redirects after owner auth without loading a portfolio', async () => {
  const editor = editorHarness({
    locationSearch: '?id=22junk',
    user: { id: 7, role: 'business_owner' },
  });

  await editor.run('init()');

  assert.deepEqual(editor.hooks.loaded, []);
  assert.equal(editor.run('window.location.href'), 'mybusinesses.html');
  assert.match(editor.hooks.alerts.at(-1), /invalid portfolio link/i);
});

test('canonical edit ID loads once and a missing ID remains create mode', async () => {
  const edit = editorHarness({
    locationSearch: '?id=22',
    user: { id: 7, role: 'business_owner' },
  });
  await edit.run('init()');
  assert.deepEqual(edit.hooks.loaded, [22]);

  const create = editorHarness({
    user: { id: 7, role: 'business_owner' },
  });
  await create.run('init()');
  assert.deepEqual(create.hooks.loaded, []);
});
```

- [ ] **Step 2: Add failing API path-ID tests**

Append to `backend/test/portfolio-request-boundaries.test.js`:

```js
test('malformed portfolio route IDs stop before data or transaction access', {
  concurrency: false,
}, async (t) => {
  const calls = installDatabaseSpies(t);
  const server = await listen(createApp());
  t.after(server.close);

  for (const [method, path, body] of [
    ['GET', '/api/portfolios/22junk'],
    ['PUT', '/api/portfolios/22junk', {}],
    ['POST', '/api/portfolios/22junk/submit'],
    ['POST', '/api/portfolios/22junk/documents'],
    ['DELETE', '/api/portfolios/22junk'],
    ['GET', '/api/portfolios/22/documents/9junk/download'],
    ['DELETE', '/api/portfolios/22/documents/9junk'],
  ]) {
    const before = { ...calls };
    const result = await request(server, method, path, body);
    assert.equal(result.response.status, 400, `${method} ${path}`);
    assert.deepEqual(calls, before, `${method} ${path} data access`);
  }
});
```

- [ ] **Step 3: Run strict-ID tests and verify RED**

Run:

```bash
node --test \
  backend/test/createportfolio-client.test.js \
  backend/test/portfolio-request-boundaries.test.js
```

Expected: the client accepts numeric prefixes and the server paths reach data
handlers instead of uniformly returning 400.

- [ ] **Step 4: Parse the complete edit query value**

At the top of `js/createportfolio.js`, replace the `parseInt` assignment with:

```js
const params = new URLSearchParams(window.location.search);
const hasEditId = params.has('id');

function normalizeEditPortfolioId(rawValue) {
  if (!/^[1-9]\d*$/.test(String(rawValue ?? ''))) return null;
  const id = Number(rawValue);
  return Number.isSafeInteger(id) ? id : null;
}

let editId = hasEditId
  ? normalizeEditPortfolioId(params.get('id'))
  : null;
```

At the beginning of `init()`, after successful owner authentication and before
edit-mode loading, add:

```js
if (hasEditId && editId === null) {
  alert('Invalid portfolio link. Return to My Businesses and try again.');
  window.location.href = 'mybusinesses.html';
  return;
}
```

Use `editId !== null` for every edit/create branch that currently depends on
edit-ID truthiness.

- [ ] **Step 5: Validate route IDs before handlers and uploads**

In `backend/src/routes/portfolios.js`, import `param`:

```js
const { body, param, validationResult } = require('express-validator');
```

Add:

```js
function positiveSafeIntegerParam(name, label) {
  return param(name)
    .custom((value) => (
      /^[1-9]\d*$/.test(String(value))
      && Number.isSafeInteger(Number(value))
    ))
    .withMessage(`${label} must be a positive integer`)
    .toInt();
}

const portfolioIdValidation = positiveSafeIntegerParam('id', 'Portfolio ID');
const documentIdValidation = positiveSafeIntegerParam('docId', 'Document ID');

function rejectInvalidRequest(req, res, next) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return next();
  return res.status(400).json({ errors: errors.array() });
}
```

Place `portfolioIdValidation` and `rejectInvalidRequest` before the handler on
GET detail, submit, upload, and portfolio delete. Place both ID validators
before the handler on download and document delete. On update, place
`portfolioIdValidation` before `portfolioUpdateValidation`; its existing
`validationResult` check handles both path and body errors.

For document upload and deletion, the required order is:

```js
authenticate,
requireRole('business_owner'),
portfolioIdValidation,
documentIdValidation, // document deletion only
rejectInvalidRequest,
loadOwnedEditablePortfolio,
upload.array('documents', 5), // upload only
```

This order rejects invalid identifiers before database access or file handling.

- [ ] **Step 6: Run strict-ID tests and verify GREEN**

Run:

```bash
node --test \
  backend/test/createportfolio-client.test.js \
  backend/test/portfolio-request-boundaries.test.js
```

Expected: every strict-ID test passes.

- [ ] **Step 7: Commit the identifier boundary**

```bash
git add \
  backend/test/createportfolio-client.test.js \
  backend/test/portfolio-request-boundaries.test.js \
  js/createportfolio.js \
  backend/src/routes/portfolios.js
git commit -m "fix: validate portfolio identifiers"
```

---

### Task 5: Bind Browse Account Controls Before Workspace I/O

**Files:**
- Modify: `backend/test/browse-client.test.js`
- Modify: `js/browse.js`

**Interfaces:**
- Consumes: successful `requirePageRole("investor")`.
- Produces: one account-menu binding before portfolio, interest, or recommendation requests can remain pending.

- [ ] **Step 1: Add the failing deferred-workspace test**

Append to `backend/test/browse-client.test.js`:

```js
test('account menu binds before a deferred Browse workspace settles', async () => {
  const workspace = deferred();
  const client = browseHarness({
    captureFilters: false,
    captureStatus: false,
    captureRecommendationStatus: false,
  });
  client.context.pendingWorkspace = workspace.promise;
  client.run(`
    requirePageRole = async () => ({
      id: 9,
      name: 'Investor',
      role: 'investor',
    });
    API.getAllPortfolios = async () => pendingWorkspace;
    API.getMyInterests = async () => [];
    API.getRecommendations = async () => [];
  `);

  const initialization = client.run('init()');
  await flush();

  assert.equal(
    client.elements.get('role-menu-button').listeners.get('click')?.length,
    1,
  );

  workspace.resolve([]);
  await initialization;
  assert.equal(
    client.elements.get('role-menu-button').listeners.get('click')?.length,
    1,
  );
});
```

- [ ] **Step 2: Run the Browse test and verify RED**

Run:

```bash
node --test backend/test/browse-client.test.js
```

Expected: the role-menu button has no click listener while the workspace
request is pending.

- [ ] **Step 3: Move menu initialization before data loading**

In `js/browse.js`, call:

```js
initRoleMenu();
```

immediately after setting `user-avatar` and `user-name` in `init()`. Remove the
calls from the workspace catch block and the end of `init()`, leaving exactly
one authenticated binding site.

- [ ] **Step 4: Run the Browse test and verify GREEN**

Run:

```bash
node --test backend/test/browse-client.test.js
```

Expected: every Browse client test passes and the deferred request observes one
menu binding.

- [ ] **Step 5: Commit the Browse recovery fix**

```bash
git add backend/test/browse-client.test.js js/browse.js
git commit -m "fix: keep Browse account controls available"
```

---

### Task 6: Synchronize Asset Keys and Run the Complete Verification Gate

**Files:**
- Modify: `backend/test/frontend-flow-contract.test.js`
- Modify: `audit-logs.html`
- Modify: `browse.html`
- Modify: `businessownerdashboard.html`
- Modify: `createportfolio.html`
- Modify: `index.html`
- Modify: `investordashboard.html`
- Modify: `messages.html`
- Modify: `moderatordashboard.html`
- Modify: `my-interests.html`
- Modify: `mybusinesses.html`
- Modify: `relationshipmanagerdashboard.html`
- Modify: `signin.html`
- Modify: `signup.html`
- Modify: `js/messages.js`
- Verify: every implementation and test file changed by Tasks 1–5.

**Interfaces:**
- Consumes: release assets changed by Tasks 1–5.
- Produces: one `20260723.6` cache contract and fresh automated/browser evidence.

- [ ] **Step 1: Change the release-key test first**

In `backend/test/frontend-flow-contract.test.js`, change:

```js
const releaseKey = '20260723.5';
```

to:

```js
const releaseKey = '20260723.6';
```

- [ ] **Step 2: Run the release contract and verify RED**

Run:

```bash
node --test backend/test/frontend-flow-contract.test.js
```

Expected: the release-key contract fails on assets still using
`20260723.5`.

- [ ] **Step 3: Synchronize the release key**

Replace local CSS/JavaScript query key `20260723.5` with `20260723.6` in:

```text
audit-logs.html
browse.html
businessownerdashboard.html
createportfolio.html
index.html
investordashboard.html
messages.html
moderatordashboard.html
my-interests.html
mybusinesses.html
relationshipmanagerdashboard.html
signin.html
signup.html
```

In `js/messages.js`, set:

```js
const MESSAGES_API_SCRIPT_SRC = 'js/api.js?v=20260723.6';
```

Do not modify the pinned third-party Tabler Icons version.

- [ ] **Step 4: Run the release contract and verify GREEN**

Run:

```bash
node --test backend/test/frontend-flow-contract.test.js
```

Expected: every frontend flow contract passes.

- [ ] **Step 5: Run browser JavaScript syntax checks**

Run:

```bash
for release_script in js/*.js; do
  node --check "$release_script"
done
```

Expected: every script exits with status zero.

- [ ] **Step 6: Run backend JavaScript syntax checks**

Run:

```bash
for release_script in backend/server.js backend/src/**/*.js; do
  node --check "$release_script"
done
```

Expected: every server script exits with status zero.

- [ ] **Step 7: Run the complete automated suite**

Run:

```bash
npm --prefix backend test
```

Expected: zero failed, skipped, cancelled, or todo tests.

- [ ] **Step 8: Run patch and scope checks**

Run:

```bash
git diff --check
git status --short --branch
git diff --stat 726b2d2..HEAD
git diff --name-only 726b2d2..HEAD | sort
```

Expected: no patch-hygiene errors and no paths outside the approved spec, plan,
implementation, tests, and synchronized HTML release references.

- [ ] **Step 9: Perform signed-in browser verification**

At desktop and 390-by-844 viewports, authenticate with the supplied accounts
and verify:

```text
Public: index, sign-in, and sign-up have no document overflow.
Owner: dashboard, My Businesses, Create Portfolio, and Messages have no document overflow.
Investor: dashboard, Browse, My Interests, and Messages have no document overflow.
Manager: dashboard and Messages have no document overflow.
Admin: dashboard and Audit Logs have no document overflow; tables scroll only inside wrappers.
Messaging: left/right alignment is unchanged; composer, Send, and bubbles remain within thread bounds.
Composer: blank and whitespace drafts disable Send; non-empty draft enables Send.
Routing: direct administrator Messages access returns to the moderation dashboard.
Console: zero warning or error entries.
```

Do not send a message or perform any live mutation.

- [ ] **Step 10: Commit the release-key and verification contract**

```bash
git add \
  backend/test/frontend-flow-contract.test.js \
  js/messages.js \
  *.html
git commit -m "chore: synchronize QA remediation assets"
```

- [ ] **Step 11: Verify the final committed state**

Run:

```bash
npm --prefix backend test
git diff --check HEAD^
git status --short --branch
git log -7 --oneline --decorate
```

Expected: the complete suite passes, patch hygiene is clean, and the worktree
contains no uncommitted implementation changes.
