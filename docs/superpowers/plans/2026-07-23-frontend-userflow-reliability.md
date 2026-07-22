# Frontend User-Flow Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair the confirmed frontend/runtime user-flow defects while preserving the existing schema, backend routes, permissions, visual design, and live data.

**Architecture:** Keep `js/api.js` as the single protected-page request/session boundary, then use page-local state machines for messaging, portfolio editing, investor pages, and the relationship-manager dashboard. Exercise browser code through the repository's existing dependency-free `node:vm` test pattern, commit each coherent red-green change independently, and release only the committed runtime frontend files through verified staged replacements.

**Tech Stack:** Static HTML/CSS/JavaScript, Node.js built-in test runner, `node:vm`, Git, interactive SSH/SFTP, Apache static hosting, Express API health/readiness endpoints.

## Global Constraints

- Follow the approved design in `docs/superpowers/specs/2026-07-23-frontend-userflow-reliability-design.md`.
- Do not change `backend/src/`, `backend/schema.sql`, database records, backend routes, API payloads, role permissions, or the overall site layout.
- Preserve current public signatures unless this plan explicitly adds a named helper.
- Only a confirmed HTTP 401 clears session storage and redirects to `signin.html`.
- HTTP 403, HTTP 5xx, and network failures preserve valid session storage.
- Wrong-role authenticated users retain their session and go to their mapped dashboard.
- An explicit accessible positive `conversationId` opens only that room; an inaccessible positive ID never falls back to another room.
- The server responses from `/portfolios` and `/interests/my` remain authoritative after an interest mutation.
- Archived-room Reopen remains visible, but is disabled with a reason when the observable eligibility rules fail.
- Keep the current message alignment: the signed-in user's messages on the right, every other participant on the left with name and role.
- Use `apply_patch` for repository edits. Do not add a frontend framework or test dependency.
- Every behavior change must be demonstrated by a failing focused test before production code changes, then by a passing focused test.
- Never put the SSH, SFTP, or SQL password in a command, file, test fixture, process argument, or Git history.
- Never force-push. Stop and inspect any Git conflict or live preimage hash mismatch.

## File Responsibility Map

- Modify `js/api.js`: structured request failures, one idempotent 401 transition, role routing, and shared protected-page recovery.
- Modify `messages.html`: load the shared API client before the messaging client and use shared sign-out.
- Modify `js/messages.js`: shared request usage, retryable workspace loading, explicit-ID selection, and unavailable-room invalidation.
- Modify `js/createportfolio.js`: null-aware hydration and integer/decimal parsing that preserves zero.
- Modify `browse.html`: corrected icon URL plus an accessible interest-sync status region.
- Modify `js/browse.js`: globally serialized mutations and atomic authoritative read reconciliation.
- Modify `investordashboard.html`: corrected icon URL only.
- Modify `js/investordashboard.js`: independent section rendering, truthful unknown counts, and reusable retry.
- Modify `my-interests.html`: corrected icon URL only.
- Modify `js/my-interests.js`: early menu binding, guarded data loading, and section-level retry.
- Modify `js/relationshipmanagerdashboard.js`: pure reopen eligibility, global mutation lock, stale-state controls, and truthful refresh outcomes.
- Create `backend/test/api-client.test.js`: executable shared API/session/role contracts.
- Modify `backend/test/messages-client.test.js`: executable initial-selection, refresh-removal, retry, and race contracts.
- Modify `backend/test/managed-messages-client.test.js`: shared-client script-order and no-duplicate-client contract.
- Create `backend/test/createportfolio-client.test.js`: executable zero hydration/serialization contracts.
- Create `backend/test/browse-client.test.js`: executable atomic interest reconciliation and lock contracts.
- Create `backend/test/investor-pages-client.test.js`: executable partial-failure and My Interests retry contracts.
- Modify `backend/test/relationship-manager-client.test.js`: executable reopen matrix and stale-mutation contracts.
- Modify `backend/test/frontend-flow-contract.test.js`: exact pinned Tabler URL contract.
- Do not modify `css/style.css`; reuse the page-local and existing disabled/error classes.

## Execution Preflight

- [ ] **Step 1: Confirm the approved design and plan commits are the only local changes**

Run:

```bash
git status --short --branch
git log -3 --oneline --decorate
```

Expected: `main` has a clean worktree; the design and this plan are committed ahead of, or rebased onto, `origin/main`.

- [ ] **Step 2: Synchronize safely before implementation**

Run:

```bash
git fetch origin
git rev-list --left-right --count origin/main...main
```

If the first number is non-zero, run:

```bash
git rebase origin/main
```

Expected: rebase completes without conflict. If any conflict occurs, run `git rebase --abort`, inspect the conflicting files, and stop for a deliberate merge decision. Do not select a side automatically.

- [ ] **Step 3: Record the exact preimplementation/live-preimage Git tree**

Run:

```bash
if git show-ref --verify --quiet refs/tags/codex-pre-userflow-20260723; then
  echo 'STOP: refs/tags/codex-pre-userflow-20260723 already exists'
  exit 1
fi
git tag --no-sign codex-pre-userflow-20260723 HEAD
git rev-parse codex-pre-userflow-20260723
```

Expected: one full 40-character commit ID. Keep this local tag unpushed until deployment succeeds; it is the exact preimage source for live hash checks and rollback.

- [ ] **Step 4: Reconfirm the green baseline**

Run:

```bash
npm --prefix backend test
```

Expected: 140 tests pass, 0 fail before new tests are added.

---

### Task 1: Shared Protected-Page Request and Session Contract

**Files:**
- Create: `backend/test/api-client.test.js`
- Modify: `js/api.js:1-95,97-133,215-225`

**Interfaces:**
- Consumes: existing `localStorage` keys `lumilabsToken`, `lumilabsUser`, and `lumilabsSelectedUser`; existing `API.getCurrentUser()`.
- Produces: `ApiRequestError(status, isNetworkError)`, `dashboardForRole(role)`, idempotent `redirectToSignIn()`, `showPageRecovery(message)`, and the unchanged public signatures `apiFetch(path, options)` and `requirePageRole(requiredRole)`.
- Produces: a rollout-safe shared base constant named `SHARED_API_BASE`; do not retain the global lexical name `API_BASE`, because the old deployed message client declares that name during the staged release window.

- [ ] **Step 1: Write the failing shared-client tests**

Create `backend/test/api-client.test.js` with a `node:vm` harness and these executable cases:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '..', '..', 'js', 'api.js'),
  'utf8',
);

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

function clientHarness() {
  const values = new Map([
    ['lumilabsToken', 'token'],
    ['lumilabsUser', '{"id":1}'],
    ['lumilabsSelectedUser', '{"id":1}'],
  ]);
  const hooks = { removed: [], redirects: 0, reloads: 0, recovery: null };
  const location = {
    _href: 'protected.html',
    get href() { return this._href; },
    set href(value) { this._href = value; hooks.redirects += 1; },
    reload() { hooks.reloads += 1; },
  };
  const sandbox = {
    window: { LUMILABS_API_BASE: undefined, location },
    localStorage: {
      getItem(key) { return values.get(key) ?? null; },
      removeItem(key) { hooks.removed.push(key); values.delete(key); },
    },
    document: {
      getElementById() { return null; },
      querySelector() { return { replaceChildren(node) { hooks.recovery = node; } }; },
      createElement() {
        const paragraph = { textContent: '' };
        const button = { addEventListener(_name, handler) { this.handler = handler; } };
        return {
          id: '', innerHTML: '', attributes: {}, paragraph, button,
          setAttribute(name, value) { this.attributes[name] = value; },
          querySelector(selector) { return selector === 'p' ? paragraph : button; },
        };
      },
    },
    FormData: class FormData {},
    fetch: async () => response(200, {}),
    console: { error() {}, log() {} },
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(source, context);
  return {
    hooks,
    values,
    context,
    run(code) { return vm.runInContext(code, context); },
  };
}

test('apiFetch clears all session keys and redirects once on repeated HTTP 401', async () => {
  const client = clientHarness();
  client.context.fetch = async () => response(401, { error: 'Session expired' });
  const results = await Promise.allSettled([
    client.run("apiFetch('/one')"),
    client.run("apiFetch('/two')"),
  ]);
  assert.equal(results.every(({ status }) => status === 'rejected'), true);
  assert.equal(results[0].reason.status, 401);
  assert.equal(results[0].reason.isNetworkError, false);
  assert.deepEqual([...client.values.keys()], []);
  assert.equal(client.hooks.redirects, 1);
  assert.equal(client.context.window.location.href, 'signin.html');
});

for (const status of [403, 500]) {
  test(`apiFetch preserves the session and exposes HTTP ${status}`, async () => {
    const client = clientHarness();
    client.context.fetch = async () => response(status, { error: 'Safe error' });
    await assert.rejects(client.run("apiFetch('/protected')"), (error) => {
      assert.equal(error.message, 'Safe error');
      assert.equal(error.status, status);
      assert.equal(error.isNetworkError, false);
      return true;
    });
    assert.equal(client.values.get('lumilabsToken'), 'token');
    assert.equal(client.hooks.redirects, 0);
  });
}

test('apiFetch classifies a network failure without clearing the session', async () => {
  const client = clientHarness();
  client.context.fetch = async () => { throw new TypeError('offline'); };
  await assert.rejects(client.run("apiFetch('/protected')"), (error) => {
    assert.equal(error.status, null);
    assert.equal(error.isNetworkError, true);
    assert.match(error.message, /reach|connection/i);
    return true;
  });
  assert.equal(client.values.get('lumilabsToken'), 'token');
  assert.equal(client.hooks.redirects, 0);
});

test('apiFetch retains a status fallback when an error body is not JSON', async () => {
  const client = clientHarness();
  client.context.fetch = async () => ({
    ok: false,
    status: 502,
    json: async () => { throw new SyntaxError('not JSON'); },
  });
  await assert.rejects(client.run("apiFetch('/protected')"), (error) => {
    assert.equal(error.status, 502);
    assert.equal(error.message, 'Request failed (502)');
    return true;
  });
  assert.equal(client.values.get('lumilabsToken'), 'token');
});

test('requirePageRole returns a matching authenticated user', async () => {
  const client = clientHarness();
  client.run("API.getCurrentUser = async () => ({ id: 2, role: 'investor' })");
  assert.equal((await client.run("requirePageRole('investor')")).id, 2);
  assert.equal(client.hooks.redirects, 0);
});

for (const [role, dashboard] of Object.entries({
  business_owner: 'businessownerdashboard.html',
  investor: 'investordashboard.html',
  relationship_manager: 'relationshipmanagerdashboard.html',
  admin: 'moderatordashboard.html',
})) {
  test(`wrong-role ${role} is routed to its dashboard without sign-out`, async () => {
    const client = clientHarness();
    client.run(`API.getCurrentUser = async () => ({ id: 2, role: '${role}' })`);
    assert.equal(await client.run("requirePageRole('not_this_role')"), null);
    assert.equal(client.context.window.location.href, dashboard);
    assert.equal(client.values.get('lumilabsToken'), 'token');
  });
}

test('requirePageRole renders an accessible full-reload Retry for a 500', async () => {
  const client = clientHarness();
  client.run("API.getCurrentUser = async () => { throw new ApiRequestError('down', { status: 500 }); }");
  assert.equal(await client.run("requirePageRole('investor')"), null);
  assert.equal(client.values.get('lumilabsToken'), 'token');
  assert.equal(client.hooks.recovery.attributes.role, 'alert');
  assert.match(client.hooks.recovery.innerHTML, /Retry/);
  client.hooks.recovery.button.handler();
  assert.equal(client.hooks.reloads, 1);
});

test('requirePageRole preserves credentials and renders Retry for a network failure', async () => {
  const client = clientHarness();
  client.run("API.getCurrentUser = async () => { throw new ApiRequestError('offline', { isNetworkError: true }); }");
  assert.equal(await client.run("requirePageRole('investor')"), null);
  assert.equal(client.values.get('lumilabsToken'), 'token');
  assert.equal(client.hooks.redirects, 0);
  assert.equal(client.hooks.recovery.attributes.role, 'alert');
  assert.match(client.hooks.recovery.paragraph.textContent, /network/i);
});

test('requirePageRole leaves confirmed 401 recovery to the sign-in transition', async () => {
  const client = clientHarness();
  client.run("API.getCurrentUser = async () => { redirectToSignIn(); throw new ApiRequestError('expired', { status: 401 }); }");
  assert.equal(await client.run("requirePageRole('investor')"), null);
  assert.equal(client.context.window.location.href, 'signin.html');
  assert.equal(client.hooks.recovery, null);
});
```

- [ ] **Step 2: Run the focused test and observe the expected failure**

Run:

```bash
node --test backend/test/api-client.test.js
```

Expected: FAIL because `ApiRequestError`, structured status/network fields, recovery UI, one-time redirect, and wrong-role dashboard routing do not exist.

- [ ] **Step 3: Implement the shared request/session boundary**

In `js/api.js`, replace the current base/request/session/role blocks with this contract while retaining the existing `API` facade methods:

```js
const SHARED_API_BASE = window.LUMILABS_API_BASE || "/api";

const ROLE_DASHBOARDS = Object.freeze({
  business_owner: "businessownerdashboard.html",
  investor: "investordashboard.html",
  relationship_manager: "relationshipmanagerdashboard.html",
  admin: "moderatordashboard.html",
});

let signInTransitionStarted = false;

class ApiRequestError extends Error {
  constructor(message, { status = null, isNetworkError = false } = {}) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.isNetworkError = isNetworkError;
  }
}

function dashboardForRole(role) {
  return ROLE_DASHBOARDS[role] || "index.html";
}

function getToken() {
  return localStorage.getItem("lumilabsToken");
}

function clearSession() {
  localStorage.removeItem("lumilabsToken");
  localStorage.removeItem("lumilabsUser");
  localStorage.removeItem("lumilabsSelectedUser");
}

function redirectToSignIn() {
  if (signInTransitionStarted) return;
  signInTransitionStarted = true;
  clearSession();
  window.location.href = "signin.html";
}

function signOut() {
  redirectToSignIn();
}

function showPageRecovery(message) {
  let notice = document.getElementById("protected-page-recovery");
  if (!notice) {
    notice = document.createElement("section");
    notice.id = "protected-page-recovery";
    notice.setAttribute("role", "alert");
    notice.setAttribute("aria-live", "assertive");
    notice.className = "empty-state";
    notice.innerHTML = `
      <h2>Page temporarily unavailable</h2>
      <p></p>
      <button class="btn btn-primary" type="button">Retry</button>`;
    notice.querySelector("button").addEventListener("click", () => window.location.reload());
    (document.querySelector("main") || document.body).replaceChildren(notice);
  }
  notice.querySelector("p").textContent = message;
}

async function apiFetch(path, options = {}) {
  const token = getToken();
  const isFormData = options.body instanceof FormData;
  let response;
  try {
    response = await fetch(`${SHARED_API_BASE}${path}`, {
      ...options,
      headers: {
        ...(isFormData ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {}),
      },
    });
  } catch (_error) {
    throw new ApiRequestError("Unable to reach Lumi5 Labs. Check your connection and retry.", {
      isNetworkError: true,
    });
  }

  let data = null;
  try {
    data = await response.json();
  } catch (_error) {
    // Retain the status-based fallback for empty or non-JSON responses.
  }

  if (!response.ok) {
    const error = new ApiRequestError(
      data?.error || data?.errors?.[0]?.msg || `Request failed (${response.status})`,
      { status: response.status },
    );
    if (response.status === 401) redirectToSignIn();
    throw error;
  }
  return data;
}

async function requirePageRole(requiredRole) {
  try {
    const user = await API.getCurrentUser();
    if (user.role !== requiredRole) {
      window.location.href = dashboardForRole(user.role);
      return null;
    }
    return user;
  } catch (error) {
    if (error.status === 401) return null;
    showPageRecovery(
      error.isNetworkError
        ? "We could not verify your access because the network is unavailable."
        : "We could not verify your access right now. Your session has been preserved.",
    );
    return null;
  }
}
```

Also replace both 401 branches in `downloadDocument()` with `redirectToSignIn()` so every protected 401 uses the same one-time transition.

- [ ] **Step 4: Run the focused and syntax tests**

Run:

```bash
node --test backend/test/api-client.test.js backend/test/frontend-flow-contract.test.js
```

Expected: all tests pass, including browser JavaScript syntax checking.

- [ ] **Step 5: Commit the shared boundary**

Run:

```bash
git add js/api.js backend/test/api-client.test.js
git diff --cached --check
git commit -m "fix: preserve protected sessions through transient failures"
```

Expected: one commit containing only the shared frontend client and its tests.

---
### Task 2: Shared Messaging Client and Unavailable-Room State

**Files:**
- Modify: `messages.html:593,658-660`
- Modify: `js/messages.js:1,17-76,106-155,180-196,261-265,340-415,489-510,539-572,626-656`
- Modify: `backend/test/messages-client.test.js`
- Modify: `backend/test/managed-messages-client.test.js`

**Interfaces:**
- Consumes: Task 1 globals `apiFetch(path, options)`, `signOut()`, and structured errors with `status` and `isNetworkError`.
- Produces: `loadMessagesWorkspace()`, `selectInitialConversation()`, `refreshMessages()`, and `showConversationUnavailable()`.
- Preserves: `selectConversation()`, `selectionIsCurrent()`, `reloadActiveConversationFromDatabase()`, send persistence, read cursors, sender alignment, and conversation-ID-only navigation.

- [ ] **Step 1: Write the failing messaging state tests**

In `backend/test/messages-client.test.js`, remove the local-client `originalApiFetch` test, remove `state.token = 'signed-test-token'`, add `apiFetch: async () => { throw new Error('request hook missing'); }` and `signOut() {}` to the VM sandbox before evaluating `js/messages.js`, and expand the fake elements used by the harness:

```js
Object.assign(els, {
  modeLabel: { textContent: '' },
  unreadCount: { textContent: '' },
  navMsgBadge: { textContent: '', style: {} },
  conversationList: { innerHTML: '' },
  threadAvatar: { textContent: '' },
  threadTitle: { textContent: '' },
  threadSubtitle: { textContent: '' },
  threadParticipants: { innerHTML: '' },
  threadStatus: { textContent: '' },
  messageInput: { value: 'Hello group', disabled: false },
  sendBtn: { disabled: false, innerHTML: '' },
  messageList: { innerHTML: '', scrollTop: 0, scrollHeight: 0 },
  archiveNotice: { hidden: true, textContent: '', className: '' }
});
apiFetch = async (path, options) => {
  testHooks.requests.push({ path, options });
  return testHooks.request(path, options);
};
```

Add these executable cases to `backend/test/messages-client.test.js`:

```js
test('an unavailable explicit starter ID never selects the first room', async () => {
  const client = clientHarness();
  client.run("window.location.search = '?conversationId=999'");
  client.run('state.activeConversationId = null; state.activeThread = null');
  client.run('renderConversations()');
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
    client.run(`window.location.search = ${JSON.stringify(search)}`);
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
  client.run('state.user = null; window.location.href = "messages.html"');
  client.hooks.request = async (requestPath) => {
    assert.equal(requestPath, '/messages/me');
    throw Object.assign(new Error('service unavailable'), { status: 500, isNetworkError: false });
  };
  assert.equal(await client.run('loadMessagesWorkspace()'), false);
  assert.equal(client.run('window.location.href'), 'messages.html');
  assert.match(client.run('els.conversationList.innerHTML'), /Messages unavailable/);
  assert.match(client.run('els.conversationList.innerHTML'), /data-retry-messages/);
  assert.equal(client.run('els.messageInput.disabled'), true);
});

test('workspace retry is data-only and never binds handlers twice', async () => {
  const client = clientHarness();
  client.run(`
    testHooks.cacheCalls = 0;
    testHooks.bindCalls = 0;
    cacheElements = () => { testHooks.cacheCalls += 1; };
    bindEvents = () => { testHooks.bindCalls += 1; };
    loadMessagesWorkspace = async () => false;
  `);
  await client.run('initMessages()');
  await client.run('loadMessagesWorkspace()');
  assert.equal(client.hooks.cacheCalls, 1);
  assert.equal(client.hooks.bindCalls, 1);
});
```

In `backend/test/managed-messages-client.test.js`, add a source/integration contract:

```js
test('messages page loads one shared API client before the message client', () => {
  const apiIndex = html.indexOf('<script src="js/api.js"></script>');
  const messagesIndex = html.indexOf('<script src="js/messages.js"></script>');
  assert.ok(apiIndex >= 0 && messagesIndex > apiIndex);
  assert.doesNotMatch(source, /const API_BASE|async function apiFetch|function getAuthToken|function clearMessageSession/);
  assert.match(html, /onclick="signOut\(\)"/);

  const apiSource = fs.readFileSync(path.join(root, 'js', 'api.js'), 'utf8');
  const sandbox = {
    window: { LUMILABS_API_BASE: undefined, location: { search: '', href: '' } },
    document: { addEventListener() {}, getElementById() { return null; }, querySelector() { return null; } },
    localStorage: { getItem() { return null; }, removeItem() {} },
    FormData: class FormData {},
    fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
    console, setTimeout, clearTimeout, URLSearchParams, encodeURIComponent, Intl, Date,
  };
  const context = vm.createContext(sandbox);
  assert.doesNotThrow(() => vm.runInContext(apiSource, context));
  assert.doesNotThrow(() => vm.runInContext(source, context));
});
```

- [ ] **Step 2: Run the focused tests and observe the expected failures**

Run:

```bash
node --test backend/test/messages-client.test.js backend/test/managed-messages-client.test.js
```

Expected: FAIL because the page does not load `js/api.js`, the message client still duplicates the request/session boundary, explicit missing IDs fall back, refresh removal retains stale state, and the new helpers do not exist.

- [ ] **Step 3: Load the shared API client and shared sign-out**

At the bottom of `messages.html`, use this exact order and change the sign-out button handler:

```html
<button class="role-option" id="messages-signout" type="button" onclick="signOut()" role="menuitem">
  <span class="role-option-avatar" style="background:#EF4444;"><i class="ti ti-logout"></i></span>
  <span class="role-option-name">Sign out</span>
</button>

<script src="js/api.js"></script>
<script src="js/messages.js"></script>
```

- [ ] **Step 4: Replace duplicate messaging bootstrap/request state**

Delete the message-local `API_BASE`, `state.token`, `apiFetch`, `getAuthToken`, `clearMessageSession`, and `signOutMessages`. Replace `initMessages()` and its workspace loading with:

```js
async function initMessages() {
  cacheElements();
  bindEvents();
  await loadMessagesWorkspace();
}

async function loadMessagesWorkspace() {
  try {
    const user = await apiFetch('/messages/me');
    state.user = {
      id: String(user.id),
      name: user.name || 'Lumi5 Labs user',
      role: user.role,
      roleLabel: roleLabel(user.role),
    };
    renderUser();

    const loaded = await loadConversations();
    if (!loaded) {
      renderLoadError('Messages are temporarily unavailable.');
      return false;
    }
    renderConversations();
    await selectInitialConversation();
    return true;
  } catch (error) {
    console.error(error);
    if (error.status !== 401) {
      renderLoadError('Messages are temporarily unavailable.');
    }
    return false;
  }
}
```

Replace `renderLoadError()` with a retryable, session-preserving state:

```js
function renderLoadError(message) {
  state.selectionVersion += 1;
  state.activeConversationId = null;
  state.activeThread = null;
  setComposeEnabled(false);
  hideArchiveNotice();
  els.modeLabel.textContent = message;
  els.unreadCount.textContent = '0';
  updateUnreadIndicators(0);
  els.conversationList.innerHTML = `
    <div class="empty-state">
      <i class="ti ti-alert-circle"></i>
      <div class="empty-title">Messages unavailable</div>
      <div>Your session is still active. Retry when the service is available.</div>
      <button class="btn" type="button" data-retry-messages>Retry</button>
    </div>`;
  renderEmptyThread();
}
```

- [ ] **Step 5: Implement initial selection, refresh, and unavailable invalidation**

Add these functions and route the top Refresh button plus `[data-retry-messages]` through `refreshMessages()` or `loadMessagesWorkspace()` without rebinding events:

```js
async function selectInitialConversation() {
  const requestedId = getStarterConversationId();
  if (requestedId) {
    const requested = state.conversations.find(({ id }) => sameId(id, requestedId));
    if (!requested) {
      showConversationUnavailable();
      return false;
    }
    return selectConversation(requested.id);
  }
  if (state.conversations[0]) return selectConversation(state.conversations[0].id);
  renderEmptyThread();
  return false;
}

async function refreshMessages() {
  if (!state.user) return loadMessagesWorkspace();
  const previousId = state.activeConversationId;
  try {
    const loaded = await loadConversations();
    if (!loaded) {
      renderLoadError('Messages are temporarily unavailable.');
      return false;
    }
    renderConversations();
    if (previousId) {
      const stillAccessible = state.conversations.some(({ id }) => sameId(id, previousId));
      if (!stillAccessible) {
        showConversationUnavailable();
        return false;
      }
      await selectConversation(previousId);
    } else {
      await selectInitialConversation();
    }
    showToast('Conversations refreshed');
    return true;
  } catch (error) {
    if (error.status !== 401) renderLoadError('Messages are temporarily unavailable.');
    return false;
  }
}

function showConversationUnavailable() {
  state.selectionVersion += 1;
  state.activeConversationId = null;
  state.activeThread = null;
  hideArchiveNotice();
  setComposeEnabled(false);
  renderActiveHeader();
  els.threadTitle.textContent = 'Conversation unavailable';
  els.threadSubtitle.textContent = 'This room is no longer available to your account.';
  els.threadStatus.textContent = 'Unavailable';
  renderThreadError();
}
```

Use this exact delegated retry branch before the conversation-item branch in the inbox click handler:

```js
const retry = event.target.closest('[data-retry-messages]');
if (retry) {
  await loadMessagesWorkspace();
  return;
}
```

Replace the Refresh button's inline async callback body with `await refreshMessages()`.

- [ ] **Step 6: Make summary disappearance fail closed in every path**

Change `selectConversation()` so a missing summary calls `showConversationUnavailable()` before returning. Replace `syncActiveConversationSummary()` with:

```js
function syncActiveConversationSummary() {
  if (!state.activeThread) return false;
  const summary = state.conversations.find(({ id }) => sameId(id, state.activeConversationId));
  if (!summary) {
    showConversationUnavailable();
    return false;
  }
  state.activeThread.conversation = {
    ...summary,
    ...state.activeThread.conversation,
    participants: state.activeThread.participants,
  };
  return true;
}
```

In both `selectConversation()` and `reloadActiveConversationFromDatabase()`, after an inbox refresh, stop immediately when `syncActiveConversationSummary()` returns false. Keep every existing `selectionIsCurrent()` check before and after awaits so a response that began before invalidation cannot render.

- [ ] **Step 7: Run focused messaging tests**

Run:

```bash
node --test \
  backend/test/api-client.test.js \
  backend/test/messages-client.test.js \
  backend/test/managed-messages-client.test.js \
  backend/test/messages-layout.test.js
```

Expected: all tests pass; send persistence/composer reuse, read cursors, sender alignment, layout, unavailable selection, and stale-response invalidation remain green.

- [ ] **Step 8: Commit the messaging repair**

Run:

```bash
git add messages.html js/messages.js \
  backend/test/messages-client.test.js \
  backend/test/managed-messages-client.test.js
git diff --cached --check
git commit -m "fix: invalidate unavailable message rooms"
```

Expected: one messaging-only production/test commit.

---

### Task 3: Preserve Zero-Valued Portfolio Metrics

**Files:**
- Create: `backend/test/createportfolio-client.test.js`
- Modify: `js/createportfolio.js:93-169,172-220`

**Interfaces:**
- Consumes: the existing portfolio form IDs and unchanged `API.createPortfolio()` / `API.updatePortfolio()` payload shape.
- Produces: `inputValue(value)`, `parseIntegerOrNull(value)`, `parseDecimalOrNull(value)`, `populatePortfolioForm(portfolio)`, and `buildPortfolioPayload()`.

- [ ] **Step 1: Write the failing zero-value tests**

Create `backend/test/createportfolio-client.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '..', '..', 'js', 'createportfolio.js'),
  'utf8',
);

function editorHarness() {
  const fields = new Map();
  const document = {
    getElementById(id) {
      if (!fields.has(id)) fields.set(id, { value: '', addEventListener() {} });
      return fields.get(id);
    },
    querySelectorAll() { return []; },
  };
  const context = vm.createContext({
    window: { location: { search: '', href: '' } },
    document,
    URLSearchParams,
    requirePageRole: async () => null,
    API: {},
    history: { replaceState() {} },
    alert() {},
    confirm() { return false; },
    console,
    Set,
  });
  vm.runInContext(source, context);
  return { context, fields, run: (code) => vm.runInContext(code, context) };
}

test('edit hydration preserves every numeric zero', () => {
  const editor = editorHarness();
  editor.context.populatePortfolioForm({
    name: 'Zero Labs', sector: 'Fintech', mvp_status: 'beta', description: '',
    funding_goal: 0, team_size: 0, founded_year: 0, monthly_revenue: 0,
    user_count: 0, growth_rate: 0, burn_rate: 0, runway_months: 0,
  });
  for (const id of [
    'f-funding_goal', 'f-team_size', 'f-founded_year', 'f-monthly_revenue',
    'f-user_count', 'f-growth_rate', 'f-burn_rate', 'f-runway_months',
  ]) assert.equal(editor.fields.get(id).value, '0', id);
});

test('payload serialization preserves integer and decimal zeroes', () => {
  const editor = editorHarness();
  const values = {
    'f-name': 'Zero Labs', 'f-sector': 'Fintech', 'f-mvp_status': 'beta',
    'f-funding_goal': '0', 'f-description': '', 'f-team_size': '0',
    'f-founded_year': '2000', 'f-location': '', 'f-website': '',
    'f-advisor_names': '', 'f-monthly_revenue': '0', 'f-user_count': '0',
    'f-growth_rate': '0', 'f-market_size': '', 'f-competitor_analysis': '',
    'f-burn_rate': '0', 'f-runway_months': '0',
  };
  for (const [id, value] of Object.entries(values)) editor.fields.set(id, { value });
  const payload = editor.run('buildPortfolioPayload()');
  for (const key of [
    'funding_goal', 'team_size', 'monthly_revenue', 'user_count',
    'growth_rate', 'burn_rate', 'runway_months',
  ]) assert.equal(payload[key], 0, key);
  assert.equal(payload.founded_year, 2000);
});

test('optional numeric parsers distinguish blank and invalid input from zero', () => {
  const editor = editorHarness();
  assert.equal(editor.run("parseIntegerOrNull('0')"), 0);
  assert.equal(editor.run("parseDecimalOrNull('0.00')"), 0);
  assert.equal(editor.run("parseIntegerOrNull('')"), null);
  assert.equal(editor.run("parseDecimalOrNull('not-a-number')"), null);
});
```

- [ ] **Step 2: Run the focused test and observe the expected failure**

Run:

```bash
node --test backend/test/createportfolio-client.test.js
```

Expected: FAIL because `populatePortfolioForm()`, `buildPortfolioPayload()`, and the new parsers do not exist.

- [ ] **Step 3: Add null-aware hydration and parsing helpers**

Add these helpers above `init()` in `js/createportfolio.js`:

```js
function inputValue(value) {
  return value === null || value === undefined ? "" : String(value);
}

function parseIntegerOrNull(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const number = Number.parseInt(text, 10);
  return Number.isFinite(number) ? number : null;
}

function parseDecimalOrNull(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function populatePortfolioForm(portfolio) {
  const values = {
    "f-name": portfolio.name,
    "f-sector": portfolio.sector,
    "f-mvp_status": portfolio.mvp_status,
    "f-funding_goal": portfolio.funding_goal,
    "f-description": portfolio.description,
    "f-team_size": portfolio.team_size,
    "f-founded_year": portfolio.founded_year,
    "f-location": portfolio.location,
    "f-website": portfolio.website,
    "f-advisor_names": portfolio.advisor_names,
    "f-monthly_revenue": portfolio.monthly_revenue,
    "f-user_count": portfolio.user_count,
    "f-growth_rate": portfolio.growth_rate,
    "f-market_size": portfolio.market_size,
    "f-competitor_analysis": portfolio.competitor_analysis,
    "f-burn_rate": portfolio.burn_rate,
    "f-runway_months": portfolio.runway_months,
  };
  for (const [id, value] of Object.entries(values)) {
    document.getElementById(id).value = inputValue(value);
  }
}

function buildPortfolioPayload() {
  return {
    name: document.getElementById("f-name").value.trim(),
    sector: document.getElementById("f-sector").value.trim(),
    mvp_status: document.getElementById("f-mvp_status").value.trim(),
    funding_goal: parseDecimalOrNull(document.getElementById("f-funding_goal").value),
    description: document.getElementById("f-description").value.trim(),
    team_size: parseIntegerOrNull(document.getElementById("f-team_size").value),
    founded_year: parseIntegerOrNull(document.getElementById("f-founded_year").value),
    location: document.getElementById("f-location").value.trim(),
    website: document.getElementById("f-website").value.trim(),
    advisor_names: document.getElementById("f-advisor_names").value.trim(),
    monthly_revenue: parseDecimalOrNull(document.getElementById("f-monthly_revenue").value),
    user_count: parseIntegerOrNull(document.getElementById("f-user_count").value),
    growth_rate: parseDecimalOrNull(document.getElementById("f-growth_rate").value),
    market_size: document.getElementById("f-market_size").value.trim(),
    competitor_analysis: document.getElementById("f-competitor_analysis").value.trim(),
    burn_rate: parseDecimalOrNull(document.getElementById("f-burn_rate").value),
    runway_months: parseIntegerOrNull(document.getElementById("f-runway_months").value),
  };
}
```

- [ ] **Step 4: Route edit and submit flows through the helpers**

Replace the individual `p.field || ""` assignments in edit mode with `populatePortfolioForm(p)`. Remove `parseIntOrNull()` and use `parseIntegerOrNull()`.

At the start of `submitForm()` validation, build the payload once and validate it explicitly:

```js
const payload = buildPortfolioPayload();
const { name, sector, mvp_status, funding_goal, team_size, founded_year } = payload;

if (!name || !sector || !mvp_status || document.getElementById("f-funding_goal").value.trim() === "") {
  alert("Please fill in all required fields (Company Name, Industry, MVP Status, Funding Goal).");
  return;
}
if (funding_goal === null || funding_goal < 0) {
  alert("Funding Goal must be zero or greater.");
  return;
}
if (team_size !== null && team_size < 0) {
  alert("Team Size can't be negative.");
  return;
}
if (founded_year !== null && (founded_year < 1900 || founded_year > 2100)) {
  alert("Founded Year must be between 1900 and 2100.");
  return;
}
```

Delete the old inline payload object so `API.createPortfolio(payload)` and `API.updatePortfolio(editId, payload)` receive the helper result unchanged.

- [ ] **Step 5: Run focused portfolio tests**

Run:

```bash
node --test backend/test/createportfolio-client.test.js backend/test/portfolio-state.test.js
```

Expected: all tests pass and every numeric zero remains `0` through hydration and payload construction.

- [ ] **Step 6: Commit the numeric fix**

Run:

```bash
git add js/createportfolio.js backend/test/createportfolio-client.test.js
git diff --cached --check
git commit -m "fix: preserve zero portfolio metrics"
```

Expected: one portfolio-client-only production/test commit.

---

### Task 4: Authoritative Browse Interest Reconciliation

**Files:**
- Modify: `browse.html:137-143`
- Modify: `js/browse.js:29-32,62-142,155-196`
- Create: `backend/test/browse-client.test.js`

**Interfaces:**
- Consumes: unchanged `API.expressInterest()`, `API.removeInterest()`, `API.getAllPortfolios()`, and `API.getMyInterests()`.
- Produces: `fetchBrowseSnapshot()`, `commitBrowseSnapshot(snapshot)`, `retryInterestRefresh()`, `setBrowseStatus(message, type, retryable)`, and state flags `interestMutationInFlight` / `interestDataStale`.
- Guarantees: both authoritative reads commit together; while a mutation/read sequence is in flight or stale, every interest toggle is disabled.

- [ ] **Step 1: Add the accessible status target**

In `browse.html`, add this sibling immediately after `#results-count` inside `.results-row`:

```html
<div id="browse-status" role="status" aria-live="polite" hidden></div>
```

Add these page-local rules beside the existing `.results-row` styles:

```css
#browse-status { color: var(--text-secondary); font-size: 13px; }
#browse-status.warning { color: #9A6700; }
#browse-status.error { color: #B42318; }
#browse-status button { margin-left: 8px; }
```

- [ ] **Step 2: Write the failing browse reconciliation tests**

Create `backend/test/browse-client.test.js` using a VM sandbox whose auto-started `requirePageRole()` returns `null`, then add these cases:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'browse.js'), 'utf8');

function browseHarness() {
  const hooks = { calls: [], statuses: [], renders: 0 };
  const context = vm.createContext({
    window: { location: { href: '' } },
    document: { getElementById() { return { addEventListener() {} }; }, addEventListener() {} },
    requirePageRole: async () => null,
    API: {},
    alert() {},
    console,
    Set,
    hooks,
  });
  vm.runInContext(source, context);
  vm.runInContext(`
    applyFilters = () => { hooks.renders += 1; };
    setBrowseStatus = (message, type, retryable) => hooks.statuses.push({ message, type, retryable });
  `, context);
  return { context, hooks, run: (code) => vm.runInContext(code, context) };
}

test('successful interest mutation commits the two refetched sources together', async () => {
  const client = browseHarness();
  client.run(`
    allPortfolios = [{ id: 1, interest_count: 4, chat_state: 'awaiting_manager' }];
    interestedIds = new Set();
    API.expressInterest = async (id) => { hooks.calls.push(['express', id]); };
    API.getAllPortfolios = async () => {
      hooks.calls.push(['portfolios']);
      return [{ id: 1, interest_count: 9, chat_state: 'open', conversation_id: 44 }];
    };
    API.getMyInterests = async () => { hooks.calls.push(['interests']); return [{ id: 1 }]; };
  `);
  await client.run('toggleInterest(1)');
  assert.deepEqual(client.hooks.calls, [['express', 1], ['portfolios'], ['interests']]);
  assert.equal(client.run('allPortfolios[0].interest_count'), 9);
  assert.equal(client.run('allPortfolios[0].chat_state'), 'open');
  assert.equal(client.run('interestedIds.has(1)'), true);
});

test('one failed authoritative read commits neither source and Retry never resends mutation', async () => {
  const client = browseHarness();
  client.run(`
    allPortfolios = [{ id: 1, interest_count: 4 }];
    interestedIds = new Set();
    API.expressInterest = async () => { hooks.calls.push(['express']); };
    API.getAllPortfolios = async () => [{ id: 1, interest_count: 5 }];
    API.getMyInterests = async () => { throw new Error('read failed'); };
  `);
  await client.run('toggleInterest(1)');
  assert.equal(client.run('allPortfolios[0].interest_count'), 4);
  assert.equal(client.run('interestedIds.has(1)'), false);
  assert.equal(client.run('interestDataStale'), true);
  assert.match(client.hooks.statuses.at(-1).message, /saved.*refresh/i);
  assert.equal(client.hooks.statuses.at(-1).retryable, true);
  client.run(`
    API.getAllPortfolios = async () => [{ id: 1, interest_count: 5 }];
    API.getMyInterests = async () => [{ id: 1 }];
  `);
  await client.run('retryInterestRefresh()');
  assert.equal(client.hooks.calls.filter(([name]) => name === 'express').length, 1);
  assert.equal(client.run('allPortfolios[0].interest_count'), 5);
  assert.equal(client.run('interestedIds.has(1)'), true);
  assert.equal(client.run('interestDataStale'), false);
});

test('overlapping card toggles are ignored while one reconciliation is pending', async () => {
  const client = browseHarness();
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  client.context.pending = pending;
  client.run(`
    allPortfolios = [{ id: 1 }, { id: 2 }];
    interestedIds = new Set();
    API.expressInterest = async (id) => { hooks.calls.push(['express', id]); await pending; };
    API.getAllPortfolios = async () => allPortfolios;
    API.getMyInterests = async () => [];
  `);
  const first = client.run('toggleInterest(1)');
  await client.run('toggleInterest(2)');
  release();
  await first;
  assert.deepEqual(client.hooks.calls, [['express', 1]]);
});
```

- [ ] **Step 3: Run the focused test and observe the expected failure**

Run:

```bash
node --test backend/test/browse-client.test.js
```

Expected: FAIL because current code locally patches IDs/chat state, never refetches both sources, and has no global stale/overlap lock.

- [ ] **Step 4: Implement atomic read snapshots and status rendering**

Add this state and these helpers in `js/browse.js`:

```js
let interestMutationInFlight = false;
let interestDataStale = false;

async function fetchBrowseSnapshot() {
  const [portfolios, interests] = await Promise.all([
    API.getAllPortfolios(),
    API.getMyInterests(),
  ]);
  return {
    portfolios,
    interestedIds: new Set(interests.map(({ id }) => Number(id))),
  };
}

function commitBrowseSnapshot(snapshot) {
  allPortfolios = snapshot.portfolios;
  interestedIds = snapshot.interestedIds;
}

function setBrowseStatus(message = "", type = "", retryable = false) {
  const status = document.getElementById("browse-status");
  status.hidden = !message;
  status.className = type;
  status.innerHTML = message
    ? `<span>${escapeHtml(message)}</span>${retryable ? '<button class="btn-filter" type="button" data-retry-interest-refresh>Retry</button>' : ''}`
    : "";
}

async function retryInterestRefresh() {
  if (interestMutationInFlight) return false;
  interestMutationInFlight = true;
  applyFilters();
  try {
    const snapshot = await fetchBrowseSnapshot();
    commitBrowseSnapshot(snapshot);
    interestDataStale = false;
    setBrowseStatus();
    return true;
  } catch (error) {
    interestDataStale = true;
    setBrowseStatus(`Could not refresh interest data: ${error.message}`, "error", true);
    return false;
  } finally {
    interestMutationInFlight = false;
    applyFilters();
  }
}
```

In `renderGrid()`, derive and apply the disabled attribute to every interest button:

```js
const interestDisabled = interestMutationInFlight || interestDataStale ? " disabled" : "";
```

```html
<button class="btn-interest ${liked ? "interested" : ""}" id="btn-interest-${p.id}"
        onclick="toggleInterest(${p.id})"${interestDisabled}>
  <i class="ti ${liked ? "ti-heart-filled" : "ti-heart"}"></i>
  ${liked ? "Interested" : "Express Interest"}
</button>
```

- [ ] **Step 5: Replace local interest patching with serialized reconciliation**

Replace `toggleInterest()` with:

```js
async function toggleInterest(portfolioId) {
  if (interestMutationInFlight || interestDataStale) return;
  interestMutationInFlight = true;
  applyFilters();
  let mutationSaved = false;
  try {
    if (interestedIds.has(portfolioId)) await API.removeInterest(portfolioId);
    else await API.expressInterest(portfolioId);
    mutationSaved = true;

    const snapshot = await fetchBrowseSnapshot();
    commitBrowseSnapshot(snapshot);
    interestDataStale = false;
    setBrowseStatus();
  } catch (error) {
    if (mutationSaved) {
      interestDataStale = true;
      setBrowseStatus(
        `Your change was saved, but the latest data could not refresh: ${error.message}`,
        "warning",
        true,
      );
    } else {
      setBrowseStatus(`Could not update interest: ${error.message}`, "error");
    }
  } finally {
    interestMutationInFlight = false;
    applyFilters();
  }
}
```

Bind one click listener to `#browse-status` during `init()`:

```js
document.getElementById("browse-status").addEventListener("click", (event) => {
  if (event.target.closest("[data-retry-interest-refresh]")) retryInterestRefresh();
});
```

Do not mutate `interestedIds`, `interest_count`, `conversation_id`, `conversation_status`, or `chat_state` locally after POST/DELETE.

- [ ] **Step 6: Run focused browse tests**

Run:

```bash
node --test backend/test/browse-client.test.js backend/test/frontend-flow-contract.test.js
```

Expected: all tests pass; a successful mutation uses refetched count/chat state, a partial read failure commits neither source, Retry performs reads only, and overlapping card actions cannot race.

- [ ] **Step 7: Commit the browse-state repair**

Run:

```bash
git add browse.html js/browse.js backend/test/browse-client.test.js
git diff --cached --check
git commit -m "fix: reconcile investor interest state"
```

Expected: one browse-client production/test commit.

---

### Task 5: Recoverable Investor Dashboard and My Interests

**Files:**
- Modify: `js/investordashboard.js:29-183`
- Modify: `js/my-interests.js:34-123`
- Create: `backend/test/investor-pages-client.test.js`

**Interfaces:**
- Consumes: unchanged investor dashboard, recommendation, and interests API methods.
- Produces in `js/investordashboard.js`: `renderDashboardResult(result)`, `renderRecommendationResult(result)`, `renderQuickActions(interestCount)`, and `loadInvestorDashboard()`.
- Produces in `js/my-interests.js`: guarded `loadInterests()`, `renderInterestsError(error)`, and one-time `bindInterestEvents()`.

- [ ] **Step 1: Write the failing investor-page recovery tests**

Create `backend/test/investor-pages-client.test.js` with a reusable generic element map and two VM loaders:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..', '..');

function elementMap() {
  const elements = new Map();
  return {
    elements,
    document: {
      getElementById(id) {
        if (!elements.has(id)) {
          elements.set(id, {
            innerHTML: '', innerText: '', textContent: '', disabled: false,
            addEventListener(_name, handler) { this.handler = handler; },
            classList: { add() {}, remove() {}, toggle() { return false; } },
            setAttribute() {},
          });
        }
        return elements.get(id);
      },
      addEventListener() {},
    },
  };
}

function loadClient(file) {
  const dom = elementMap();
  const hooks = { menuCalls: 0 };
  const context = vm.createContext({
    window: { location: { href: '' } },
    document: dom.document,
    requirePageRole: async () => null,
    API: {},
    console,
    alert() {},
    setTimeout,
    clearTimeout,
    hooks,
    Date,
    Intl,
  });
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
  return { context, hooks, elements: dom.elements, run: (code) => vm.runInContext(code, context) };
}

test('dashboard failure still renders recommendations and quick navigation without a false zero', async () => {
  const client = loadClient('js/investordashboard.js');
  client.run(`
    API.getInvestorDashboard = async () => { throw new Error('dashboard down'); };
    API.getRecommendations = async () => [{
      id: 1, name: 'Solar Stack', sector: 'Clean Energy', ai_score: 88,
      readiness_score: 80, funding_goal: 500000, created_at: '2026-07-23T00:00:00Z'
    }];
  `);
  await client.run('loadInvestorDashboard()');
  assert.match(client.elements.get('recommended-list').innerHTML, /Solar Stack/);
  assert.match(client.elements.get('quick-actions-list').innerHTML, /Browse Startups/);
  assert.match(client.elements.get('quick-actions-list').innerHTML, /My Interests/);
  assert.doesNotMatch(client.elements.get('quick-actions-list').innerHTML, /badge-red[^>]*>0</);
  assert.match(client.elements.get('recent-interests-list').innerHTML, /Retry/);
  assert.equal(client.elements.get('stat-interests').innerText, '—');
});

test('recommendation failure preserves dashboard data and uses its real interest count', async () => {
  const client = loadClient('js/investordashboard.js');
  client.run(`
    API.getInvestorDashboard = async () => ({
      stats: { available: 7, interests: 3, messages: 2, highPotential: 4 },
      recentInterests: [{ id: 1, name: 'Solar Stack', sector: 'Clean Energy' }]
    });
    API.getRecommendations = async () => { throw new Error('recommendations down'); };
  `);
  await client.run('loadInvestorDashboard()');
  assert.equal(client.elements.get('stat-interests').innerText, 3);
  assert.match(client.elements.get('recent-interests-list').innerHTML, /Solar Stack/);
  assert.match(client.elements.get('recommended-list').innerHTML, /Retry/);
  assert.match(client.elements.get('recently-added-grid').innerHTML, /Retry/);
  assert.match(client.elements.get('quick-actions-list').innerHTML, /badge-red[^>]*>3</);
});

test('My Interests binds its menu and retry before a failed data load', async () => {
  const client = loadClient('js/my-interests.js');
  client.run(`
    requirePageRole = async () => ({ id: 6, name: 'Investor', role: 'investor' });
    initRoleMenu = () => { hooks.menuCalls += 1; };
    API.getMyInterests = async () => { throw new Error('<temporary>'); };
  `);
  await client.run('init()');
  assert.equal(client.hooks.menuCalls, 1);
  assert.match(client.elements.get('interests-list').innerHTML, /Retry/);
  assert.match(client.elements.get('interests-list').innerHTML, /&lt;temporary&gt;/);
});

test('My Interests Retry performs one guarded read and replaces the error', async () => {
  const client = loadClient('js/my-interests.js');
  client.run(`
    testCalls = 0;
    API.getMyInterests = async () => {
      testCalls += 1;
      if (testCalls === 1) throw new Error('temporary');
      return [{ id: 1, name: 'Solar Stack', sector: 'Clean Energy', owner_name: 'Charlie', readiness_score: 80 }];
    };
  `);
  await client.run('loadInterests()');
  await client.run('loadInterests()');
  assert.equal(client.run('testCalls'), 2);
  assert.match(client.elements.get('interests-list').innerHTML, /Solar Stack/);
  assert.equal(client.elements.get('count-badge').innerText, 1);
});
```

- [ ] **Step 2: Run the focused tests and observe the expected failures**

Run:

```bash
node --test backend/test/investor-pages-client.test.js
```

Expected: FAIL because the page-level loaders/renderers do not exist, dashboard failures leave blanks, quick actions depend on recommendations, unknown interests become zero, and My Interests returns before menu/retry binding.

- [ ] **Step 3: Separate investor-dashboard rendering and keep quick actions independent**

Add these helpers to `js/investordashboard.js` and move the current escaped fulfilled rendering into the matching branches:

```js
function retrySection(message) {
  return `<div class="empty-state" role="alert">
    <i class="ti ti-alert-circle"></i>
    <p>${escapeHtml(message)}</p>
    <button class="btn-refresh" type="button" onclick="refreshInvestorDashboard()">Retry</button>
  </div>`;
}

function renderQuickActions(interestCount = null) {
  const badge = Number.isFinite(Number(interestCount)) && Number(interestCount) > 0
    ? `<span class="badge-red">${Number(interestCount)}</span>`
    : "";
  document.getElementById("quick-actions-list").innerHTML = `
    <button class="quick-action-btn" onclick="window.location.href='browse.html'">
      <div class="qa-left"><i class="ti ti-search"></i> Browse Startups</div>
      <i class="ti ti-chevron-right" style="color:var(--text-muted)"></i>
    </button>
    <button class="quick-action-btn" onclick="window.location.href='my-interests.html'">
      <div class="qa-left"><i class="ti ti-heart"></i> My Interests</div>${badge}
    </button>
    <button class="quick-action-btn" onclick="window.location.href='messages.html'">
      <div class="qa-left"><i class="ti ti-message"></i> Messages</div>
    </button>`;
}

function renderDashboardResult(result) {
  const statIds = ["stat-available", "stat-interests", "stat-messages", "stat-potential"];
  if (result.status === "rejected") {
    statIds.forEach((id) => { document.getElementById(id).innerText = "—"; });
    document.getElementById("recent-interests-list").innerHTML = retrySection(
      `Couldn't load dashboard data: ${result.reason?.message || "Please retry"}`,
    );
    return null;
  }

  const { stats, recentInterests } = result.value;
  document.getElementById("stat-available").innerText = stats.available;
  document.getElementById("stat-interests").innerText = stats.interests;
  document.getElementById("stat-messages").innerText = stats.messages;
  document.getElementById("stat-potential").innerText = stats.highPotential;
  document.getElementById("recent-interests-list").innerHTML = recentInterests.length
    ? recentInterests.map((interest) => `
      <div class="interest-list-item">
        <div class="il-icon"><i class="ti ti-heart"></i></div>
        <div><div class="il-name">${escapeHtml(interest.name)}</div>
        <div class="il-sub">${escapeHtml(interest.sector)}</div></div>
        ${managedChatAction(interest)}
      </div>`).join("")
    : '<p style="color:var(--text-muted);font-size:13px;padding:8px 0;">No interests yet.</p>';
  return stats.interests;
}

function renderRecommendationResult(result) {
  if (result.status === "rejected") {
    const error = retrySection(
      `Couldn't load recommendations: ${result.reason?.message || "Please retry"}`,
    );
    document.getElementById("recommended-list").innerHTML = error;
    document.getElementById("recently-added-grid").innerHTML = error;
    return;
  }

  const top = result.value.slice(0, 5);
  document.getElementById("recommended-list").innerHTML = top.length
    ? top.map((portfolio, index) => `
      <div class="rec-item" style="cursor:pointer;" onclick="window.location.href='browse.html'">
        <div class="rec-rank">#${index + 1}</div>
        <div class="rec-info"><div class="rec-name-row">
          <span class="rec-name">${escapeHtml(portfolio.name)}</span>
          ${portfolio.is_high_potential ? '<span class="badge-purple"><i class="ti ti-star"></i> High Potential</span>' : ""}
        </div><div class="rec-industry">${escapeHtml(portfolio.sector)}</div></div>
        <div class="score-text">${portfolio.ai_score}</div>
        <i class="ti ti-arrow-right rec-arrow"></i>
      </div>`).join("")
    : '<p style="padding:20px;color:var(--text-muted);">No approved startups yet.</p>';

  const recent = [...result.value]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 4);
  document.getElementById("recently-added-grid").innerHTML = recent.length
    ? recent.map((portfolio) => `
      <div class="recent-card" style="cursor:pointer;" onclick="window.location.href='browse.html'">
        <div class="rc-top">
          <div class="rc-icon"><i class="ti ti-briefcase"></i></div>
          <div class="rc-star" style="background:${portfolio.readiness_score >= 75 ? "var(--purple-light)" : "var(--bg-page)"}; color:${portfolio.readiness_score >= 75 ? "var(--purple-text)" : "var(--text-muted)"}"><i class="ti ti-star"></i></div>
        </div>
        <div><div class="rc-name">${escapeHtml(portfolio.name)}</div>
        <div class="rc-industry">${escapeHtml(portfolio.sector)}</div></div>
        <div class="rc-bottom"><div class="rc-money">${formatFunding(portfolio.funding_goal)}</div>
        <div class="rc-score" style="color:${portfolio.readiness_score >= 70 ? "var(--primary-green)" : "#D98F39"}; background:${portfolio.readiness_score >= 70 ? "rgba(82,164,117,0.1)" : "rgba(217,143,57,0.1)"}">${portfolio.readiness_score}</div></div>
      </div>`).join("")
    : '<p style="color:var(--text-muted);">No startups yet.</p>';
}

async function loadInvestorDashboard() {
  const [dashboard, recommendations] = await Promise.allSettled([
    API.getInvestorDashboard(),
    API.getRecommendations(),
  ]);
  const interestCount = renderDashboardResult(dashboard);
  renderRecommendationResult(recommendations);
  renderQuickActions(interestCount);
}
```

Keep the current escaped names, sectors, funding amounts, scores, managed-chat actions, and visual classes. `init()` must authorize/render the user, bind the role menu once, call `renderQuickActions(null)` immediately, then await `loadInvestorDashboard()`. `refreshInvestorDashboard()` must call only `loadInvestorDashboard()` inside its existing button guard/finally block; it must not call `init()`.

- [ ] **Step 4: Add one-time My Interests binding and guarded retry**

Add this state and these functions to `js/my-interests.js`:

```js
let interestsLoading = false;
let interestEventsBound = false;

function renderInterestsError(error) {
  document.getElementById("interests-list").innerHTML = `
    <div class="empty-state" role="alert">
      <i class="ti ti-alert-circle"></i>
      <h3>Couldn't load interests</h3>
      <p>${escapeHtml(error.message || "Please retry")}</p>
      <button class="btn-browse" type="button" data-retry-interests>Retry</button>
    </div>`;
}

function bindInterestEvents() {
  if (interestEventsBound) return;
  interestEventsBound = true;
  document.getElementById("interests-list").addEventListener("click", (event) => {
    if (event.target.closest("[data-retry-interests]")) loadInterests();
  });
}

async function loadInterests() {
  if (interestsLoading) return false;
  interestsLoading = true;
  try {
    interests = await API.getMyInterests();
    render();
    return true;
  } catch (error) {
    renderInterestsError(error);
    return false;
  } finally {
    interestsLoading = false;
  }
}
```

Replace `init()` with this ordering:

```js
async function init() {
  const user = await requirePageRole("investor");
  if (!user) return;
  document.getElementById("user-avatar").innerText = user.name[0].toUpperCase();
  document.getElementById("user-name").innerText = user.name;
  initRoleMenu();
  bindInterestEvents();
  await loadInterests();
}
```

Retry calls only `loadInterests()` and cannot rebind the role menu or delegated listener.

- [ ] **Step 5: Run focused investor-page tests**

Run:

```bash
node --test backend/test/investor-pages-client.test.js backend/test/frontend-flow-contract.test.js
```

Expected: all tests pass; each dashboard branch has a recoverable state, successful sibling data remains visible, quick navigation always renders, unknown interest count has no badge, and My Interests can retry without losing sign-out/menu behavior.

- [ ] **Step 6: Commit the investor-page recovery**

Run:

```bash
git add js/investordashboard.js js/my-interests.js backend/test/investor-pages-client.test.js
git diff --cached --check
git commit -m "fix: make investor pages recoverable"
```

Expected: one investor-page production/test commit.

---

### Task 6: Truthful Relationship-Manager Reopen and Stale States

**Files:**
- Modify: `js/relationshipmanagerdashboard.js:1-7,33-38,69-214,216-269`
- Modify: `backend/test/relationship-manager-client.test.js`

**Interfaces:**
- Consumes: existing dashboard fields `portfolio_id`, `status`, `archived_reason`, `investors`, and `eligible_interests`.
- Produces: `reopenEligibility(room) -> { enabled, reason }`; `loadDashboard() -> Promise<boolean>`; state flag `stale`.
- Guarantees: at most one mutation/refresh transaction at a time; all mutation controls disabled while pending/stale; Open Group Chat remains available.

- [ ] **Step 1: Write the failing reopen and mutation-state tests**

Extend `backend/test/relationship-manager-client.test.js` with a generic executable harness:

```js
function managerHarness() {
  const elements = new Map();
  const hooks = { statuses: [], renders: 0, refreshes: 0 };
  const document = {
    addEventListener() {},
    querySelectorAll() { return []; },
    getElementById(id) {
      if (!elements.has(id)) {
        elements.set(id, {
          innerHTML: '', textContent: '', className: '', hidden: false,
          addEventListener() {},
        });
      }
      return elements.get(id);
    },
  };
  const context = vm.createContext({
    window: { location: { href: '' } }, document, console, API: {},
    requirePageRole: async () => null, hooks,
  });
  vm.runInContext(readRequired(clientPath, 'relationship manager client'), context);
  vm.runInContext(`
    setStatus = (message, type, retryable) => hooks.statuses.push({ message, type, retryable });
    renderDashboard = () => { hooks.renders += 1; };
  `, context);
  return { context, elements, hooks, run: (code) => vm.runInContext(code, context) };
}

test('reopen eligibility fails closed and allows a newly active investor', () => {
  const client = managerHarness();
  const cases = [
    [{ status: 'archived', portfolio_id: 1, archived_reason: 'manual', investors: [{ id: 2 }], eligible_interests: [] }, true, ''],
    [{ status: 'archived', portfolio_id: 1, archived_reason: 'no_active_investors', investors: [{ id: 2 }], eligible_interests: [] }, true, ''],
    [{ status: 'archived', portfolio_id: null, archived_reason: 'portfolio_deleted', investors: [], eligible_interests: [] }, false, 'permanent'],
    [{ status: 'archived', portfolio_id: 1, archived_reason: 'portfolio_unapproved', investors: [{ id: 2 }], eligible_interests: [] }, false, 'approved'],
    [{ status: 'archived', portfolio_id: 1, archived_reason: 'no_active_investors', investors: [], eligible_interests: [{ id: 7 }] }, false, 'Add an eligible investor'],
    [{ status: 'archived', portfolio_id: 1, archived_reason: 'no_active_investors', investors: [], eligible_interests: [] }, false, 'express interest'],
    [{ status: 'archived', portfolio_id: 1, archived_reason: 'manual' }, false, 'current state'],
  ];
  for (const [room, enabled, reason] of cases) {
    client.context.room = room;
    const result = client.run('reopenEligibility(room)');
    assert.equal(result.enabled, enabled, JSON.stringify(room));
    if (reason) assert.match(result.reason, new RegExp(reason, 'i'));
    else assert.equal(result.reason, '');
  }
});

test('mutation success plus refresh failure is marked stale and blocks another mutation', async () => {
  const client = managerHarness();
  client.run(`
    state.dashboard = { stats: {}, unclaimed_portfolios: [], rooms: [] };
    loadDashboard = async () => { hooks.refreshes += 1; return false; };
    mutationCalls = 0;
  `);
  await client.run(`runMutation('archive:12', async () => { mutationCalls += 1; }, 'wrong success')`);
  assert.equal(client.run('mutationCalls'), 1);
  assert.equal(client.run('state.stale'), true);
  assert.equal(client.hooks.refreshes, 1);
  assert.doesNotMatch(client.hooks.statuses.at(-1).message, /wrong success/);
  assert.match(client.hooks.statuses.at(-1).message, /saved.*refresh/i);
  assert.equal(client.hooks.statuses.at(-1).retryable, true);
  await client.run(`runMutation('archive:13', async () => { mutationCalls += 1; }, 'never')`);
  assert.equal(client.run('mutationCalls'), 1);
});

test('mutation rejection retains coherent state and does not refresh', async () => {
  const client = managerHarness();
  client.run(`
    previousDashboard = { stats: { active_rooms: 1 }, unclaimed_portfolios: [], rooms: [] };
    state.dashboard = previousDashboard;
    loadDashboard = async () => { hooks.refreshes += 1; return true; };
  `);
  await client.run(`runMutation('archive:12', async () => { throw new Error('Not allowed'); }, 'success')`);
  assert.equal(client.run('state.dashboard === previousDashboard'), true);
  assert.equal(client.run('state.stale'), false);
  assert.equal(client.hooks.refreshes, 0);
  assert.equal(client.hooks.statuses.at(-1).message, 'Not allowed');
});

test('successful dashboard Retry atomically replaces data and clears stale', async () => {
  const client = managerHarness();
  client.run(`
    state.stale = true;
    state.dashboard = { stats: { active_rooms: 1 }, unclaimed_portfolios: [], rooms: [] };
    API.getRelationshipManagerDashboard = async () => ({
      stats: { active_rooms: 2 }, unclaimed_portfolios: [], rooms: []
    });
  `);
  assert.equal(await client.run('loadDashboard()'), true);
  assert.equal(client.run('state.dashboard.stats.active_rooms'), 2);
  assert.equal(client.run('state.stale'), false);
});

test('successful mutation installs refreshed data before announcing success', async () => {
  const client = managerHarness();
  client.run(`
    state.dashboard = { stats: { active_rooms: 1 }, unclaimed_portfolios: [], rooms: [] };
    API.getRelationshipManagerDashboard = async () => ({
      stats: { active_rooms: 2 }, unclaimed_portfolios: [], rooms: []
    });
    mutationCalls = 0;
  `);
  await client.run(`runMutation('archive:12', async () => { mutationCalls += 1; }, 'Room archived')`);
  assert.equal(client.run('mutationCalls'), 1);
  assert.equal(client.run('state.dashboard.stats.active_rooms'), 2);
  assert.equal(client.run('state.stale'), false);
  assert.equal(client.run('state.pending.size'), 0);
  assert.equal(client.hooks.statuses.at(-1).message, 'Room archived');
});
```

Also replace the existing source-only “room mutations refresh” assertion with this executable rendered-card case:

```js
test('disabled Reopen explains why while Open Group Chat remains enabled', () => {
  const client = managerHarness();
  client.run(`
    state.dashboard = {
      stats: {}, unclaimed_portfolios: [], rooms: [{
        conversation_id: 12,
        portfolio_id: 1,
        title: 'Solar Stack',
        status: 'archived',
        archived_reason: 'no_active_investors',
        unread_count: 0,
        owner: { id: 3, name: 'Charlie' },
        investors: [],
        eligible_interests: [{ id: 7, investor: { id: 8, name: 'Investor One' } }]
      }]
    };
    renderManagedRooms();
  `);
  const rendered = client.elements.get('managed-room-list').innerHTML;
  assert.match(rendered, /data-action="open"/);
  assert.doesNotMatch(rendered, /data-action="open"[^>]*disabled/);
  assert.match(rendered, /data-action="reopen"[^>]*[\s\S]*disabled/);
  assert.match(rendered, /aria-describedby="reopen-reason-12"/);
  assert.match(rendered, /Add an eligible investor/);
});
```

- [ ] **Step 2: Run the focused test and observe the expected failures**

Run:

```bash
node --test backend/test/relationship-manager-client.test.js
```

Expected: FAIL because every archived room currently offers Reopen, `loadDashboard()` returns no result, refresh failures are swallowed, and there is no stale/global mutation lock.

- [ ] **Step 3: Add reopen eligibility and stale state**

Add `stale: false` to `state` and add this pure helper before `renderManagedRooms()`:

```js
function reopenEligibility(room) {
  if (room.status !== "archived") {
    return { enabled: false, reason: "This room is not archived." };
  }
  if (room.archived_reason === "portfolio_deleted" || room.portfolio_id == null) {
    return { enabled: false, reason: "This portfolio was deleted; its chat history is permanent and cannot reopen." };
  }
  if (room.archived_reason === "portfolio_unapproved") {
    return { enabled: false, reason: "The portfolio must be approved before this room can reopen." };
  }
  if (!Array.isArray(room.investors) || !Array.isArray(room.eligible_interests)) {
    return { enabled: false, reason: "This room cannot reopen from its current state." };
  }
  if (room.investors.length > 0) return { enabled: true, reason: "" };
  if (room.eligible_interests.length > 0) {
    return { enabled: false, reason: "Add an eligible investor before reopening this room." };
  }
  return { enabled: false, reason: "An investor must express interest before this room can reopen." };
}
```

- [ ] **Step 4: Render every mutation control from one fail-closed lock**

At the start of both card renderers, derive:

```js
const mutationsDisabled = state.stale || state.pending.size > 0;
```

Use it to disable all create checkboxes/buttons, add checkboxes/buttons, Archive, and Reopen. Keep Open Group Chat independent.

Replace the per-card create/add disabled derivations with:

```js
// Inside renderUnclaimedPortfolios(), before mapping cards:
const mutationsDisabled = state.stale || state.pending.size > 0;
// Inside each unclaimed card:
const disabled = mutationsDisabled;

// Inside renderManagedRooms(), before mapping rooms:
const mutationsDisabled = state.stale || state.pending.size > 0;
// Inside each managed room:
const addDisabled = mutationsDisabled;
```

Pass `disabled` to every create `interestCheckbox()` and apply it to the create fieldset/button. Pass `addDisabled` to every add `interestCheckbox()` and apply it to the add fieldset/button. Use `mutationsDisabled` in the Archive/Reopen calculation below; do not apply it to `data-action="open"`.

For each archived room, derive and render the status action exactly as follows:

```js
const reopen = archived ? reopenEligibility(room) : { enabled: true, reason: "" };
const statusDisabled = mutationsDisabled || (archived && !reopen.enabled);
const reasonId = `reopen-reason-${conversationId}`;

const statusAction = `
  <button class="btn btn-outline" type="button" data-action="${archived ? "reopen" : "archive"}"
          data-id="${escapeHtml(conversationId)}"
          ${archived && reopen.reason ? `aria-describedby="${reasonId}"` : ""}
          ${statusDisabled ? "disabled" : ""}>
    <i class="ti ${archived ? "ti-lock-open" : "ti-archive"}"></i>
    ${state.pending.size ? "Updating…" : archived ? "Reopen" : "Archive"}
  </button>
  ${archived && reopen.reason ? `<p class="rm-no-eligible" id="${reasonId}">${escapeHtml(reopen.reason)}</p>` : ""}`;
```

Place `statusAction` beside the unchanged Open Group Chat button. A stale dashboard must render Open enabled and every mutation input/button disabled.

- [ ] **Step 5: Make dashboard loading and mutation outcomes truthful**

Change `setStatus()` to accept explicit Retry visibility:

```js
function setStatus(message, type = "", retryable = false) {
  const status = document.getElementById("dashboard-status");
  status.textContent = message;
  status.className = `dashboard-status ${type}`.trim();
  document.getElementById("dashboard-retry").hidden = !retryable;
}
```

Replace `loadDashboard()` and `runMutation()` with:

```js
async function loadDashboard() {
  setStatus("Loading managed conversations…", "loading");
  try {
    const dashboard = await API.getRelationshipManagerDashboard();
    state.dashboard = dashboard;
    state.stale = false;
    renderDashboard();
    setStatus("Dashboard is up to date.", "success");
    return true;
  } catch (error) {
    if (state.dashboard) {
      state.stale = true;
      renderDashboard();
    }
    setStatus(`Could not load the dashboard. ${error.message}`, "error", true);
    return false;
  }
}

async function runMutation(key, action, successMessage) {
  if (state.stale || state.pending.size > 0) return false;
  state.pending.add(key);
  renderDashboard();
  try {
    await action();
    const refreshed = await loadDashboard();
    if (!refreshed) {
      state.stale = true;
      if (state.dashboard) renderDashboard();
      setStatus(
        "The change was saved, but the dashboard refresh failed. Retry before making another change.",
        "error",
        true,
      );
      return false;
    }
    setStatus(successMessage, "success");
    return true;
  } catch (error) {
    setStatus(error.message, "error");
    return false;
  } finally {
    state.pending.delete(key);
    if (state.dashboard) renderDashboard();
  }
}
```

The existing Retry button continues to call `loadDashboard()`. Keep selection cleanup inside the mutation callback so it happens only after the server mutation succeeds.

- [ ] **Step 6: Run focused relationship-manager tests**

Run:

```bash
node --test \
  backend/test/relationship-manager-client.test.js \
  backend/test/managed-conversation-workflow.test.js \
  backend/test/managed-conversation-lifecycle.test.js
```

Expected: all tests pass; the approved eligibility matrix is exact, stale state blocks only mutations, mutation and refresh outcomes are distinct, and backend authorization remains unchanged.

- [ ] **Step 7: Commit the manager-state repair**

Run:

```bash
git add js/relationshipmanagerdashboard.js backend/test/relationship-manager-client.test.js
git diff --cached --check
git commit -m "fix: guard stale manager room actions"
```

Expected: one relationship-manager-client production/test commit.

---

### Task 7: Correct the Three Pinned Investor Icon Stylesheets

**Files:**
- Modify: `browse.html:7`
- Modify: `investordashboard.html:7`
- Modify: `my-interests.html:7`
- Modify: `backend/test/frontend-flow-contract.test.js`

**Interfaces:**
- Consumes: jsDelivr package `@tabler/icons-webfont` version `3.0.0`.
- Produces: the exact URL `https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.0.0/dist/tabler-icons.min.css` on exactly three investor pages.

- [ ] **Step 1: Write the failing exact-URL contract**

Add to `backend/test/frontend-flow-contract.test.js`:

```js
test('investor pages use the exact pinned Tabler dist stylesheet', () => {
  const expected = 'https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.0.0/dist/tabler-icons.min.css';
  for (const page of ['browse.html', 'investordashboard.html', 'my-interests.html']) {
    const source = read(page);
    const urls = [...source.matchAll(/<link[^>]+href=["']([^"']*tabler-icons[^"']*)["']/g)]
      .map((match) => match[1]);
    assert.deepEqual(urls, [expected], page);
    assert.doesNotMatch(source, /@latest|@3\.0\.0\/tabler-icons\.min\.css/);
  }
});
```

- [ ] **Step 2: Run the focused test and observe the expected failure**

Run:

```bash
node --test backend/test/frontend-flow-contract.test.js
```

Expected: FAIL for all three pages because `/dist/` is missing.

- [ ] **Step 3: Replace only the three broken URLs**

Use this exact tag in `browse.html`, `investordashboard.html`, and `my-interests.html`:

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.0.0/dist/tabler-icons.min.css" />
```

Do not alter the `@latest/dist/` stylesheet in `messages.html` as part of this task; its existing URL is not one of the confirmed 404s.

- [ ] **Step 4: Run the focused static/syntax contracts**

Run:

```bash
node --test backend/test/frontend-flow-contract.test.js backend/test/messages-deployment-files.test.js
```

Expected: all tests pass; the runtime manifest remains unchanged and all browser JavaScript passes syntax checking.

- [ ] **Step 5: Commit the asset correction**

Run:

```bash
git add browse.html investordashboard.html my-interests.html backend/test/frontend-flow-contract.test.js
git diff --cached --check
git commit -m "fix: load pinned investor icon assets"
```

Expected: one three-page asset/test commit.

---

### Task 8: Full Verification, Git Push, and Staged SFTP Release

**Files:**
- Verify only: all files changed since `codex-pre-userflow-20260723`
- Deploy only: `messages.html`, `browse.html`, `investordashboard.html`, `my-interests.html`, `js/api.js`, `js/messages.js`, `js/createportfolio.js`, `js/browse.js`, `js/investordashboard.js`, `js/my-interests.js`, `js/relationshipmanagerdashboard.js`
- Never deploy: `backend/test/`, `docs/`, `backend/src/`, `backend/schema.sql`, environment files, SQL files, or credentials

**Interfaces:**
- Consumes: the preimplementation tag, seven verified implementation commits, `origin/main`, `/var/www/html`, public `/api/health`, and public `/api/ready`.
- Produces: identical Git/local/live hashes for the eleven changed runtime files, a normal `main` push, and no temporary release/backup artifacts after successful verification.

- [ ] **Step 1: Verify exact scope and a clean implementation tree**

Run:

```bash
git status --short --branch
git diff --check codex-pre-userflow-20260723..HEAD
git diff --name-only codex-pre-userflow-20260723..HEAD | sort
git diff --exit-code codex-pre-userflow-20260723..HEAD -- \
  backend/src backend/schema.sql backend/server.js backend/package.json backend/package-lock.json
```

Expected changed paths, with no others:

```text
backend/test/api-client.test.js
backend/test/browse-client.test.js
backend/test/createportfolio-client.test.js
backend/test/frontend-flow-contract.test.js
backend/test/investor-pages-client.test.js
backend/test/managed-messages-client.test.js
backend/test/messages-client.test.js
backend/test/relationship-manager-client.test.js
browse.html
investordashboard.html
js/api.js
js/browse.js
js/createportfolio.js
js/investordashboard.js
js/messages.js
js/my-interests.js
js/relationshipmanagerdashboard.js
messages.html
my-interests.html
```

The final `git diff --exit-code` must print nothing and exit 0, proving no production backend/schema/package change.

- [ ] **Step 2: Run every local release gate**

Run:

```bash
npm --prefix backend test
for release_script in js/*.js; do node --check "$release_script"; done
git diff --check codex-pre-userflow-20260723..HEAD
```

Expected: the expanded suite has at least 140 passing tests, 0 failures; every browser script exits 0; diff check prints nothing.

- [ ] **Step 3: Review the final production diff and request the plan-required code review**

Run:

```bash
git diff --stat codex-pre-userflow-20260723..HEAD
git diff codex-pre-userflow-20260723..HEAD -- \
  messages.html browse.html investordashboard.html my-interests.html \
  js/api.js js/messages.js js/createportfolio.js js/browse.js \
  js/investordashboard.js js/my-interests.js js/relationshipmanagerdashboard.js
```

Expected: every hunk maps to one approved design requirement; there are no schema, backend route, data seed, unrelated layout, debugging log, credential, or generated-file changes. Complete the subagent-driven two-stage spec and code-quality reviews and resolve every concrete finding before continuing.

- [ ] **Step 4: Rebase safely if teammates advanced `origin/main`**

Run:

```bash
git fetch origin
git rev-list --left-right --count origin/main...main
```

If the first number is non-zero, run:

```bash
git rebase origin/main
```

Expected: clean rebase. On conflict, run `git rebase --abort` and stop for deliberate inspection. After a successful rebase, rerun:

```bash
npm --prefix backend test
git diff --check codex-pre-userflow-20260723..HEAD
```

Expected: all tests pass and diff check is empty. Never force-push.

- [ ] **Step 5: Push `main` normally and prove local/remote identity**

Run:

```bash
git push origin main
git rev-parse HEAD
git ls-remote origin refs/heads/main
git status --short --branch
```

Expected: the local HEAD hash equals the first hash from `git ls-remote`; status is clean and reports `main...origin/main` with no ahead/behind count.

- [ ] **Step 6: Establish one secure interactive SSH control session**

Run Steps 6 through 14 in one persistent local `zsh` PTY so the exact
`release_*` variables and SSH control socket remain available. Do not close
that PTY between release steps. Run locally:

```bash
release_ssh_dir=$(mktemp -d)
release_socket="$release_ssh_dir/control"
release_host='user@35.212.144.149'
release_root='/var/www/html'
release_commit=$(git rev-parse HEAD)
release_short=$(git rev-parse --short=12 HEAD)
release_backup="/home/user/lumilabs-frontend-$release_short"
release_files=(
  js/api.js
  messages.html
  js/messages.js
  js/createportfolio.js
  js/browse.js
  js/investordashboard.js
  js/my-interests.js
  js/relationshipmanagerdashboard.js
  browse.html
  investordashboard.html
  my-interests.html
)
ssh -M -S "$release_socket" -o ControlPersist=600 -fnNT "$release_host"
```

Expected: one interactive password prompt, no password in the command/history, and an active control socket at the exact `mktemp` path.

- [ ] **Step 7: Require every live preimage to match the tagged old Git blob**

Run locally through the established control socket:

```bash
for release_file in "${release_files[@]}"; do
  expected_hash=$(git show "codex-pre-userflow-20260723:$release_file" | shasum -a 256 | awk '{print $1}')
  live_hash=$(ssh -S "$release_socket" "$release_host" \
    "sha256sum -- '$release_root/$release_file'" | awk '{print $1}')
  if [[ "$expected_hash" != "$live_hash" ]]; then
    echo "STOP: live drift in $release_file"
    exit 1
  fi
  echo "PREIMAGE_OK $release_file $live_hash"
done
```

Expected: eleven `PREIMAGE_OK` lines. On any mismatch, stop without creating a backup or uploading anything; inspect teammate/live drift first.

- [ ] **Step 8: Create and verify the exact private remote backup**

Run:

```bash
ssh -S "$release_socket" "$release_host" \
  "test ! -e '$release_backup' && umask 077 && mkdir -- '$release_backup' && chmod 0700 -- '$release_backup'"
for release_file in "${release_files[@]}"; do
  ssh -S "$release_socket" "$release_host" \
    "install -D -m 0600 -- '$release_root/$release_file' '$release_backup/$release_file'"
done
ssh -S "$release_socket" "$release_host" \
  "find '$release_backup' -type f -printf '%P\n' | sort"
```

Expected exact backup file list:

```text
browse.html
investordashboard.html
js/api.js
js/browse.js
js/createportfolio.js
js/investordashboard.js
js/messages.js
js/my-interests.js
js/relationshipmanagerdashboard.js
messages.html
my-interests.html
```

If any extra or missing path appears, stop before upload.

- [ ] **Step 9: Upload only committed files to adjacent staged names**

Run this SFTP batch over the existing SSH control connection:

```bash
sftp -o ControlPath="$release_socket" "$release_host" <<SFTP_RELEASE
put js/api.js /var/www/html/js/api.js.release-$release_short.tmp
put messages.html /var/www/html/messages.html.release-$release_short.tmp
put js/messages.js /var/www/html/js/messages.js.release-$release_short.tmp
put js/createportfolio.js /var/www/html/js/createportfolio.js.release-$release_short.tmp
put js/browse.js /var/www/html/js/browse.js.release-$release_short.tmp
put js/investordashboard.js /var/www/html/js/investordashboard.js.release-$release_short.tmp
put js/my-interests.js /var/www/html/js/my-interests.js.release-$release_short.tmp
put js/relationshipmanagerdashboard.js /var/www/html/js/relationshipmanagerdashboard.js.release-$release_short.tmp
put browse.html /var/www/html/browse.html.release-$release_short.tmp
put investordashboard.html /var/www/html/investordashboard.html.release-$release_short.tmp
put my-interests.html /var/www/html/my-interests.html.release-$release_short.tmp
SFTP_RELEASE
```

Expected: eleven successful `Uploading`/`100%` transfers. No test, documentation, backend, schema, SQL, or environment file is uploaded.

- [ ] **Step 10: Verify staged hashes before replacing a live file**

Run:

```bash
for release_file in "${release_files[@]}"; do
  expected_hash=$(git show "$release_commit:$release_file" | shasum -a 256 | awk '{print $1}')
  staged_hash=$(ssh -S "$release_socket" "$release_host" \
    "chmod 0644 -- '$release_root/$release_file.release-$release_short.tmp' && sha256sum -- '$release_root/$release_file.release-$release_short.tmp'" \
    | awk '{print $1}')
  if [[ "$expected_hash" != "$staged_hash" ]]; then
    echo "STOP: staged hash mismatch in $release_file"
    exit 1
  fi
  echo "STAGED_OK $release_file $staged_hash"
done
```

Expected: eleven `STAGED_OK` lines. A mismatch leaves live files unchanged and the private backup intact.

- [ ] **Step 11: Atomically rename in rollout-safe dependency order**

The new shared client deliberately uses `SHARED_API_BASE`, so the old message client can coexist briefly after the new `messages.html` starts loading `js/api.js`. Run:

```bash
ssh -S "$release_socket" "$release_host" "
  set -eu
  mv -f -- '$release_root/js/api.js.release-$release_short.tmp' '$release_root/js/api.js'
  mv -f -- '$release_root/messages.html.release-$release_short.tmp' '$release_root/messages.html'
  mv -f -- '$release_root/js/messages.js.release-$release_short.tmp' '$release_root/js/messages.js'
  mv -f -- '$release_root/js/createportfolio.js.release-$release_short.tmp' '$release_root/js/createportfolio.js'
  mv -f -- '$release_root/js/browse.js.release-$release_short.tmp' '$release_root/js/browse.js'
  mv -f -- '$release_root/js/investordashboard.js.release-$release_short.tmp' '$release_root/js/investordashboard.js'
  mv -f -- '$release_root/js/my-interests.js.release-$release_short.tmp' '$release_root/js/my-interests.js'
  mv -f -- '$release_root/js/relationshipmanagerdashboard.js.release-$release_short.tmp' '$release_root/js/relationshipmanagerdashboard.js'
  mv -f -- '$release_root/browse.html.release-$release_short.tmp' '$release_root/browse.html'
  mv -f -- '$release_root/investordashboard.html.release-$release_short.tmp' '$release_root/investordashboard.html'
  mv -f -- '$release_root/my-interests.html.release-$release_short.tmp' '$release_root/my-interests.html'
"
```

Expected: command exits 0. Every replacement is a same-filesystem atomic rename; no partial file is streamed into a live path.

- [ ] **Step 12: Verify committed/live hashes, all frontend paths, CDN, health, and readiness**

Run:

```bash
for release_file in "${release_files[@]}"; do
  expected_hash=$(git show "$release_commit:$release_file" | shasum -a 256 | awk '{print $1}')
  live_hash=$(ssh -S "$release_socket" "$release_host" \
    "sha256sum -- '$release_root/$release_file'" | awk '{print $1}')
  [[ "$expected_hash" = "$live_hash" ]] || exit 1
  echo "DEPLOYED_OK $release_file $live_hash"
done

while IFS= read -r release_path; do
  [[ "$release_path" = backend/* ]] && continue
  release_status=$(curl -sS -o /dev/null -w '%{http_code}' "http://35.212.144.149/$release_path")
  [[ "$release_status" = 200 ]] || exit 1
  echo "HTTP_OK $release_path"
done < backend/deploy/runtime-manifest.txt

curl -sS -o /dev/null -w '%{http_code}\n' \
  'https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.0.0/dist/tabler-icons.min.css'
curl -sS -o /dev/null -w '%{http_code}\n' 'http://35.212.144.149/api/health'
curl -sS -o /dev/null -w '%{http_code}\n' 'http://35.212.144.149/api/ready'
npm --prefix backend test
```

Expected: eleven `DEPLOYED_OK` lines, every frontend manifest path prints `HTTP_OK`, then CDN/health/readiness each print `200`, and the complete test suite has 0 failures. Do not claim a visual browser click-through because the in-app browser was unavailable.

- [ ] **Step 13: If any post-replacement gate fails, perform exact rollback**

Run this only after a Step 11 or Step 12 failure:

```bash
for release_file in "${release_files[@]}"; do
  ssh -S "$release_socket" "$release_host" \
    "install -m 0644 -- '$release_backup/$release_file' '$release_root/$release_file.rollback-$release_short.tmp' && mv -f -- '$release_root/$release_file.rollback-$release_short.tmp' '$release_root/$release_file'"
done
for release_file in "${release_files[@]}"; do
  expected_hash=$(git show "codex-pre-userflow-20260723:$release_file" | shasum -a 256 | awk '{print $1}')
  live_hash=$(ssh -S "$release_socket" "$release_host" \
    "sha256sum -- '$release_root/$release_file'" | awk '{print $1}')
  [[ "$expected_hash" = "$live_hash" ]] || exit 1
  echo "ROLLBACK_OK $release_file $live_hash"
done
```

Expected: eleven `ROLLBACK_OK` lines. Keep the backup directory and local preimage tag after rollback for investigation; do not run the success cleanup steps.

- [ ] **Step 14: After complete success, remove only verified temporary artifacts**

First require the exact backup list programmatically, then remove each known file and empty directory:

```bash
expected_backup=$(printf '%s\n' "${release_files[@]}" | sort)
actual_backup=$(ssh -S "$release_socket" "$release_host" \
  "find '$release_backup' -type f -printf '%P\n' | sort")
[[ "$expected_backup" = "$actual_backup" ]] || exit 1

for release_file in "${release_files[@]}"; do
  ssh -S "$release_socket" "$release_host" "rm -- '$release_backup/$release_file'"
done
ssh -S "$release_socket" "$release_host" \
  "rmdir -- '$release_backup/js' '$release_backup' && test ! -e '$release_backup'"
ssh -S "$release_socket" -O exit "$release_host"
test -S "$release_socket" && exit 1
rmdir -- "$release_ssh_dir"
git tag -d codex-pre-userflow-20260723
git status --short --branch
```

Expected: the remote backup and local control-socket directory no longer exist, the temporary local tag is deleted, the Git worktree is clean, and `main...origin/main` has no divergence.

## Final Acceptance Checklist

- [ ] All new focused tests were observed failing before their production edits and passing afterward.
- [ ] The complete suite passes with 0 failures after the final rebase and after deployment.
- [ ] No production backend, schema, package, environment, SQL, seed, or live database change occurred.
- [ ] A 401 clears and redirects once; wrong role, 403, 5xx, and network errors preserve valid sessions as designed.
- [ ] An inaccessible explicit room and a room removed during refresh clear all thread/composer state and cannot be restored by an older response.
- [ ] Portfolio numeric zeroes survive hydration and payload construction.
- [ ] Interest mutations use one atomic server snapshot; stale state is labelled, globally locked, and recoverable without resending the mutation.
- [ ] Investor dashboard sections fail independently, quick actions always render, unknown interests do not display an invented zero, and My Interests retains sign-out/retry behavior.
- [ ] Relationship-manager Reopen eligibility and stale mutation controls match the approved matrix while Open Group Chat remains available.
- [ ] Exactly three investor pages use the verified pinned `/dist/` Tabler stylesheet URL.
- [ ] Git local/remote hashes match and all eleven deployed runtime files match the pushed commit.
- [ ] Every public frontend manifest path, CDN stylesheet, health endpoint, and readiness endpoint returns HTTP 200.
- [ ] No temporary SFTP staging file, remote backup, SSH control socket, or local preimage tag remains after success.
