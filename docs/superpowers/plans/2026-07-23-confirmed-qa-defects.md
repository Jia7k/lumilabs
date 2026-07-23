# Confirmed QA Defects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct the four confirmed signed-in QA defects while preserving all unrelated portfolio, interest, conversation, authentication, and messaging behavior.

**Architecture:** Keep the current Express/MySQL API and vanilla HTML/CSS/JavaScript structure. Extend only the business-owner aggregate response, derive managed-chat guidance from existing membership-aware payload fields and the current investor's reconciled interest set, and make two narrowly scoped relationship-manager presentation fixes.

**Tech Stack:** Node.js test runner, Express, MySQL query adapter, vanilla JavaScript, HTML, and CSS.

## Global Constraints

- Fix only the four defects confirmed during the signed-in four-role walkthrough.
- Deployment, SFTP cleanup, database mutation, and Git push are outside this change.
- Do not change messaging persistence, alignment, membership, archive, or reopen logic.
- Do not change interest mutation behavior.
- Do not change authentication, role routing, or unrelated pages.
- Escape all rendered database-derived values as before.
- Prefer existing payload fields and a narrowly scoped CSS selector over broader API or styling refactors.
- Add each regression test first and observe it failing before changing production code.

---

## File Map

- Create `backend/test/business-owner-dashboard-route.test.js`: exercise the real owner dashboard route with a stubbed database and verify the complete status aggregate.
- Create `backend/test/mybusinesses-client.test.js`: behavior-test the My Businesses managed-chat display matrix.
- Modify `backend/test/frontend-flow-contract.test.js`: protect the rejected count tile, four-status breakdown, and responsive styling.
- Modify `backend/test/browse-client.test.js`: behavior-test Browse guidance against the current investor's interest state.
- Modify `backend/test/relationship-manager-client.test.js`: behavior-test Retry visibility and the two zero-eligibility room messages.
- Modify `backend/src/routes/dashboard.js`: add rejected to the business-owner aggregate and response.
- Modify `businessownerdashboard.html`: render rejected in both owner status summaries.
- Modify `css/style.css`: style the rejected tile, keep four tiles responsive, and honor the RM Retry button's `hidden` attribute.
- Modify `js/mybusinesses.js`: render chat guidance from portfolio status, interest count, and accessible chat state.
- Modify `js/browse.js`: render waiting guidance only after the current investor expresses interest.
- Modify `js/relationshipmanagerdashboard.js`: distinguish no interested investors from an exhausted eligible-investor list.

### Task 1: Reconcile Business-Owner Portfolio Statistics

**Files:**
- Create: `backend/test/business-owner-dashboard-route.test.js`
- Modify: `backend/test/frontend-flow-contract.test.js`
- Modify: `backend/src/routes/dashboard.js`
- Modify: `businessownerdashboard.html`
- Modify: `css/style.css`

**Interfaces:**
- Consumes: `GET /api/dashboard/business-owner` and the existing `data.portfolios` dashboard payload.
- Produces: `data.portfolios.rejected: number`, DOM target `#count-rejected`, and a four-state status summary whose values reconcile with `data.portfolios.total`.

- [ ] **Step 1: Write the failing route regression test**

Create `backend/test/business-owner-dashboard-route.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'business-owner-dashboard-test-secret';

const db = require('../src/config/db');
const { createApp } = require('../server');

async function listen(app) {
  const server = await new Promise((resolve, reject) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    listener.once('error', reject);
  });
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    }),
  };
}

function authHeaders() {
  return {
    Authorization: `Bearer ${jwt.sign({
      id: 3,
      email: 'owner@example.test',
      name: 'Business Owner',
      role: 'business_owner',
    }, process.env.JWT_SECRET)}`,
  };
}

async function requestDashboard(t) {
  const server = await listen(createApp());
  t.after(server.close);
  const response = await fetch(`${server.origin}/api/dashboard/business-owner`, {
    headers: authHeaders(),
  });
  return { response, payload: await response.json() };
}

function stubDashboardQueries(t, portfolioStats) {
  const original = db.query;
  db.query = async (sql) => {
    const normalized = String(sql).replace(/\s+/g, ' ').trim();
    if (normalized.includes('ROUND(AVG(readiness_score), 0) AS avg_readiness')) {
      assert.match(
        normalized,
        /SUM\(status = 'rejected'\) AS rejected/,
      );
      return [[portfolioStats], []];
    }
    if (normalized.startsWith('SELECT COUNT(*) AS total FROM investor_interests')) {
      return [[{ total: 0 }], []];
    }
    if (normalized.includes('FROM conversation_members cm')) {
      return [[{ total: 0, unread: 0 }], []];
    }
    if (normalized.startsWith('SELECT id, name, sector, status, readiness_score')) {
      return [[], []];
    }
    if (normalized.startsWith('SELECT u.name AS investor')) {
      return [[], []];
    }
    if (normalized.startsWith('SELECT n.id, n.type, n.title')) {
      return [[], []];
    }
    throw new Error(`Unexpected query: ${normalized}`);
  };
  t.after(() => {
    db.query = original;
  });
}

test('business-owner dashboard returns a complete portfolio status breakdown including rejected', { concurrency: false }, async (t) => {
  stubDashboardQueries(t, {
    total: 4,
    approved: 1,
    pending: 1,
    rejected: 1,
    draft: 1,
    avg_readiness: 70,
  });

  const { response, payload } = await requestDashboard(t);

  assert.equal(response.status, 200);
  assert.deepEqual(payload.portfolios, {
    total: 4,
    approved: 1,
    pending: 1,
    rejected: 1,
    draft: 1,
  });
  assert.equal(
    payload.portfolios.approved
      + payload.portfolios.pending
      + payload.portfolios.rejected
      + payload.portfolios.draft,
    payload.portfolios.total,
  );
});

test('business-owner dashboard normalizes empty status aggregates to zero', { concurrency: false }, async (t) => {
  stubDashboardQueries(t, {
    total: 0,
    approved: null,
    pending: null,
    rejected: null,
    draft: null,
    avg_readiness: null,
  });

  const { response, payload } = await requestDashboard(t);

  assert.equal(response.status, 200);
  assert.deepEqual(payload.portfolios, {
    total: 0,
    approved: 0,
    pending: 0,
    rejected: 0,
    draft: 0,
  });
});
```

- [ ] **Step 2: Write the failing dashboard presentation contract**

Append to `backend/test/frontend-flow-contract.test.js`:

```js
test('business dashboard displays rejected portfolios in both status summaries', () => {
  const html = read('businessownerdashboard.html');
  const css = read('css/style.css');

  assert.match(
    html,
    /class=["']count-box rejected["'][\s\S]*?class=["']count-label["']>Rejected<[\s\S]*?id=["']count-rejected["']/,
  );
  assert.match(html, /data\.portfolios\.rejected\}\s+rejected/);
  assert.match(
    html,
    /getElementById\(["']count-rejected["']\)\.innerText\s*=\s*data\.portfolios\.rejected/,
  );
  assert.match(
    css,
    /\.count-grid\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*1fr\)/s,
  );
  assert.match(css, /\.count-box\.rejected\s*\{[^}]*var\(--red-bg\)/s);
  assert.match(
    css,
    /\.count-box\.rejected \.count-(?:label|num)[\s\S]*var\(--red-text\)/,
  );
  assert.match(
    css,
    /@media \(max-width:\s*720px\)[\s\S]*?\.count-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*1fr\)/,
  );
});
```

- [ ] **Step 3: Run the focused tests and verify RED**

Run from `backend/`:

```bash
node --test test/business-owner-dashboard-route.test.js test/frontend-flow-contract.test.js
```

Expected: the route tests fail because the SQL and JSON payload omit `rejected`; the presentation contract fails because the rejected tile, DOM assignment, and four-column styling do not exist.

- [ ] **Step 4: Add rejected to the owner aggregate and response**

In the business-owner aggregate in `backend/src/routes/dashboard.js`, insert:

```js
        SUM(status = 'rejected') AS rejected,
```

In the `portfolios` response object, insert:

```js
        rejected: portfolioStats.rejected || 0,
```

- [ ] **Step 5: Render the rejected count in both dashboard summaries**

In `businessownerdashboard.html`, add this tile after Pending and before Draft:

```html
          <div class="count-box rejected">
            <div class="count-label">Rejected</div>
            <div class="count-num" id="count-rejected"></div>
          </div>
```

Replace the breakdown assignment with:

```js
      document.getElementById("stat-breakdown").innerText = `${data.portfolios.approved} approved · ${data.portfolios.pending} pending · ${data.portfolios.rejected} rejected · ${data.portfolios.draft} draft`;
```

Add the rejected tile assignment between Pending and Draft:

```js
      document.getElementById("count-rejected").innerText = data.portfolios.rejected;
```

- [ ] **Step 6: Style the four-state count grid**

In `css/style.css`, change the count grid to:

```css
.count-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 20px;
}
```

Add the rejected tile rules beside the existing count-box state rules:

```css
.count-box.rejected {
  background: var(--red-bg);
}

.count-box.rejected .count-label,
.count-box.rejected .count-num {
  color: var(--red-text);
}
```

Inside the existing `@media (max-width: 720px)` block, add:

```css
  .count-grid {
    grid-template-columns: repeat(2, 1fr);
  }
```

- [ ] **Step 7: Run the focused tests and verify GREEN**

Run from `backend/`:

```bash
node --test test/business-owner-dashboard-route.test.js test/frontend-flow-contract.test.js
```

Expected: all tests in both files pass.

- [ ] **Step 8: Commit the owner-statistics fix**

```bash
git add backend/test/business-owner-dashboard-route.test.js backend/test/frontend-flow-contract.test.js backend/src/routes/dashboard.js businessownerdashboard.html css/style.css
git commit -m "fix: reconcile owner portfolio status totals"
```

### Task 2: Gate Managed-Chat Guidance by User State

**Files:**
- Create: `backend/test/mybusinesses-client.test.js`
- Modify: `backend/test/browse-client.test.js`
- Modify: `js/mybusinesses.js`
- Modify: `js/browse.js`

**Interfaces:**
- Consumes: My Businesses fields `status`, `interest_count`, `conversation_id`, and `chat_state`; Browse's reconciled `liked` boolean from `interestedIds`.
- Produces: `managedChatAction(portfolio): string` on My Businesses and `managedChatAction(portfolio, hasExpressedInterest): string` on Browse.

- [ ] **Step 1: Write the failing My Businesses behavior tests**

Create `backend/test/mybusinesses-client.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..', '..');
const source = fs.readFileSync(path.join(root, 'js', 'mybusinesses.js'), 'utf8');

function loadClient() {
  const elements = new Map();
  const document = {
    addEventListener() {},
    getElementById(id) {
      if (!elements.has(id)) {
        elements.set(id, {
          innerHTML: '',
          innerText: '',
          addEventListener() {},
          classList: {
            toggle() {},
            remove() {},
          },
        });
      }
      return elements.get(id);
    },
  };
  const context = vm.createContext({
    window: { location: { href: '' } },
    document,
    requirePageRole: async () => null,
    API: {},
    alert() {},
    confirm() { return false; },
    console,
    Date,
    Intl,
  });
  vm.runInContext(source, context);
  return {
    run(code) {
      return vm.runInContext(code, context);
    },
  };
}

function render(client, portfolio) {
  return client.run(`managedChatAction(${JSON.stringify(portfolio)})`);
}

test('My Businesses prioritizes accessible open and archived conversations', () => {
  const client = loadClient();

  const open = render(client, {
    status: 'approved',
    interest_count: 1,
    conversation_id: 12,
    chat_state: 'open',
  });
  assert.match(open, /href="messages\.html\?conversationId=12"/);
  assert.match(open, /Open Managed Chat/);

  const archived = render(client, {
    status: 'rejected',
    interest_count: 0,
    conversation_id: 12,
    chat_state: 'archived',
  });
  assert.match(archived, /href="messages\.html\?conversationId=12"/);
  assert.match(archived, /View Archived Chat/);
});

test('My Businesses distinguishes manager handoff from waiting for investor interest', () => {
  const client = loadClient();

  for (const interestCount of [2, '2']) {
    const awaiting = render(client, {
      status: 'approved',
      interest_count: interestCount,
      conversation_id: null,
      chat_state: 'awaiting_manager',
    });
    assert.match(awaiting, /Awaiting Relationship Manager/);
    assert.doesNotMatch(awaiting, /href=/);
  }

  const waiting = render(client, {
    status: 'approved',
    interest_count: 0,
    conversation_id: null,
    chat_state: 'awaiting_manager',
  });
  assert.match(waiting, /Waiting for investor interest/);
  assert.doesNotMatch(waiting, /Awaiting Relationship Manager/);
  assert.doesNotMatch(waiting, /href=/);
});

test('My Businesses shows no managed-chat guidance for ineligible portfolio states', () => {
  const client = loadClient();

  for (const status of ['draft', 'pending', 'rejected']) {
    assert.equal(render(client, {
      status,
      interest_count: 3,
      conversation_id: null,
      chat_state: 'awaiting_manager',
    }), '');
  }
});
```

- [ ] **Step 2: Write the failing Browse behavior tests**

Append to `backend/test/browse-client.test.js`:

```js
test('browse managed-chat guidance waits for the current investor to express interest', () => {
  const client = browseHarness();

  const open = client.run(`managedChatAction({
    conversation_id: 44,
    chat_state: 'open'
  }, false)`);
  assert.match(open, /href="messages\.html\?conversationId=44"/);
  assert.match(open, /Open Managed Chat/);

  const archived = client.run(`managedChatAction({
    conversation_id: 44,
    chat_state: 'archived'
  }, false)`);
  assert.match(archived, /View Archived Chat/);

  const awaiting = client.run(`managedChatAction({
    conversation_id: null,
    chat_state: 'awaiting_manager'
  }, true)`);
  assert.match(awaiting, /Awaiting Relationship Manager/);
  assert.doesNotMatch(awaiting, /href=/);

  assert.equal(client.run(`managedChatAction({
    conversation_id: null,
    chat_state: 'awaiting_manager'
  }, false)`), '');
});

test('renderGrid supplies the reconciled current-investor state to chat guidance', () => {
  const client = browseHarness();

  client.run(`
    interestedIds = new Set([1]);
    managedChatAction = (portfolio, hasInterest) => {
      hooks.calls.push([portfolio.id, hasInterest]);
      return "";
    };
    renderGrid([
      {
        id: 1, name: "Interested", owner_name: "Owner", sector: "SaaS",
        funding_goal: 1000, readiness_score: 70, interest_count: 1
      },
      {
        id: 2, name: "Not interested", owner_name: "Owner", sector: "SaaS",
        funding_goal: 1000, readiness_score: 70, interest_count: 0
      }
    ]);
  `);

  assert.deepEqual(
    JSON.parse(JSON.stringify(client.hooks.calls)),
    [[1, true], [2, false]],
  );
});
```

- [ ] **Step 3: Run the focused tests and verify RED**

Run from `backend/`:

```bash
node --test test/mybusinesses-client.test.js test/browse-client.test.js
```

Expected: My Businesses incorrectly uses “Awaiting Relationship Manager” for every no-conversation state; Browse ignores the second argument and renders the waiting label before interest; the render integration test records no `liked` arguments.

- [ ] **Step 4: Implement the My Businesses display precedence**

Replace `managedChatAction` in `js/mybusinesses.js` with:

```js
function managedChatAction(portfolio) {
  const conversationId = Number(portfolio.conversation_id);
  if (Number.isInteger(conversationId) && conversationId > 0 && portfolio.chat_state === "open") {
    return `<a class="managed-chat-action" href="messages.html?conversationId=${conversationId}"><i class="ti ti-messages"></i> Open Managed Chat</a>`;
  }
  if (Number.isInteger(conversationId) && conversationId > 0 && portfolio.chat_state === "archived") {
    return `<a class="managed-chat-action managed-chat-archived" href="messages.html?conversationId=${conversationId}"><i class="ti ti-archive"></i> View Archived Chat</a>`;
  }
  if (portfolio.status !== "approved") return "";
  if (Number(portfolio.interest_count) > 0) {
    return `<span class="managed-chat-awaiting"><i class="ti ti-clock"></i> Awaiting Relationship Manager</span>`;
  }
  return `<span class="managed-chat-awaiting"><i class="ti ti-heart"></i> Waiting for investor interest</span>`;
}
```

- [ ] **Step 5: Implement the Browse current-investor gate**

Change the Browse helper signature and fallback in `js/browse.js`:

```js
function managedChatAction(portfolio, hasExpressedInterest) {
  const conversationId = Number(portfolio.conversation_id);
  if (Number.isInteger(conversationId) && conversationId > 0 && portfolio.chat_state === "open") {
    return `<a class="managed-chat-action" href="messages.html?conversationId=${conversationId}"><i class="ti ti-messages"></i> Open Managed Chat</a>`;
  }
  if (Number.isInteger(conversationId) && conversationId > 0 && portfolio.chat_state === "archived") {
    return `<a class="managed-chat-action managed-chat-archived" href="messages.html?conversationId=${conversationId}"><i class="ti ti-archive"></i> View Archived Chat</a>`;
  }
  if (!hasExpressedInterest) return "";
  return `<span class="managed-chat-awaiting"><i class="ti ti-clock"></i> Awaiting Relationship Manager</span>`;
}
```

In `renderGrid`, pass the already calculated `liked` value:

```js
          ${managedChatAction(p, liked)}
```

- [ ] **Step 6: Run the focused tests and verify GREEN**

Run from `backend/`:

```bash
node --test test/mybusinesses-client.test.js test/browse-client.test.js
```

Expected: all tests in both files pass.

- [ ] **Step 7: Commit the managed-chat guidance fix**

```bash
git add backend/test/mybusinesses-client.test.js backend/test/browse-client.test.js js/mybusinesses.js js/browse.js
git commit -m "fix: gate managed chat guidance by user state"
```

### Task 3: Correct Relationship-Manager Presentation States

**Files:**
- Modify: `backend/test/relationship-manager-client.test.js`
- Modify: `css/style.css`
- Modify: `js/relationshipmanagerdashboard.js`

**Interfaces:**
- Consumes: the existing `retryable` argument to `setStatus`, `room.investors`, and `room.eligible_interests`.
- Produces: a Retry button that is visibly absent while `hidden = true` and distinct zero-eligibility copy for empty versus fully represented investor sets.

- [ ] **Step 1: Extend the harness and write the failing Retry regression**

In `backend/test/relationship-manager-client.test.js`, add:

```js
const cssPath = path.join(root, 'css', 'style.css');
```

Inside `managerHarness`, capture the real status helper immediately after evaluating the client:

```js
  const originalSetStatus = context.setStatus;
```

Return it from the harness:

```js
  return {
    context,
    elements,
    hooks,
    originalSetStatus,
    run: (code) => vm.runInContext(code, context),
  };
```

Add this test:

```js
test('Retry remains visually hidden when the dashboard status is not retryable', () => {
  const css = readRequired(cssPath, 'shared stylesheet');
  assert.match(
    css,
    /\.rm-retry\[hidden\]\s*\{[^}]*display:\s*none\s*;?[^}]*\}/s,
  );

  const client = managerHarness();

  client.originalSetStatus('Dashboard is up to date.', 'success');
  assert.equal(client.elements.get('dashboard-retry').hidden, true);

  client.originalSetStatus('Could not load the dashboard.', 'error', true);
  assert.equal(client.elements.get('dashboard-retry').hidden, false);
});
```

- [ ] **Step 2: Write the failing zero-investor copy regression**

Append to `backend/test/relationship-manager-client.test.js`:

```js
test('managed room distinguishes zero investors from an exhausted eligible list', () => {
  const client = managerHarness();

  client.run(`
    state.dashboard = {
      stats: {},
      unclaimed_portfolios: [],
      rooms: [{
        conversation_id: 12,
        portfolio_id: 1,
        title: 'Solar Stack',
        status: 'archived',
        archived_reason: 'no_active_investors',
        unread_count: 0,
        owner: { id: 3, name: 'Charlie' },
        investors: [],
        eligible_interests: []
      }]
    };
    renderManagedRooms();
  `);

  let rendered = client.elements.get('managed-room-list').innerHTML;
  assert.match(rendered, /No investors are currently interested\./);
  assert.doesNotMatch(
    rendered,
    /All currently interested investors are already in this room/,
  );

  client.run(`
    state.dashboard.rooms[0].investors = [{ id: 6, name: 'Investor One' }];
    renderManagedRooms();
  `);

  rendered = client.elements.get('managed-room-list').innerHTML;
  assert.match(
    rendered,
    /All currently interested investors are already in this room/,
  );
  assert.doesNotMatch(rendered, /No investors are currently interested\./);
});
```

- [ ] **Step 3: Run the focused test and verify RED**

Run from `backend/`:

```bash
node --test test/relationship-manager-client.test.js
```

Expected: the CSS assertion fails because `.btn` overrides the native hidden rule, and the empty room still renders “All currently interested investors are already in this room.”

- [ ] **Step 4: Restore Retry's hidden presentation**

Immediately after `.rm-retry { margin-bottom: 16px; }` in `css/style.css`, add:

```css
.rm-retry[hidden] {
  display: none;
}
```

- [ ] **Step 5: Render the correct no-eligible message**

In `renderManagedRooms` in `js/relationshipmanagerdashboard.js`, after `eligibleInterests` is calculated, add:

```js
    const noEligibleMessage = investors.length
      ? "All currently interested investors are already in this room."
      : "No investors are currently interested.";
```

Replace the hard-coded fallback at the end of the add-investor block with:

```js
          </button>` : `<p class="rm-no-eligible">${escapeHtml(noEligibleMessage)}</p>`}
```

- [ ] **Step 6: Run the focused test and verify GREEN**

Run from `backend/`:

```bash
node --test test/relationship-manager-client.test.js
```

Expected: all relationship-manager client tests pass.

- [ ] **Step 7: Commit the relationship-manager presentation fix**

```bash
git add backend/test/relationship-manager-client.test.js css/style.css js/relationshipmanagerdashboard.js
git commit -m "fix: clarify manager dashboard presentation states"
```

### Task 4: Verify the Integrated Result

**Files:**
- Verify only: all files changed by Tasks 1-3.

**Interfaces:**
- Consumes: the three independently passing task deliverables.
- Produces: syntax, regression-suite, and signed-in browser evidence that the four fixes work without changing unrelated flows.

- [ ] **Step 1: Run all focused regression tests together**

Run from `backend/`:

```bash
node --test test/business-owner-dashboard-route.test.js test/frontend-flow-contract.test.js test/mybusinesses-client.test.js test/browse-client.test.js test/relationship-manager-client.test.js
```

Expected: all focused tests pass with zero failures.

- [ ] **Step 2: Run syntax checks for every changed browser script**

Run from the repository root:

```bash
node --check js/mybusinesses.js
node --check js/browse.js
node --check js/relationshipmanagerdashboard.js
```

Expected: each command exits with status 0 and no output.

- [ ] **Step 3: Run the complete automated suite**

Run from the repository root:

```bash
npm --prefix backend test
```

Expected: the complete Node test suite passes with zero failures.

- [ ] **Step 4: Check patch hygiene**

Run from the repository root:

```bash
git diff --check
git status --short
```

Expected: both commands produce no output after the scoped task commits and planning-document commit.

- [ ] **Step 5: Perform the signed-in visual verification**

Start a read-only static preview from the repository root:

```bash
python3 -m http.server 4173 --bind 127.0.0.1
```

Before navigating the browser page to `http://127.0.0.1:4173/signin.html`, install this Playwright route in the browser test harness:

```js
await page.route('http://127.0.0.1:4173/api/**', async (route) => {
  const requestUrl = new URL(route.request().url());
  const upstreamUrl = `http://35.212.144.149${requestUrl.pathname}${requestUrl.search}`;
  const response = await route.fetch({ url: upstreamUrl });

  if (
    requestUrl.pathname === '/api/dashboard/business-owner'
    && response.ok()
  ) {
    const payload = await response.json();
    payload.portfolios.rejected = Math.max(
      0,
      Number(payload.portfolios.total)
        - Number(payload.portfolios.approved)
        - Number(payload.portfolios.pending)
        - Number(payload.portfolios.draft),
    );
    await route.fulfill({ response, json: payload });
    return;
  }

  await route.fulfill({ response });
});
```

This exercises the candidate frontend against read-only live data while supplying the new owner-dashboard response field before deployment. Use the existing QA accounts and records without creating, deleting, approving, rejecting, expressing, or withdrawing interest:

1. On `businessownerdashboard.html`, verify Total Portfolios equals Approved + Pending + Rejected + Draft and the four tiles remain readable at desktop and narrow widths.
2. On `mybusinesses.html`, verify approved/no-interest shows “Waiting for investor interest,” approved/interest/no-room shows “Awaiting Relationship Manager,” accessible rooms retain their Open/Archived links, and draft/pending/rejected cards show no misleading chat status.
3. On `browse.html`, verify a portfolio without current-user interest has no waiting label and an already-interested portfolio without a room shows “Awaiting Relationship Manager.”
4. On `relationshipmanagerdashboard.html`, verify Retry is absent after a successful load and the archived zero-investor room says “No investors are currently interested.”

Expected: all four confirmed defects are absent and no unrelated mutation is performed.

- [ ] **Step 6: Record final verification state**

Run from the repository root:

```bash
git log -4 --oneline
git status --short
```

Expected: the three scoped fix commits are present, with no uncommitted application changes.
