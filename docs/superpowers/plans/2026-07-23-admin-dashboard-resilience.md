# Administrator Dashboard Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor Victor's moderation dashboard so its sections recover independently, portfolio Review always gives visible feedback, decision mutations cannot be duplicated, and the page requests one cache-keyed frontend asset set.

**Architecture:** Keep the existing static HTML/CSS/vanilla-JavaScript architecture and existing backend API contracts. Split the page client into two version-guarded section loaders, a version-guarded review-detail state machine, and a single-flight decision state machine; exercise the real browser client through a dependency-free Node VM/DOM harness.

**Tech Stack:** Static HTML, CSS, browser JavaScript, Node.js `node:test`, `node:assert`, and `node:vm`; no new dependencies.

## Global Constraints

- Runtime scope is limited to `moderatordashboard.html`, `js/moderatordashboard.js`, and narrowly scoped administrator styles in `css/style.css`.
- `js/api.js` receives a versioned URL but no implementation change; stop and revise the approved specification before any shared-client correction.
- Do not change database schema, production records, backend routes, role permissions, audit logs, readiness calculations, or another role's page.
- Preserve the existing Lumi5 visual language and escape every database-derived string.
- Stats and queue form one coherent moderation snapshot; never commit only one half.
- Relationship-manager directory failures must not block moderation or the account-creation form.
- A successful POST/PUT followed by a failed GET must never repeat the mutation on Retry.
- Use synchronized release key `v=20260723.4` for the administrator CSS, API client, and page client.
- Publishing to GitHub or SFTP requires separate user authorization after verification.
- A keyed asset URL cannot purge a cached HTML document; release handoff must require one hard refresh or a one-time query on `moderatordashboard.html`.

---

## File Structure

- Create `backend/test/helpers/admin-dashboard-harness.js`: dependency-free fake DOM, event dispatcher, deferred promises, and VM loader for the real administrator client.
- Create `backend/test/admin-dashboard-client.test.js`: executable state-machine and interaction regressions.
- Modify `backend/test/frontend-flow-contract.test.js`: administrator markup, cache-key, and no-inline-Review source contracts.
- Modify `moderatordashboard.html`: stable section status/Retry controls, modal semantics, rejection error region, and synchronized asset keys.
- Modify `js/moderatordashboard.js`: independent loaders, delegated Review, modal recovery, mutation locking, and relationship-manager creation recovery.
- Modify `css/style.css`: administrator-only status, retry, stale, disabled, modal-error, and focus presentation.

---

### Task 1: Add the Recoverable Administrator Page Shell

**Files:**
- Modify: `backend/test/frontend-flow-contract.test.js`
- Modify: `moderatordashboard.html`
- Modify: `css/style.css`

**Interfaces:**
- Consumes: Existing administrator element IDs and shared `.dashboard-status`, `.form-message`, modal, button, and table styles.
- Produces: `moderation-status`, `moderation-retry-btn`, `manager-directory-status`, `manager-directory-retry-btn`, `reason-error`, an accessible `review-card`, and synchronized asset URLs used by later tasks.

- [ ] **Step 1: Write the failing shell and asset contract**

Append this exact test after the existing administrator provisioning test:

```js
test('administrator dashboard exposes recoverable sections and synchronized assets', () => {
  const html = read('moderatordashboard.html');
  const css = read('css/style.css');

  for (const id of [
    'moderation-status',
    'moderation-retry-btn',
    'manager-directory-status',
    'manager-directory-retry-btn',
    'reason-error',
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`), id);
  }

  assert.match(
    html,
    /id=["']review-card["'][^>]*role=["']dialog["'][^>]*aria-modal=["']true["'][^>]*tabindex=["']-1["']/,
  );
  assert.match(html, /href=["']css\/style\.css\?v=20260723\.4["']/);
  assert.match(html, /src=["']js\/api\.js\?v=20260723\.4["']/);
  assert.match(html, /src=["']js\/moderatordashboard\.js\?v=20260723\.4["']/);
  assert.match(css, /\.admin-retry-btn\[hidden\][^{]*\{[^}]*display:\s*none/s);
  assert.match(css, /\.admin-dashboard-status\.stale/);
  assert.match(css, /\.admin-row-state/);
  assert.match(css, /\.modal-error-state/);
});
```

- [ ] **Step 2: Run the contract and verify red**

Run:

```bash
cd backend
node --test --test-name-pattern="administrator dashboard exposes recoverable" test/frontend-flow-contract.test.js
```

Expected: FAIL because `moderation-status` is absent.

- [ ] **Step 3: Add the stable HTML regions and asset keys**

In the relationship-manager directory, place this block immediately after
`.rm-directory-heading` and before `.rm-table-scroll`:

```html
<div class="admin-section-feedback">
  <p class="dashboard-status admin-dashboard-status"
     id="manager-directory-status"
     role="status"
     aria-live="polite"
     hidden></p>
  <button class="btn btn-outline admin-retry-btn"
          id="manager-directory-retry-btn"
          type="button"
          hidden>
    <i class="ti ti-refresh"></i> Try again
  </button>
</div>
```

In the moderation card header, place this block between the title and **View
Audit Logs**:

```html
<div class="admin-section-feedback">
  <p class="dashboard-status admin-dashboard-status"
     id="moderation-status"
     role="status"
     aria-live="polite"
     hidden></p>
  <button class="btn btn-outline admin-retry-btn"
          id="moderation-retry-btn"
          type="button"
          hidden>
    <i class="ti ti-refresh"></i> Try again
  </button>
</div>
```

Replace the review overlay/card opening tags with:

```html
<div class="modal-overlay" id="review-overlay" aria-hidden="true">
  <div class="modal-card"
       id="review-card"
       role="dialog"
       aria-modal="true"
       aria-label="Portfolio review"
       tabindex="-1"></div>
</div>
```

Add this region between `reason-textarea` and `reason-footer`:

```html
<div class="form-message reason-error"
     id="reason-error"
     role="alert"
     aria-live="assertive"></div>
```

Replace the three local dependency URLs with:

```html
<link rel="stylesheet" href="css/style.css?v=20260723.4" />
<script src="js/api.js?v=20260723.4"></script>
<script src="js/moderatordashboard.js?v=20260723.4"></script>
```

- [ ] **Step 4: Add narrowly scoped status and modal styles**

Add this block at the end of the existing administrator styles:

```css
.admin-section-feedback {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  min-width: 0;
}

.admin-dashboard-status {
  margin: 0;
  padding: 8px 10px;
}

.admin-dashboard-status.stale {
  border-color: #FCD34D;
  background: #FFFBEB;
  color: #92400E;
}

.admin-retry-btn {
  flex: 0 0 auto;
  min-height: 36px;
}

.admin-retry-btn[hidden],
.admin-dashboard-status[hidden] {
  display: none;
}

.admin-row-state td {
  padding: 30px 16px;
  color: var(--text-secondary);
  text-align: center;
}

.admin-row-state.error td {
  color: var(--red-text);
}

.btn-review:disabled,
.btn-reject-outline:disabled,
.btn-approve-solid:disabled,
.btn-cancel-outline:disabled,
.btn-confirm-reject:disabled {
  cursor: not-allowed;
  opacity: 0.58;
}

.modal-card:focus-visible {
  outline: 3px solid rgba(67, 97, 238, 0.35);
  outline-offset: 3px;
}

.modal-error-state {
  padding: 12px 0 4px;
}

.modal-error-state h2 {
  margin-bottom: 8px;
}

.modal-error-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 20px;
}

.modal-action-status {
  min-height: 20px;
  margin-right: auto;
  color: var(--text-secondary);
  font-size: 13px;
}

.modal-action-status.error {
  color: var(--red-text);
}

.reason-error {
  margin: 10px 0 0;
}

@media (max-width: 720px) {
  .admin-section-feedback {
    align-items: stretch;
    flex-direction: column;
  }
}
```

- [ ] **Step 5: Run the contract and syntax checks**

Run:

```bash
cd backend
node --test --test-name-pattern="administrator dashboard exposes recoverable" test/frontend-flow-contract.test.js
node --check ../js/moderatordashboard.js
```

Expected: both commands PASS.

- [ ] **Step 6: Commit the shell**

```bash
git add backend/test/frontend-flow-contract.test.js moderatordashboard.html css/style.css
git commit -m "feat: add recoverable admin dashboard shell"
```

---

### Task 2: Build the VM Harness and Independent Section Loaders

**Files:**
- Create: `backend/test/helpers/admin-dashboard-harness.js`
- Create: `backend/test/admin-dashboard-client.test.js`
- Modify: `js/moderatordashboard.js`

**Interfaces:**
- Consumes: `API.getStats()`, `API.getQueue()`, `API.getRelationshipManagers()`, `requirePageRole("admin")`, and Task 1 status IDs.
- Produces:
  - `loadModeration(options?: {successMessage?: string, failureMessage?: string}): Promise<boolean>`
  - `loadManagerDirectory(options?: {successMessage?: string, failureMessage?: string}): Promise<boolean>`
  - `setSectionStatus(statusId, retryId, message, options): void`
  - `renderModerationSnapshot(stats, queue, options): void`
  - `renderRelationshipManagers(managers): void`
  - latest-request-wins counters `moderationRequestVersion` and `managerRequestVersion`
  - reusable test exports `adminHarness`, `deferred`, and `flush`.

- [ ] **Step 1: Create the dependency-free browser-client harness**

Create `backend/test/helpers/admin-dashboard-harness.js` with these concrete
behaviors:

```js
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..', '..', '..');
const source = fs.readFileSync(path.join(root, 'js', 'moderatordashboard.js'), 'utf8');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

class FakeClassList {
  constructor() {
    this.values = new Set();
  }
  add(...names) {
    names.forEach((name) => this.values.add(name));
  }
  remove(...names) {
    names.forEach((name) => this.values.delete(name));
  }
  contains(name) {
    return this.values.has(name);
  }
  toggle(name, force) {
    const next = force === undefined ? !this.values.has(name) : Boolean(force);
    if (next) this.values.add(name);
    else this.values.delete(name);
    return next;
  }
}

class FakeElement {
  constructor(id, ownerDocument) {
    this.id = id;
    this.ownerDocument = ownerDocument;
    this.classList = new FakeClassList();
    this.className = '';
    this.dataset = {};
    this.hidden = false;
    this.disabled = false;
    this.innerHTML = '';
    this.innerText = '';
    this.textContent = '';
    this.value = '';
    this.children = [];
    this.listeners = new Map();
    this.attributes = new Map();
  }
  addEventListener(type, handler) {
    const list = this.listeners.get(type) || [];
    list.push(handler);
    this.listeners.set(type, list);
  }
  async dispatch(type, overrides = {}) {
    if (type === 'click' && (this.disabled || this.hidden)) return;
    const event = {
      type,
      target: overrides.target || this,
      preventDefault() {},
      ...overrides,
    };
    for (const handler of this.listeners.get(type) || []) await handler(event);
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }
  closest(selector) {
    if (selector === '.form-group') return this.formGroup || this;
    if (selector === '[data-portfolio-id]' && this.dataset.portfolioId != null) return this;
    if (selector === '[data-review-action]' && this.dataset.reviewAction != null) return this;
    if (selector === '[data-document-download]' && this.dataset.documentDownload != null) return this;
    return null;
  }
  focus() {
    this.ownerDocument.activeElement = this;
  }
  contains(element) {
    return this === element || this.children.includes(element);
  }
}

function adminHarness(overrides = {}) {
  const elements = new Map();
  const document = {
    activeElement: null,
    listeners: new Map(),
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, new FakeElement(id, document));
      return elements.get(id);
    },
    addEventListener(type, handler) {
      const list = this.listeners.get(type) || [];
      list.push(handler);
      this.listeners.set(type, list);
    },
    async dispatch(type, event) {
      for (const handler of this.listeners.get(type) || []) await handler(event);
    },
  };

  const calls = Object.fromEntries([
    'getStats',
    'getQueue',
    'getRelationshipManagers',
    'createRelationshipManager',
    'getPortfolio',
    'approvePortfolio',
    'rejectPortfolio',
    'downloadDocument',
  ].map((name) => [name, []]));

  const defaults = {
    getStats: async () => ({ pending: 1, approved: 2, rejected: 0, total_matches: 3 }),
    getQueue: async () => [{
      id: 42,
      name: 'New Company',
      owner_name: 'Owner',
      sector: 'Technology',
      submitted_at: '2026-07-23T00:00:00.000Z',
      readiness_score: 60,
      monthly_revenue: null,
      user_count: null,
      growth_rate: null,
      market_size: null,
      competitor_analysis: null,
      advisor_names: null,
      burn_rate: null,
      runway_months: null,
    }],
    getRelationshipManagers: async () => [],
    createRelationshipManager: async () => ({ id: 8 }),
    getPortfolio: async (id) => ({
      id,
      name: 'New Company',
      sector: 'Technology',
      mvp_status: 'Beta',
      funding_goal: 100000,
      readiness_score: 60,
      documents: [],
    }),
    approvePortfolio: async () => ({}),
    rejectPortfolio: async () => ({}),
    downloadDocument: async () => {},
  };

  const api = {};
  for (const [name, fallback] of Object.entries(defaults)) {
    api[name] = async (...args) => {
      calls[name].push(args);
      return (overrides[name] || fallback)(...args);
    };
  }

  const sandbox = {
    API: api,
    document,
    window: { location: { href: '' } },
    requirePageRole: async () => ({ id: 1, name: 'Victor', role: 'admin' }),
    showScoreInfo() {},
    signOut() {},
    alert() {},
    console,
    setTimeout,
    clearTimeout,
  };
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);
  const instrumented = source.replace(
    /\ninitAdmin\(\);\s*$/,
    '\nglobalThis.__adminInitPromise = initAdmin();',
  );
  vm.runInContext(instrumented, context, { filename: 'js/moderatordashboard.js' });

  return {
    api,
    calls,
    context,
    document,
    element: (id) => document.getElementById(id),
    init: () => context.__adminInitPromise,
    run: (code) => vm.runInContext(code, context),
  };
}

module.exports = { adminHarness, deferred, flush };
```

- [ ] **Step 2: Write failing independent-section tests**

Create `backend/test/admin-dashboard-client.test.js` with:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { adminHarness, deferred, flush } = require('./helpers/admin-dashboard-harness');

test('manager failure does not blank a successful moderation section', async () => {
  const client = adminHarness({
    getRelationshipManagers: async () => {
      throw new Error('directory offline');
    },
  });

  await client.init();

  assert.equal(client.element('stat-pending').innerText, 1);
  assert.match(client.element('queue-list').innerHTML, /New Company/);
  assert.match(client.element('manager-directory-status').textContent, /directory/i);
  assert.equal(client.element('manager-directory-retry-btn').hidden, false);
  assert.equal(client.element('rm-submit').disabled, false);
});

test('first moderation failure shows placeholders while manager directory remains usable', async () => {
  const client = adminHarness({
    getStats: async () => {
      throw new Error('stats offline');
    },
    getRelationshipManagers: async () => [{
      name: 'Manager',
      email: 'manager@example.com',
      role: 'relationship_manager',
      created_at: '2026-07-23T00:00:00.000Z',
    }],
  });

  await client.init();

  assert.equal(client.element('stat-pending').innerText, '—');
  assert.match(client.element('queue-list').innerHTML, /couldn.t load/i);
  assert.match(client.element('rm-account-list').innerHTML, /Manager/);
  assert.equal(client.element('rm-submit').disabled, false);
});

test('empty moderation retains stats and renders an intentional queue row', async () => {
  const client = adminHarness({ getQueue: async () => [] });
  await client.init();

  assert.equal(client.element('stat-approved').innerText, 2);
  assert.match(client.element('queue-list').innerHTML, /No portfolios are waiting for review/);
  assert.match(client.element('rm-account-list').innerHTML, /No relationship manager accounts/);
});

test('initial requests expose section-scoped loading without disabling account creation', async () => {
  const stats = deferred();
  const queue = deferred();
  const managers = deferred();
  const client = adminHarness({
    getStats: async () => stats.promise,
    getQueue: async () => queue.promise,
    getRelationshipManagers: async () => managers.promise,
  });

  const initial = client.init();
  await flush();
  assert.match(client.element('moderation-status').textContent, /Loading moderation/i);
  assert.match(client.element('queue-list').innerHTML, /Loading portfolios/i);
  assert.match(client.element('manager-directory-status').textContent, /Loading manager/i);
  assert.match(client.element('rm-account-list').innerHTML, /Loading manager accounts/i);
  assert.equal(client.element('rm-submit').disabled, false);

  stats.resolve({ pending: 0, approved: 2, rejected: 0, total_matches: 3 });
  queue.resolve([]);
  managers.resolve([]);
  await initial;
});

test('failed moderation refresh preserves one visibly stale disabled snapshot', async () => {
  const client = adminHarness();
  await client.init();
  client.api.getStats = async () => {
    throw new Error('refresh offline');
  };

  assert.equal(await client.run('loadModeration()'), false);
  assert.match(client.element('moderation-status').className, /stale/);
  assert.match(client.element('moderation-status').textContent, /last loaded/i);
  assert.match(client.element('queue-list').innerHTML, /disabled/);
  assert.match(client.element('queue-list').innerHTML, /New Company/);
});

test('moderation retry refreshes only moderation and ignores an older response', async () => {
  const oldStats = deferred();
  const oldQueue = deferred();
  let statsCalls = 0;
  let queueCalls = 0;
  const client = adminHarness({
    getStats: async () => (++statsCalls === 1 ? oldStats.promise : {
      pending: 1, approved: 9, rejected: 0, total_matches: 3,
    }),
    getQueue: async () => (++queueCalls === 1 ? oldQueue.promise : [{
      id: 99,
      name: 'Newest',
      owner_name: 'Owner',
      sector: 'Health',
      submitted_at: null,
      readiness_score: 70,
    }]),
  });

  const initial = client.init();
  await flush();
  const retry = client.run('loadModeration()');
  await retry;
  oldStats.resolve({ pending: 1, approved: 1, rejected: 0, total_matches: 1 });
  oldQueue.resolve([{ id: 1, name: 'Old', owner_name: 'Old', sector: 'Old' }]);
  await initial;

  assert.equal(client.element('stat-approved').innerText, 9);
  assert.match(client.element('queue-list').innerHTML, /Newest/);
  assert.doesNotMatch(client.element('queue-list').innerHTML, /Old/);
});

test('manager directory ignores an older response and marks a failed refresh stale', async () => {
  const oldManagers = deferred();
  let managerCalls = 0;
  const client = adminHarness({
    getRelationshipManagers: async () => {
      managerCalls += 1;
      if (managerCalls === 1) return oldManagers.promise;
      return [{
        name: 'Newest Manager',
        email: 'newest@example.com',
        role: 'relationship_manager',
      }];
    },
  });

  const initial = client.init();
  await flush();
  await client.run('loadManagerDirectory()');
  oldManagers.resolve([{
    name: 'Old Manager',
    email: 'old@example.com',
    role: 'relationship_manager',
  }]);
  await initial;
  assert.match(client.element('rm-account-list').innerHTML, /Newest Manager/);
  assert.doesNotMatch(client.element('rm-account-list').innerHTML, /Old Manager/);

  client.api.getRelationshipManagers = async () => {
    throw new Error('directory refresh offline');
  };
  assert.equal(await client.run('loadManagerDirectory()'), false);
  assert.match(client.element('manager-directory-status').className, /stale/);
  assert.match(client.element('rm-account-list').innerHTML, /Newest Manager/);
});
```

- [ ] **Step 3: Run the new tests and verify red**

Run:

```bash
cd backend
node --test test/admin-dashboard-client.test.js
```

Expected: FAIL because `renderAdmin()` still uses one all-or-nothing
`Promise.all`.

- [ ] **Step 4: Implement independent versioned loaders**

In `js/moderatordashboard.js`, add these state values beside the existing
globals:

```js
let currentStats = null;
let hasModerationSnapshot = false;
let hasManagerSnapshot = false;
let moderationRequestVersion = 0;
let managerRequestVersion = 0;
```

Add these helpers before `bindRelationshipManagerForm`:

```js
function setSectionStatus(statusId, retryId, message, {
  type = '',
  retryable = false,
  loading = false,
} = {}) {
  const status = document.getElementById(statusId);
  const retry = document.getElementById(retryId);
  if (status) {
    status.textContent = message;
    status.className = `dashboard-status admin-dashboard-status${type ? ` ${type}` : ''}`;
    status.hidden = !message;
  }
  if (retry) {
    retry.hidden = !retryable;
    retry.disabled = loading;
  }
}

function renderStats(stats) {
  const values = stats
    ? {
        'nav-pending-badge': stats.pending,
        'stat-pending': stats.pending,
        'stat-approved': stats.approved,
        'stat-rejected': stats.rejected,
        'stat-matches': stats.total_matches,
        'queue-badge': `${stats.pending} pending`,
      }
    : {
        'nav-pending-badge': '',
        'stat-pending': '—',
        'stat-approved': '—',
        'stat-rejected': '—',
        'stat-matches': '—',
        'queue-badge': 'Unavailable',
      };
  for (const [id, value] of Object.entries(values)) {
    document.getElementById(id).innerText = value;
  }
}

function queueStateRow(message, type = '') {
  return `<tr class="admin-row-state${type ? ` ${type}` : ''}"><td colspan="6">${escapeHtml(message)}</td></tr>`;
}

function renderQueue(queue, { reviewDisabled = false } = {}) {
  const tbody = document.getElementById('queue-list');
  if (!queue.length) {
    tbody.innerHTML = queueStateRow('No portfolios are waiting for review.');
    return;
  }
  tbody.innerHTML = queue.map((p) => {
    const submitted = formatSubmitted(p.submitted_at);
    return `
      <tr>
        <td>
          <div class="startup-cell">
            <div class="startup-icon"><i class="ti ti-building"></i></div>
            <div>
              <div class="startup-name">${escapeHtml(p.name)}</div>
              <div class="startup-owner">${escapeHtml(p.owner_name)}</div>
            </div>
          </div>
        </td>
        <td>${escapeHtml(p.sector)}</td>
        <td>
          <div>${submitted.date}</div>
          <div style="color: var(--text-secondary); font-size: 12px;">${submitted.time}</div>
        </td>
        <td>
          <div class="status-wrapper">
            <span class="badge-yellow">Pending Review</span>
            <i class="ti ti-alert-triangle" style="color: var(--amber-text)"></i>
          </div>
        </td>
        <td>
          <div style="display:flex;align-items:center;gap:6px;">
            <div class="score-circle" style="--score:${Number(p.readiness_score) || 0};"><span>${escapeHtml(p.readiness_score ?? 0)}</span></div>
            ${isScoreStale(p) ? '<i class="ti ti-alert-triangle" style="color:#F59E0B;font-size:15px;" title="Score may be outdated — new readiness fields are empty"></i>' : ''}
          </div>
        </td>
        <td>
          <button class="btn-review"
                  data-portfolio-id="${escapeHtml(p.id)}"
                  onclick="openReviewModal(${Number(p.id)})"
                  type="button"
                  ${reviewDisabled ? 'disabled' : ''}>
            <i class="ti ti-eye"></i> Review
          </button>
        </td>
      </tr>`;
  }).join('');
}

function renderModerationSnapshot(stats, queue, options = {}) {
  renderStats(stats);
  renderQueue(queue, options);
}
```

Change `renderRelationshipManagers` to accept its list explicitly:

```js
function renderRelationshipManagers(managers = relationshipManagers) {
  const list = document.getElementById('rm-account-list');
  document.getElementById('rm-account-count').textContent =
    `${managers.length} ${managers.length === 1 ? 'account' : 'accounts'}`;
  if (!managers.length) {
    list.innerHTML =
      '<tr class="rm-empty-row"><td colspan="3">No relationship manager accounts yet.</td></tr>';
    return;
  }
  list.innerHTML = managers.map((manager) => {
    const created = manager.created_at
      ? new Date(manager.created_at).toLocaleDateString('en-SG', {
          day: 'numeric', month: 'short', year: 'numeric',
        })
      : '—';
    return `
      <tr>
        <td>
          <span class="rm-account-name">${escapeHtml(manager.name)}</span>
          <span class="rm-account-role">${escapeHtml(manager.role.replaceAll('_', ' '))}</span>
        </td>
        <td>${escapeHtml(manager.email)}</td>
        <td>${escapeHtml(created)}</td>
      </tr>`;
  }).join('');
}
```

Replace `renderAdmin` with the following three functions:

```js
async function loadModeration({
  successMessage = '',
  failureMessage = "Couldn't load moderation data. Try again.",
} = {}) {
  const requestVersion = ++moderationRequestVersion;
  const hadSnapshot = hasModerationSnapshot;
  setSectionStatus(
    'moderation-status',
    'moderation-retry-btn',
    hadSnapshot ? 'Refreshing moderation data…' : 'Loading moderation data…',
    { type: 'loading', loading: true },
  );
  if (hadSnapshot) {
    renderModerationSnapshot(currentStats, currentQueue, { reviewDisabled: true });
  } else {
    renderStats(null);
    document.getElementById('queue-list').innerHTML = queueStateRow('Loading portfolios…');
  }

  try {
    const [nextStats, nextQueue] = await Promise.all([API.getStats(), API.getQueue()]);
    if (requestVersion !== moderationRequestVersion) return false;
    if (!nextStats || typeof nextStats !== 'object' || !Array.isArray(nextQueue)) {
      throw new Error('Invalid moderation response');
    }
    currentStats = nextStats;
    currentQueue = nextQueue;
    hasModerationSnapshot = true;
    renderModerationSnapshot(currentStats, currentQueue);
    setSectionStatus(
      'moderation-status',
      'moderation-retry-btn',
      successMessage,
      { type: successMessage ? 'success' : '' },
    );
    return true;
  } catch (error) {
    if (requestVersion !== moderationRequestVersion) return false;
    if (hadSnapshot) {
      renderModerationSnapshot(currentStats, currentQueue, { reviewDisabled: true });
      setSectionStatus(
        'moderation-status',
        'moderation-retry-btn',
        `${failureMessage} Showing the last loaded data.`,
        { type: 'stale', retryable: true },
      );
    } else {
      renderStats(null);
      document.getElementById('queue-list').innerHTML =
        queueStateRow("Couldn't load the moderation queue.", 'error');
      setSectionStatus(
        'moderation-status',
        'moderation-retry-btn',
        failureMessage,
        { type: 'error', retryable: true },
      );
    }
    return false;
  }
}

async function loadManagerDirectory({
  successMessage = '',
  failureMessage = "Couldn't load relationship managers. Try again.",
} = {}) {
  const requestVersion = ++managerRequestVersion;
  const hadSnapshot = hasManagerSnapshot;
  setSectionStatus(
    'manager-directory-status',
    'manager-directory-retry-btn',
    hadSnapshot ? 'Refreshing manager directory…' : 'Loading manager directory…',
    { type: 'loading', loading: true },
  );
  if (!hadSnapshot) {
    document.getElementById('rm-account-list').innerHTML =
      '<tr class="rm-empty-row"><td colspan="3">Loading manager accounts…</td></tr>';
  }

  try {
    const managers = await API.getRelationshipManagers();
    if (requestVersion !== managerRequestVersion) return false;
    if (!Array.isArray(managers)) throw new Error('Invalid manager response');
    relationshipManagers = managers;
    hasManagerSnapshot = true;
    renderRelationshipManagers(relationshipManagers);
    setSectionStatus(
      'manager-directory-status',
      'manager-directory-retry-btn',
      successMessage,
      { type: successMessage ? 'success' : '' },
    );
    return true;
  } catch (error) {
    if (requestVersion !== managerRequestVersion) return false;
    if (!hadSnapshot) {
      document.getElementById('rm-account-list').innerHTML =
        '<tr class="rm-empty-row"><td colspan="3">Manager directory unavailable.</td></tr>';
    }
    setSectionStatus(
      'manager-directory-status',
      'manager-directory-retry-btn',
      hadSnapshot ? `${failureMessage} Showing the last loaded directory.` : failureMessage,
      { type: hadSnapshot ? 'stale' : 'error', retryable: true },
    );
    return false;
  }
}

async function renderAdmin() {
  await Promise.allSettled([loadModeration(), loadManagerDirectory()]);
}
```

Add section Retry listeners once in `initAdmin`, immediately before
`renderAdmin()`:

```js
document.getElementById('moderation-retry-btn')
  ?.addEventListener('click', () => loadModeration());
document.getElementById('manager-directory-retry-btn')
  ?.addEventListener('click', () => loadManagerDirectory());
```

Keep the existing Review and relationship-manager submit behavior working
during this task; the inline Review handler is removed in Task 4.

- [ ] **Step 5: Run the independent-section tests**

Run:

```bash
cd backend
node --test test/admin-dashboard-client.test.js
node --check ../js/moderatordashboard.js
```

Expected: all tests PASS.

- [ ] **Step 6: Commit independent loading**

```bash
git add backend/test/helpers/admin-dashboard-harness.js backend/test/admin-dashboard-client.test.js js/moderatordashboard.js
git commit -m "feat: isolate admin dashboard data sections"
```

---

### Task 3: Make Relationship-Manager Creation Single-Flight and Recoverable

**Files:**
- Modify: `backend/test/admin-dashboard-client.test.js`
- Modify: `js/moderatordashboard.js`

**Interfaces:**
- Consumes: Task 2 `loadManagerDirectory`, `setRmFormMessage`, and existing API creation contract.
- Produces: `managerCreateInFlight: boolean` and a form handler that distinguishes POST failure from POST-success/GET-failure.

- [ ] **Step 1: Add failing creation lifecycle tests**

Append:

```js
test('manager creation is single-flight and preserves fields while pending', async () => {
  const create = deferred();
  const client = adminHarness({
    createRelationshipManager: async () => create.promise,
  });
  await client.init();
  client.element('rm-name').value = 'New Manager';
  client.element('rm-email').value = 'new.manager@example.com';
  client.element('rm-password').value = '123456';

  const first = client.element('rm-account-form').dispatch('submit');
  const second = client.element('rm-account-form').dispatch('submit');
  await flush();

  assert.equal(client.calls.createRelationshipManager.length, 1);
  assert.equal(client.element('rm-submit').disabled, true);
  assert.equal(client.element('rm-name').value, 'New Manager');
  assert.equal(client.element('rm-email').value, 'new.manager@example.com');
  create.resolve({ id: 10 });
  await Promise.all([first, second]);
});

test('created account plus failed directory refresh retries GET without repeating POST', async () => {
  let directoryCalls = 0;
  const client = adminHarness({
    getRelationshipManagers: async () => {
      directoryCalls += 1;
      if (directoryCalls === 1) return [];
      if (directoryCalls === 2) throw new Error('refresh failed');
      return [{
        name: 'New Manager',
        email: 'new.manager@example.com',
        role: 'relationship_manager',
      }];
    },
  });
  await client.init();
  client.element('rm-name').value = 'New Manager';
  client.element('rm-email').value = 'new.manager@example.com';
  client.element('rm-password').value = '123456';

  await client.element('rm-account-form').dispatch('submit');
  assert.equal(client.calls.createRelationshipManager.length, 1);
  assert.match(client.element('rm-form-message').textContent, /created.*could not refresh/i);
  assert.equal(client.element('rm-password').value, '');

  await client.element('manager-directory-retry-btn').dispatch('click');
  assert.equal(client.calls.createRelationshipManager.length, 1);
  assert.equal(client.calls.getRelationshipManagers.length, 3);
  assert.match(client.element('rm-account-list').innerHTML, /New Manager/);
});

test('manager creation failure keeps every entered field and restores submit', async () => {
  const client = adminHarness({
    createRelationshipManager: async () => {
      throw new Error('email already exists');
    },
  });
  await client.init();
  client.element('rm-name').value = 'New Manager';
  client.element('rm-email').value = 'new.manager@example.com';
  client.element('rm-password').value = '123456';

  await client.element('rm-account-form').dispatch('submit');

  assert.equal(client.element('rm-name').value, 'New Manager');
  assert.equal(client.element('rm-email').value, 'new.manager@example.com');
  assert.equal(client.element('rm-password').value, '123456');
  assert.equal(client.element('rm-submit').disabled, false);
  assert.match(client.element('rm-form-message').textContent, /already exists/i);
});
```

- [ ] **Step 2: Verify the new tests fail**

Run:

```bash
cd backend
node --test --test-name-pattern="manager creation|created account" test/admin-dashboard-client.test.js
```

Expected: FAIL because duplicate submit handlers call the POST twice and the
existing combined try/catch cannot distinguish a successful POST from a failed
directory refresh.

- [ ] **Step 3: Replace the relationship-manager form handler**

Add:

```js
let managerCreateInFlight = false;
```

Replace `bindRelationshipManagerForm` with:

```js
function bindRelationshipManagerForm() {
  const form = document.getElementById('rm-account-form');
  const rmSubmit = document.getElementById('rm-submit');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (managerCreateInFlight) return;

    const name = document.getElementById('rm-name');
    const email = document.getElementById('rm-email');
    const password = document.getElementById('rm-password');
    const cleanName = name.value.trim();
    const cleanEmail = email.value.trim();
    let valid = true;

    setRmFormMessage('');
    setRmFieldError('rm-name', '');
    setRmFieldError('rm-email', '');
    setRmFieldError('rm-password', '');
    if (!cleanName) {
      setRmFieldError('rm-name', 'Full name is required.');
      valid = false;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setRmFieldError('rm-email', 'Enter a valid email address.');
      valid = false;
    }
    if (password.value.length < 6 || password.value.length > 128) {
      setRmFieldError('rm-password', 'Use between 6 and 128 characters.');
      valid = false;
    }
    if (!valid) {
      setRmFormMessage('Please fix the highlighted fields.', 'error');
      return;
    }

    managerCreateInFlight = true;
    rmSubmit.disabled = true;
    rmSubmit.innerHTML = '<i class="ti ti-loader-2"></i> Creating account…';
    try {
      await API.createRelationshipManager({
        name: cleanName,
        email: cleanEmail,
        password: password.value,
      });
      password.value = '';
    } catch (error) {
      setRmFormMessage(error.message, 'error');
      return;
    } finally {
      managerCreateInFlight = false;
      rmSubmit.disabled = false;
      rmSubmit.innerHTML = '<i class="ti ti-user-plus"></i> Create manager account';
    }

    const refreshed = await loadManagerDirectory({
      successMessage: 'Manager directory updated.',
      failureMessage: 'Account created, but the manager directory could not refresh.',
    });
    setRmFormMessage(
      refreshed
        ? 'Relationship manager account created.'
        : 'Relationship manager account created, but the directory could not refresh.',
      'success',
    );
  });
}
```

The `finally` intentionally ends POST single-flight before the independent GET
begins. The form is usable during a directory failure, while the directory's
own request-version guard prevents stale GET commits.

- [ ] **Step 4: Run focused and accumulated tests**

Run:

```bash
cd backend
node --test test/admin-dashboard-client.test.js
```

Expected: all accumulated administrator client tests PASS.

- [ ] **Step 5: Commit account creation recovery**

```bash
git add backend/test/admin-dashboard-client.test.js js/moderatordashboard.js
git commit -m "fix: recover admin manager account creation"
```

---

### Task 4: Replace Inline Review With a Recoverable Modal State Machine

**Files:**
- Modify: `backend/test/admin-dashboard-client.test.js`
- Modify: `backend/test/frontend-flow-contract.test.js`
- Modify: `js/moderatordashboard.js`

**Interfaces:**
- Consumes: Task 2 `currentQueue`, `loadModeration`, status helpers, review HTML/CSS shell, `API.getPortfolio`, and `API.downloadDocument`.
- Produces:
  - `normalizePortfolioId(value): number | null`
  - `openReviewModal(rawId, trigger): Promise<boolean>`
  - `loadReviewDetails(id): Promise<boolean>`
  - `closeReviewModal(): boolean`
  - `reviewRequestVersion`, `reviewLoadInFlight`, and `activeReviewTrigger`
  - generated controls using `data-review-action`.

- [ ] **Step 1: Add failing Review interaction tests**

Append:

```js
test('delegated Review normalizes a string ID and opens loading before detail resolves', async () => {
  const detail = deferred();
  const client = adminHarness({
    getQueue: async () => [{
      id: '42',
      name: 'String ID Company',
      owner_name: 'Owner',
      sector: 'Technology',
      readiness_score: 60,
    }],
    getPortfolio: async () => detail.promise,
  });
  await client.init();
  const trigger = client.element('review-trigger');
  trigger.dataset.portfolioId = '42';

  const click = client.element('queue-list').dispatch('click', { target: trigger });
  await flush();

  assert.equal(client.calls.getPortfolio.length, 1);
  assert.equal(client.calls.getPortfolio[0][0], 42);
  assert.equal(client.element('review-overlay').classList.contains('open'), true);
  assert.match(client.element('review-card').innerHTML, /Loading portfolio/);
  assert.equal(client.document.activeElement, client.element('review-card'));

  detail.resolve({
    id: 42,
    name: 'String ID Company',
    sector: 'Technology',
    mvp_status: 'Beta',
    funding_goal: 100000,
    readiness_score: 60,
    documents: [],
  });
  await click;
  assert.match(client.element('review-card').innerHTML, /Approve/);
});

test('invalid or missing queue ID shows visible moderation recovery without a detail call', async () => {
  const client = adminHarness();
  await client.init();
  const trigger = client.element('invalid-review-trigger');
  trigger.dataset.portfolioId = '999';

  await client.element('queue-list').dispatch('click', { target: trigger });

  assert.equal(client.calls.getPortfolio.length, 0);
  assert.match(client.element('moderation-status').textContent, /no longer available/i);
  assert.equal(client.element('moderation-retry-btn').hidden, false);
});

test('detail failure stays open with single-flight Try again and Close', async () => {
  const retry = deferred();
  let detailCalls = 0;
  const client = adminHarness({
    getPortfolio: async () => {
      detailCalls += 1;
      if (detailCalls === 1) throw new Error('detail offline');
      return retry.promise;
    },
  });
  await client.init();
  await client.run("openReviewModal(42, document.getElementById('review-trigger'))");
  assert.match(client.element('review-card').innerHTML, /Try again/);
  assert.equal(client.element('review-overlay').classList.contains('open'), true);

  const retryButton = client.element('review-retry');
  retryButton.dataset.reviewAction = 'retry';
  const first = client.element('review-card').dispatch('click', { target: retryButton });
  const second = client.element('review-card').dispatch('click', { target: retryButton });
  await flush();
  assert.equal(client.calls.getPortfolio.length, 2);

  retry.resolve({
    id: 42,
    name: 'Recovered',
    sector: 'Technology',
    mvp_status: 'Beta',
    funding_goal: 100000,
    readiness_score: 60,
    documents: [],
  });
  await Promise.all([first, second]);
});

test('closed review ignores a late response and restores trigger focus', async () => {
  const detail = deferred();
  const client = adminHarness({ getPortfolio: async () => detail.promise });
  await client.init();
  const trigger = client.element('review-trigger');

  const opening = client.run("openReviewModal(42, document.getElementById('review-trigger'))");
  await flush();
  client.run('closeReviewModal()');
  detail.resolve({
    id: 42,
    name: 'Late',
    sector: 'Technology',
    mvp_status: 'Beta',
    funding_goal: 100000,
    readiness_score: 60,
    documents: [],
  });
  await opening;

  assert.equal(client.element('review-overlay').classList.contains('open'), false);
  assert.doesNotMatch(client.element('review-card').innerHTML, /Late/);
  assert.equal(client.document.activeElement, trigger);
});

test('malformed detail enters the same recoverable modal error state', async () => {
  const client = adminHarness({
    getPortfolio: async () => ({ id: 42, name: 'Broken', documents: null }),
  });
  await client.init();
  await client.run('openReviewModal(42)');

  assert.equal(client.element('review-overlay').classList.contains('open'), true);
  assert.match(client.element('review-card').innerHTML, /couldn.t display/i);
});
```

Extend the administrator frontend contract with:

```js
test('administrator queue Review uses delegated data attributes without inline calls', () => {
  const client = read('js/moderatordashboard.js');
  assert.match(client, /data-portfolio-id=/);
  assert.match(client, /queue-list['"]\)\.addEventListener\(['"]click/);
  assert.doesNotMatch(client, /onclick=["']openReviewModal/);
});
```

- [ ] **Step 2: Run the Review tests and verify red**

Run:

```bash
cd backend
node --test --test-name-pattern="Review|detail|review" test/admin-dashboard-client.test.js test/frontend-flow-contract.test.js
```

Expected: FAIL because the current generated button is inline, strict equality
silently misses string IDs, and detail errors close the modal.

- [ ] **Step 3: Add normalized delegated Review binding**

Add state:

```js
let reviewRequestVersion = 0;
let reviewLoadInFlight = false;
let activeReviewTrigger = null;
let activeReviewPortfolio = null;
```

Add:

```js
function normalizePortfolioId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}
```

In `renderQueue`, replace the Review button with:

```html
<button class="btn-review"
        data-portfolio-id="${escapeHtml(p.id)}"
        type="button"
        ${reviewDisabled ? 'disabled' : ''}>
  <i class="ti ti-eye"></i> Review
</button>
```

Bind the stable queue container once in `initAdmin`:

```js
document.getElementById('queue-list').addEventListener('click', (event) => {
  const trigger = event.target.closest('[data-portfolio-id]');
  if (!trigger || trigger.disabled) return;
  openReviewModal(trigger.dataset.portfolioId, trigger);
});
```

- [ ] **Step 4: Replace review open/load/close with guarded states**

Replace `openReviewModal` and `closeReviewModal` with:

```js
function setReviewOverlayOpen(open) {
  const overlay = document.getElementById('review-overlay');
  overlay.classList.toggle('open', open);
  overlay.setAttribute('aria-hidden', String(!open));
}

function renderReviewLoading() {
  document.getElementById('review-card').innerHTML = `
    <div class="modal-error-state" role="status" aria-live="polite">
      <h2>Loading portfolio…</h2>
      <p class="modal-subtitle">Retrieving the latest submitted details.</p>
    </div>`;
}

function renderReviewError(message) {
  document.getElementById('review-card').innerHTML = `
    <div class="modal-error-state" role="alert">
      <h2>Couldn't display this portfolio</h2>
      <p class="modal-subtitle">${escapeHtml(message)}</p>
      <div class="modal-error-actions">
        <button class="btn btn-outline"
                id="review-close"
                data-review-action="close"
                type="button">Close</button>
        <button class="btn btn-primary"
                id="review-retry"
                data-review-action="retry"
                type="button">Try again</button>
      </div>
    </div>`;
}

function validatePortfolioDetail(detail, expectedId) {
  if (
    !detail ||
    typeof detail !== 'object' ||
    normalizePortfolioId(detail.id) !== expectedId ||
    !Array.isArray(detail.documents)
  ) {
    throw new Error('The server returned incomplete portfolio details.');
  }
}

async function loadReviewDetails(id) {
  if (reviewLoadInFlight) return false;
  const requestVersion = ++reviewRequestVersion;
  reviewLoadInFlight = true;
  renderReviewLoading();
  try {
    const detail = await API.getPortfolio(id);
    if (requestVersion !== reviewRequestVersion || activeReviewId !== id) return false;
    validatePortfolioDetail(detail, id);
    renderReviewDetails(detail, activeReviewPortfolio);
    return true;
  } catch (error) {
    if (requestVersion !== reviewRequestVersion || activeReviewId !== id) return false;
    renderReviewError(error.message || 'Portfolio details are unavailable.');
    return false;
  } finally {
    if (requestVersion === reviewRequestVersion) reviewLoadInFlight = false;
  }
}

async function openReviewModal(rawId, trigger = null) {
  const id = normalizePortfolioId(rawId);
  const portfolio = currentQueue.find((item) => normalizePortfolioId(item.id) === id);
  if (!id || !portfolio) {
    setSectionStatus(
      'moderation-status',
      'moderation-retry-btn',
      'That portfolio is no longer available in the moderation queue.',
      { type: 'error', retryable: true },
    );
    return false;
  }

  activeReviewId = id;
  activeReviewPortfolio = portfolio;
  activeReviewTrigger = trigger;
  renderReviewLoading();
  setReviewOverlayOpen(true);
  document.getElementById('review-card').focus();
  return loadReviewDetails(id);
}

function closeReviewModal() {
  if (decisionInFlight) return false;
  reviewRequestVersion += 1;
  reviewLoadInFlight = false;
  activeReviewId = null;
  activeReviewPortfolio = null;
  setReviewOverlayOpen(false);
  document.getElementById('review-card').innerHTML = '';
  const trigger = activeReviewTrigger;
  activeReviewTrigger = null;
  if (trigger && !trigger.disabled) trigger.focus();
  return true;
}
```

Declare `let decisionInFlight = false;` now; Task 5 supplies its mutation
behavior.

- [ ] **Step 5: Extract the existing detail template into `renderReviewDetails`**

Wrap the current company, documents, team, traction, market, and financial
fields in this complete function and replace generated inline actions with data
actions:

```js
function renderReviewDetails(full, queuePortfolio) {
  const documents = full.documents.length
    ? full.documents.map((document) => `
        <a href="${escapeHtml(document.download_url)}"
           data-document-download
           data-file-name="${escapeHtml(document.file_name)}"
           style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
          <i class="ti ti-file"></i> ${escapeHtml(document.file_name)}
        </a>`).join('')
    : 'No documents uploaded';

  document.getElementById('review-card').innerHTML = `
    <div class="modal-header-row">
      <div class="modal-title-group">
        <h2>${escapeHtml(full.name)}</h2>
        <span class="badge-yellow">Pending Review</span>
      </div>
      <button class="modal-close-btn"
              data-review-action="close"
              type="button"
              aria-label="Close portfolio review">
        <i class="ti ti-x"></i>
      </button>
    </div>
    <p class="modal-subtitle">Review all portfolio details before making a decision</p>

    <div class="modal-readiness">
      <div class="score-circle"
           style="--score:${Number(full.readiness_score) || 0};width:48px;height:48px;font-size:15px;">
        <span>${escapeHtml(full.readiness_score ?? 0)}</span>
      </div>
      <div>
        <div class="readiness-label">
          Readiness
          <button class="score-info-btn"
                  data-review-action="score-info"
                  type="button"
                  title="How is this calculated?">
            <i class="ti ti-info-circle"></i>
          </button>
        </div>
        <div class="readiness-score">${escapeHtml(full.readiness_score ?? 0)}/100</div>
      </div>
      ${isScoreStale(queuePortfolio) ? `
        <div class="score-stale-warning">
          <i class="ti ti-alert-triangle"></i>
          Score may be outdated — business owner hasn't filled in new readiness fields
        </div>` : ''}
    </div>

    <div class="modal-section-label">Company</div>
    <div class="modal-fields-grid">
      <div>
        <div class="modal-field-label">Industry</div>
        <div class="modal-field-value">${escapeHtml(full.sector)}</div>
      </div>
      <div>
        <div class="modal-field-label">MVP Status</div>
        <div class="modal-field-value">${escapeHtml(full.mvp_status)}</div>
      </div>
      <div>
        <div class="modal-field-label">Funding Goal</div>
        <div class="modal-field-value">${formatFunding(full.funding_goal)}</div>
      </div>
      <div>
        <div class="modal-field-label">Location</div>
        <div class="modal-field-value ${full.location ? '' : 'muted'}">${full.location ? escapeHtml(full.location) : 'No location provided'}</div>
      </div>
      <div>
        <div class="modal-field-label">Website</div>
        <div class="modal-field-value ${full.website ? '' : 'muted'}">${full.website ? escapeHtml(full.website) : 'No website provided'}</div>
      </div>
      <div class="modal-field-full">
        <div class="modal-field-label">Description</div>
        <div class="modal-field-value ${full.description ? '' : 'muted'}">${full.description ? escapeHtml(full.description) : 'No description provided'}</div>
      </div>
      <div class="modal-field-full">
        <div class="modal-field-label">Documents</div>
        <div class="modal-field-value ${full.documents.length ? '' : 'muted'}">${documents}</div>
      </div>
    </div>

    <div class="modal-section-label">Team <span class="modal-section-pts">25 pts</span></div>
    <div class="modal-fields-grid">
      <div>
        <div class="modal-field-label">Team Size</div>
        <div class="modal-field-value ${full.team_size ? '' : 'muted'}">${full.team_size ? escapeHtml(full.team_size) : 'No team size provided'}</div>
      </div>
      <div>
        <div class="modal-field-label">Founded Year</div>
        <div class="modal-field-value">${full.founded_year ?? '—'}</div>
      </div>
      <div class="modal-field-full">
        <div class="modal-field-label">Advisors / Notable Members</div>
        <div class="modal-field-value" style="font-weight:400;">${full.advisor_names ? escapeHtml(full.advisor_names) : '—'}</div>
      </div>
    </div>

    <div class="modal-section-label">Traction <span class="modal-section-pts">25 pts</span></div>
    <div class="modal-fields-grid">
      <div>
        <div class="modal-field-label">Monthly Revenue</div>
        <div class="modal-field-value">${full.monthly_revenue != null ? formatFunding(full.monthly_revenue) : '—'}</div>
      </div>
      <div>
        <div class="modal-field-label">Users / Customers</div>
        <div class="modal-field-value">${full.user_count != null ? Number(full.user_count).toLocaleString() : '—'}</div>
      </div>
      <div>
        <div class="modal-field-label">MoM Growth</div>
        <div class="modal-field-value">${full.growth_rate != null ? `${escapeHtml(full.growth_rate)}%` : '—'}</div>
      </div>
    </div>

    <div class="modal-section-label">Market <span class="modal-section-pts">20 pts</span></div>
    <div class="modal-fields-grid">
      <div class="modal-field-full">
        <div class="modal-field-label">Target Market Size</div>
        <div class="modal-field-value" style="font-weight:400;">${full.market_size ? escapeHtml(full.market_size) : '—'}</div>
      </div>
      <div class="modal-field-full">
        <div class="modal-field-label">Competitor Analysis</div>
        <div class="modal-field-value" style="font-weight:400;">${full.competitor_analysis ? escapeHtml(full.competitor_analysis) : '—'}</div>
      </div>
    </div>

    <div class="modal-section-label">Financials <span class="modal-section-pts">15 pts</span></div>
    <div class="modal-fields-grid">
      <div>
        <div class="modal-field-label">Monthly Burn Rate</div>
        <div class="modal-field-value">${full.burn_rate != null ? formatFunding(full.burn_rate) : '—'}</div>
      </div>
      <div>
        <div class="modal-field-label">Runway</div>
        <div class="modal-field-value">${full.runway_months != null ? `${escapeHtml(full.runway_months)} months` : '—'}</div>
      </div>
    </div>

    <div class="modal-footer">
      <div class="modal-action-status"
           id="review-action-status"
           role="status"
           aria-live="polite"></div>
      <button class="btn-reject-outline"
              id="review-reject-btn"
              data-review-action="reject"
              type="button">
        <i class="ti ti-x"></i> Reject
      </button>
      <button class="btn-approve-solid"
              id="review-approve-btn"
              data-review-action="approve"
              type="button">
        <i class="ti ti-circle-check"></i> Approve
      </button>
    </div>`;
}
```

- [ ] **Step 6: Replace the review-card listener with delegated actions**

Use one listener:

```js
document.getElementById('review-card').addEventListener('click', async (event) => {
  const download = event.target.closest('[data-document-download]');
  if (download) {
    event.preventDefault();
    try {
      await API.downloadDocument(download.getAttribute('href'), download.dataset.fileName);
    } catch (error) {
      const status = document.getElementById('review-action-status');
      if (status) {
        status.textContent = `Couldn't download document: ${error.message}`;
        status.className = 'modal-action-status error';
      }
    }
    return;
  }

  const control = event.target.closest('[data-review-action]');
  if (!control || control.disabled) return;
  const action = control.dataset.reviewAction;
  if (action === 'close') closeReviewModal();
  else if (action === 'retry' && activeReviewId !== null) await loadReviewDetails(activeReviewId);
  else if (action === 'score-info') showScoreInfo();
  else if (action === 'approve') await handleApprove();
  else if (action === 'reject') openRejectPopup();
});
```

- [ ] **Step 7: Run Review and full administrator client tests**

Run:

```bash
cd backend
node --test test/admin-dashboard-client.test.js test/frontend-flow-contract.test.js
node --check ../js/moderatordashboard.js
```

Expected: all tests PASS.

- [ ] **Step 8: Commit Review recovery**

```bash
git add backend/test/admin-dashboard-client.test.js backend/test/frontend-flow-contract.test.js js/moderatordashboard.js
git commit -m "fix: make admin portfolio review recoverable"
```

---

### Task 5: Lock Approve and Reject Mutations and Reconcile Authoritatively

**Files:**
- Modify: `backend/test/admin-dashboard-client.test.js`
- Modify: `js/moderatordashboard.js`

**Interfaces:**
- Consumes: Task 4 `activeReviewId`, modal data actions, `closeReviewModal`, and Task 2 `loadModeration`.
- Produces:
  - `setDecisionState(inFlight, options): void`
  - `setReviewActionMessage(message, type): void`
  - `setReasonError(message): void`
  - `handleApprove(): Promise<boolean>`
  - `handleReject(): Promise<boolean>`
  - all overlay close paths blocked while `decisionInFlight`.

- [ ] **Step 1: Add failing mutation lifecycle tests**

Append:

```js
test('approval is single-flight, disables both decisions, and refreshes moderation once', async () => {
  const approve = deferred();
  const client = adminHarness({ approvePortfolio: async () => approve.promise });
  await client.init();
  await client.run('openReviewModal(42)');

  const first = client.run('handleApprove()');
  const second = client.run('handleApprove()');
  await flush();
  assert.equal(client.calls.approvePortfolio.length, 1);
  assert.equal(client.element('review-approve-btn').disabled, true);
  assert.equal(client.element('review-reject-btn').disabled, true);
  assert.match(client.element('review-action-status').textContent, /approving/i);

  approve.resolve({});
  await Promise.all([first, second]);
  assert.equal(client.calls.getStats.length, 2);
  assert.equal(client.calls.getQueue.length, 2);
  assert.match(client.element('moderation-status').textContent, /approved/i);
});

test('approval failure keeps the review open and restores controls', async () => {
  const client = adminHarness({
    approvePortfolio: async () => {
      throw new Error('approval failed');
    },
  });
  await client.init();
  await client.run('openReviewModal(42)');
  await client.run('handleApprove()');

  assert.equal(client.element('review-overlay').classList.contains('open'), true);
  assert.equal(client.element('review-approve-btn').disabled, false);
  assert.equal(client.element('review-reject-btn').disabled, false);
  assert.match(client.element('review-action-status').textContent, /approval failed/i);
});

test('blank rejection never calls the API and failed rejection keeps its reason', async () => {
  const client = adminHarness({
    rejectPortfolio: async () => {
      throw new Error('reject failed');
    },
  });
  await client.init();
  await client.run('openReviewModal(42)');
  client.run('openRejectPopup()');

  client.element('reason-textarea').value = '   ';
  await client.run('handleReject()');
  assert.equal(client.calls.rejectPortfolio.length, 0);
  assert.match(client.element('reason-error').textContent, /provide a rejection reason/i);

  client.element('reason-textarea').value = 'Needs stronger traction';
  await client.run('handleReject()');
  assert.equal(client.calls.rejectPortfolio.length, 1);
  assert.equal(client.element('reason-textarea').value, 'Needs stronger traction');
  assert.equal(client.element('reason-textarea').disabled, false);
  assert.match(client.element('reason-error').textContent, /reject failed/i);
});

test('all close paths are blocked while a rejection mutation is pending', async () => {
  const reject = deferred();
  const client = adminHarness({ rejectPortfolio: async () => reject.promise });
  await client.init();
  await client.run('openReviewModal(42)');
  client.run('openRejectPopup()');
  client.element('reason-textarea').value = 'Needs stronger traction';

  const saving = client.run('handleReject()');
  const duplicate = client.run('handleReject()');
  await flush();
  assert.equal(client.calls.rejectPortfolio.length, 1);
  assert.equal(client.run('closeRejectPopup()'), false);
  assert.equal(client.run('closeReviewModal()'), false);
  await client.element('reason-overlay').dispatch('click', {
    target: client.element('reason-overlay'),
  });
  const closeControl = client.element('review-close-control');
  closeControl.dataset.reviewAction = 'close';
  await client.element('review-card').dispatch('click', { target: closeControl });
  await client.document.dispatch('keydown', { key: 'Escape' });
  assert.equal(client.element('reason-overlay').classList.contains('open'), true);
  assert.equal(client.element('review-overlay').classList.contains('open'), true);
  assert.equal(client.element('reason-cancel-btn').disabled, true);

  reject.resolve({});
  await Promise.all([saving, duplicate]);
});

test('saved decision plus refresh failure disables stale Review without repeating mutation', async () => {
  let statsCalls = 0;
  const client = adminHarness({
    getStats: async () => {
      statsCalls += 1;
      if (statsCalls === 1) {
        return { pending: 1, approved: 2, rejected: 0, total_matches: 3 };
      }
      throw new Error('refresh failed');
    },
  });
  await client.init();
  await client.run('openReviewModal(42)');
  await client.run('handleApprove()');

  assert.equal(client.calls.approvePortfolio.length, 1);
  assert.match(client.element('moderation-status').textContent, /saved|approved/i);
  assert.match(client.element('queue-list').innerHTML, /disabled/);
  await client.element('moderation-retry-btn').dispatch('click');
  assert.equal(client.calls.approvePortfolio.length, 1);
});
```

- [ ] **Step 2: Run mutation tests and verify red**

Run:

```bash
cd backend
node --test --test-name-pattern="approval|rejection|decision" test/admin-dashboard-client.test.js
```

Expected: FAIL because mutations currently rely on alerts, accept duplicate
clicks, and reload all dashboard data through the old lifecycle.

- [ ] **Step 3: Implement decision state and inline feedback**

Add:

```js
function setReviewActionMessage(message, type = '') {
  const status = document.getElementById('review-action-status');
  if (!status) return;
  status.textContent = message;
  status.className = `modal-action-status${type ? ` ${type}` : ''}`;
}

function setReasonError(message) {
  const error = document.getElementById('reason-error');
  if (!error) return;
  error.textContent = message;
  error.className = message ? 'form-message reason-error show error' : 'form-message reason-error';
}

function setDecisionState(inFlight, { action = '', message = '' } = {}) {
  decisionInFlight = inFlight;
  const approve = document.getElementById('review-approve-btn');
  const reject = document.getElementById('review-reject-btn');
  const textarea = document.getElementById('reason-textarea');
  const cancel = document.getElementById('reason-cancel-btn');
  const confirm = document.getElementById('reason-confirm-btn');

  if (approve) {
    approve.disabled = inFlight;
    approve.innerHTML = inFlight && action === 'approve'
      ? '<i class="ti ti-loader-2"></i> Approving…'
      : '<i class="ti ti-circle-check"></i> Approve';
  }
  if (reject) {
    reject.disabled = inFlight;
    reject.innerHTML = '<i class="ti ti-x"></i> Reject';
  }
  textarea.disabled = inFlight;
  cancel.disabled = inFlight;
  confirm.disabled = inFlight;
  confirm.textContent = inFlight && action === 'reject'
    ? 'Rejecting…'
    : 'Reject Portfolio';
  setReviewActionMessage(message);
}
```

- [ ] **Step 4: Replace approval with a single-flight authoritative refresh**

```js
async function handleApprove() {
  if (activeReviewId === null || decisionInFlight) return false;
  const portfolioId = activeReviewId;
  setDecisionState(true, { action: 'approve', message: 'Approving portfolio…' });
  try {
    await API.approvePortfolio(portfolioId);
  } catch (error) {
    setDecisionState(false);
    setReviewActionMessage(`Couldn't approve portfolio: ${error.message}`, 'error');
    return false;
  }

  setDecisionState(false);
  closeReviewModal();
  return loadModeration({
    successMessage: 'Portfolio approved.',
    failureMessage: 'Portfolio approved, but the dashboard could not refresh.',
  });
}
```

- [ ] **Step 5: Replace rejection and every close path**

Use:

```js
function openRejectPopup() {
  if (decisionInFlight || activeReviewId === null) return false;
  document.getElementById('reason-textarea').value = '';
  setReasonError('');
  document.getElementById('reason-overlay').classList.add('open');
  document.getElementById('reason-textarea').focus();
  return true;
}

function closeRejectPopup() {
  if (decisionInFlight) return false;
  document.getElementById('reason-overlay').classList.remove('open');
  return true;
}

async function handleReject() {
  if (activeReviewId === null || decisionInFlight) return false;
  const reason = document.getElementById('reason-textarea').value.trim();
  if (!reason) {
    setReasonError('Please provide a rejection reason.');
    return false;
  }

  const portfolioId = activeReviewId;
  setReasonError('');
  setDecisionState(true, { action: 'reject', message: 'Rejecting portfolio…' });
  try {
    await API.rejectPortfolio(portfolioId, reason);
  } catch (error) {
    setDecisionState(false);
    setReasonError(`Couldn't reject portfolio: ${error.message}`);
    return false;
  }

  setDecisionState(false);
  closeRejectPopup();
  closeReviewModal();
  return loadModeration({
    successMessage: 'Portfolio rejected.',
    failureMessage: 'Portfolio rejected, but the dashboard could not refresh.',
  });
}

document.getElementById('reason-cancel-btn').addEventListener('click', closeRejectPopup);
document.getElementById('reason-confirm-btn').addEventListener('click', handleReject);

document.getElementById('reason-overlay').addEventListener('click', (event) => {
  if (event.target.id === 'reason-overlay') closeRejectPopup();
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || decisionInFlight) return;
  if (document.getElementById('reason-overlay').classList.contains('open')) {
    closeRejectPopup();
  } else if (document.getElementById('review-overlay').classList.contains('open')) {
    closeReviewModal();
  }
});
```

The review-overlay outside-click listener continues to call
`closeReviewModal()`, whose decision guard blocks it during a mutation.

- [ ] **Step 6: Run accumulated administrator tests**

Run:

```bash
cd backend
node --test test/admin-dashboard-client.test.js test/frontend-flow-contract.test.js test/api-client.test.js
node --check ../js/moderatordashboard.js
```

Expected: all tests PASS.

- [ ] **Step 7: Commit mutation safety**

```bash
git add backend/test/admin-dashboard-client.test.js js/moderatordashboard.js
git commit -m "fix: lock admin portfolio decisions"
```

---

### Task 6: Close Contract Gaps and Run Full Verification

**Files:**
- Modify: `backend/test/admin-dashboard-client.test.js`
- Verify: `moderatordashboard.html`
- Verify: `js/moderatordashboard.js`
- Verify: `css/style.css`

**Interfaces:**
- Consumes: All preceding task outputs.
- Produces: complete design-to-test traceability, clean syntax/diff, and evidence that the complete existing suite still passes.

- [ ] **Step 1: Add the final response-order and status-persistence cases**

Ensure the executable test file contains these exact assertions:

```js
test('a successful decision status survives the moderation rerender', async () => {
  const client = adminHarness();
  await client.init();
  await client.run('openReviewModal(42)');
  await client.run('handleApprove()');

  assert.equal(client.element('moderation-status').hidden, false);
  assert.equal(client.element('moderation-status').textContent, 'Portfolio approved.');
  assert.match(client.element('moderation-status').className, /success/);
});

test('manager directory retry is single-flight', async () => {
  const retry = deferred();
  let calls = 0;
  const client = adminHarness({
    getRelationshipManagers: async () => {
      calls += 1;
      if (calls === 1) throw new Error('offline');
      return retry.promise;
    },
  });
  await client.init();

  const first = client.element('manager-directory-retry-btn').dispatch('click');
  const second = client.element('manager-directory-retry-btn').dispatch('click');
  await flush();
  assert.equal(client.calls.getRelationshipManagers.length, 2);
  retry.resolve([]);
  await Promise.all([first, second]);
});
```

The harness's disabled/hidden click semantics prove that the first Retry
synchronously enters the section loading state before the second click is
dispatched. Direct calls to a loader are still allowed to supersede an older
read and remain protected by request versions.

- [ ] **Step 2: Run formatting and forbidden-pattern checks**

Run:

```bash
git diff --check
if rg -n 'onclick="openReviewModal|Promise\\.all\\(\\[.*getRelationshipManagers' \
  js/moderatordashboard.js; then
  exit 1
fi
```

Expected: `git diff --check` exits 0; `rg` produces no matches.

- [ ] **Step 3: Run the focused administrator regression set**

Run:

```bash
cd backend
node --test \
  test/admin-dashboard-client.test.js \
  test/frontend-flow-contract.test.js \
  test/api-client.test.js \
  test/documents-security.test.js \
  test/relationship-manager-admin.test.js
```

Expected: all tests PASS with 0 failures.

- [ ] **Step 4: Run all browser JavaScript syntax checks**

Run:

```bash
for file in ../js/*.js; do node --check "$file" || exit 1; done
```

Expected: exit 0 with no syntax errors.

- [ ] **Step 5: Run the complete backend suite**

Run:

```bash
npm test
```

Expected: all tests PASS with 0 failures.

- [ ] **Step 6: Review the exact runtime diff**

Run from the repository root:

```bash
git status --short
git diff --stat b386ed1..HEAD
git diff b386ed1..HEAD -- moderatordashboard.html js/moderatordashboard.js css/style.css
```

Expected: runtime changes are limited to the three approved administrator
files; test/doc changes are limited to the files named in this plan.

- [ ] **Step 7: Commit the final test closure**

```bash
git add backend/test/admin-dashboard-client.test.js
git commit -m "test: close admin dashboard resilience coverage"
```

- [ ] **Step 8: Run read-only live API smoke without printing credentials**

Use hidden PTY password input and assert only statuses/types:

```bash
set -eu
stty -echo
printf 'Admin password: '
IFS= read -r ADMIN_SMOKE_PASSWORD
stty echo
printf '\n'
LOGIN_BODY=$(jq -nc \
  --arg email 'victor@lumilabs.com' \
  --arg password "$ADMIN_SMOKE_PASSWORD" \
  '{email:$email,password:$password}')
ADMIN_TOKEN=$(curl -fsS \
  -H 'Content-Type: application/json' \
  -d "$LOGIN_BODY" \
  http://35.212.144.149/api/auth/login | jq -er '.token')

curl -fsS -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://35.212.144.149/api/admin/stats | jq -e '
    (.pending|type) == "number" and
    (.approved|type) == "number" and
    (.rejected|type) == "number"
  '
curl -fsS -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://35.212.144.149/api/admin/queue | jq -e 'type == "array"'
curl -fsS -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://35.212.144.149/api/admin/relationship-managers | jq -e 'type == "array"'

unset ADMIN_SMOKE_PASSWORD LOGIN_BODY ADMIN_TOKEN
```

Expected: every command exits 0. Do not call approve, reject, or create-account
endpoints.

- [ ] **Step 9: Attempt signed-in browser verification only through the connected browser**

If a controllable signed-in browser is available, verify:

1. Victor's moderation and manager sections both load.
2. Review opens immediately and renders a pending portfolio.
3. Close restores focus to Review.
4. No approve, reject, or manager creation is submitted.
5. No console error occurs at desktop or 390px width.

If no browser is connected, record that limitation and do not claim visual
verification.

- [ ] **Step 10: Stop before publishing**

Report local commits, exact test evidence, live read-only smoke evidence, and
the one-hard-refresh cache limitation. Ask separately whether to push GitHub
and deploy the approved runtime files to SFTP.
