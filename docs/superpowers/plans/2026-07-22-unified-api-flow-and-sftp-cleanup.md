# Unified API, Three-Role Flow, and SFTP Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing business-owner, investor, and admin journeys use one authenticated, MySQL-backed API, then replace the public SFTP web root with an allowlisted frontend and quarantine the previous deployment without downtime.

**Architecture:** Browser code calls same-origin `/api`; Apache proxies `/api/*` to one Node process at `127.0.0.1:3100`. The Node runtime, production `.env`, dependencies, and uploads live in `/var/www/lumilabs-backend`, while `/var/www/html` contains only HTML, CSS, and browser JavaScript. The cutover is staged and reversible, and the old messaging service remains available until all post-cutover checks pass.

**Tech Stack:** HTML/CSS, browser JavaScript, Node.js 24, Express 4, MySQL 8, built-in `node:test`, Apache 2.4, systemd, SFTP/SSH.

## Global Constraints

- Support only the current `business_owner`, `investor`, and `admin` roles; relationship-manager and group-chat work is deferred.
- No browser-delivered file may contain `localhost`, a loopback address, a database host, or a public Node port.
- Internal Apache-to-Node and Node-to-SSH-tunnel traffic remains loopback-only.
- Never print, upload over chat, or commit the production `.env` or replacement credentials.
- Preserve server-managed uploads, dependencies, and production environment values.
- Do not switch Apache until the staged service passes health, readiness, authorization, and temporary-data checks.
- Do not permanently delete old server files. Move them to `/home/user/lumilabs-quarantine-20260722-unified-api` with a hash manifest.
- Keep `/var/www/html-pre-unified-api-20260722` and the old messaging service until the public post-cutover checks pass.
- Use `apply_patch` for repository edits; use exact, validated server paths for remote moves.
- Commit each independently verified task, but push `main` only after local and live verification completes.

## File Responsibility Map

- `js/api.js`: same-origin API client, authenticated fetch, shared session cleanup, and API methods.
- `js/script.js`: signup/signin only; it stores the real authenticated user and never maps to prototype identities.
- `js/messages.js` and `messages.html`: JWT-backed one-to-one messaging UI.
- `backend/src/routes/messages.js`: authenticated message list/thread/send routes.
- `backend/src/services/workflow.js`: transaction boundaries for submission, moderation, and investor interest.
- `backend/src/routes/portfolios.js`: portfolio state machine and authorized document operations.
- `backend/src/middleware/upload.js`: safe upload naming, validation, and upload error classification.
- `backend/src/schema-contract.js`: production-schema readiness checks without exposing data.
- `backend/server.js`: app factory, environment validation, readiness endpoint, loopback listener, and unified route mounting.
- `backend/deploy/lumilabs-backend.service`: private unified systemd service.
- `backend/deploy/apache-lumilabs-proxy.conf`: unified `/api` reverse-proxy rules; document downloads remain authenticated API requests.
- `backend/deploy/runtime-manifest.txt`: exact SFTP deployment allowlist.
- `backend/test/*.test.js`: regression, flow-contract, route, transaction, layout, and deployment tests.
- `backend/scripts/live-three-role-smoke.js`: temporary-data live workflow and cleanup runner.

---

### Task 1: Establish a Reproducible, Secret-Free Repository Baseline

**Files:**
- Modify: `.gitignore`
- Modify: `backend/package.json`
- Modify: `backend/package-lock.json`
- Stop tracking without deleting locally: `backend/.env`, `.vscode/settings.json`, `.vscode/sftp.json`, `backend/node_modules/**`

**Interfaces:**
- Consumes: current clean `main` and existing production lockfile.
- Produces: `npm test`, a declared `ssh2` runtime dependency, and a Git tree with no current credential/editor/dependency copies.

- [ ] **Step 1: Record the baseline and prove sensitive/generated paths are tracked**

Run:

```bash
git status --short --branch
git ls-files backend/.env '.vscode/**' 'backend/node_modules/**' | wc -l
node --test backend/test/*.test.js
```

Expected: the worktree is clean except for this plan commit, the tracked-path count is greater than zero, and the existing suite reports 15 passed, 0 failed, and 1 skipped.

- [ ] **Step 2: Extend `.gitignore` with exact local/runtime exclusions**

Replace the file with:

```gitignore
node_modules/
.env
.vscode/
backend/uploads/
*.log
```

- [ ] **Step 3: Add the test command and direct SSH dependency**

Update the relevant `backend/package.json` keys to:

```json
{
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js",
    "test": "node --test test/*.test.js"
  },
  "dependencies": {
    "ssh2": "^1.17.0"
  }
}
```

Keep every existing dependency; add `ssh2` because `server.js` imports it directly. Regenerate only the manifests:

```bash
cd backend
npm install --package-lock-only --save ssh2@^1.17.0
cd ..
```

Expected: `backend/package.json` and `backend/package-lock.json` both list `ssh2` as a direct dependency.

- [ ] **Step 4: Remove tracked copies from the index without deleting local/server data**

Run:

```bash
git rm --cached backend/.env
git rm --cached -r .vscode backend/node_modules
test -f backend/.env
test -d backend/node_modules
```

Expected: Git stages the removals, while the local `.env` and dependency directory still exist.

- [ ] **Step 5: Reinstall and verify the dependency tree locally**

Run:

```bash
cd backend
npm ci
npm ls --depth=0
npm test
cd ..
```

Expected: all declared dependencies are installed, `npm ls` exits 0, and the tests have zero failures.

- [ ] **Step 6: Commit repository hygiene**

```bash
git add .gitignore backend/package.json backend/package-lock.json
git commit -m "chore: remove secrets and generated files from tracking"
```

---

### Task 2: Enforce Same-Origin Browser API and Real Session Storage

**Files:**
- Create: `backend/test/frontend-origin.test.js`
- Modify: `js/api.js:1-2,53-84`
- Modify: `js/script.js:1-57`

**Interfaces:**
- Consumes: browser origin and `lumilabsToken`.
- Produces: `API_BASE === '/api'`, relative file URLs, `clearSession()`, and real user storage without prototype keys.

- [ ] **Step 1: Write the failing same-origin test**

Create `backend/test/frontend-origin.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const browserFiles = [
  ...fs.readdirSync(root).filter((name) => name.endsWith('.html')),
  ...fs.readdirSync(path.join(root, 'js')).map((name) => `js/${name}`),
];

test('browser files use only the same-origin API namespace', () => {
  for (const relative of browserFiles) {
    const source = fs.readFileSync(path.join(root, relative), 'utf8');
    assert.doesNotMatch(source, /https?:\/\/(?:localhost|127\.0\.0\.1)|\$\{protocol\}\/\/\$\{hostname\}:3000|35\.212\.144\.149:3000/, relative);
  }
  assert.match(fs.readFileSync(path.join(root, 'js/api.js'), 'utf8'), /(?:window\.LUMILABS_API_BASE \|\| )?["']\/api["']/);
  assert.match(fs.readFileSync(path.join(root, 'js/script.js'), 'utf8'), /(?:window\.LUMILABS_API_BASE \|\| )?["']\/api["']/);
});
```

- [ ] **Step 2: Run the test and observe the development-origin failure**

Run:

```bash
cd backend && node --test test/frontend-origin.test.js
```

Expected: FAIL naming `js/api.js` and `js/script.js`.

- [ ] **Step 3: Replace browser API origin selection**

At the top of `js/api.js`, use:

```js
const API_BASE = window.LUMILABS_API_BASE || "/api";
const FILE_BASE = "";
```

At the top of `js/script.js`, use:

```js
const API_BASE = window.LUMILABS_API_BASE || '/api';

const ROLE_MAP = {
  business_owner: { dashboard: 'businessownerdashboard.html' },
  investor: { dashboard: 'investordashboard.html' },
  admin: { dashboard: 'moderatordashboard.html' },
};
```

Replace `saveSession` with:

```js
function saveSession(token, user) {
  const mapped = ROLE_MAP[user.role] || { dashboard: 'index.html' };
  localStorage.setItem('lumilabsToken', token);
  localStorage.setItem('lumilabsUser', JSON.stringify(user));
  localStorage.removeItem('lumilabsSelectedUser');
  return mapped;
}
```

Add these globals to `js/api.js`:

```js
function clearSession() {
  localStorage.removeItem("lumilabsToken");
  localStorage.removeItem("lumilabsUser");
  localStorage.removeItem("lumilabsSelectedUser");
}

function signOut() {
  clearSession();
  window.location.href = "signin.html";
}
```

Change `apiFetch` so a `401` clears the session before throwing:

```js
if (res.status === 401) clearSession();
if (!res.ok) {
  const message = data?.error || data?.errors?.[0]?.msg || `Request failed (${res.status})`;
  throw new Error(message);
}
```

- [ ] **Step 4: Verify and commit same-origin behavior**

```bash
cd backend && node --test test/frontend-origin.test.js && npm test
cd ..
git add js/api.js js/script.js backend/test/frontend-origin.test.js
git commit -m "fix: use the same-origin API"
```

Expected: zero test failures and no browser-delivered development origin.

---

### Task 3: Remove Prototype Impersonation and Repair Targeted Messaging

**Files:**
- Modify: `backend/src/routes/messages.js:1-78,89-177`
- Modify: `backend/test/messages-route.test.js`
- Modify: `backend/test/messages-client.test.js`
- Modify: `js/messages.js:1-220,231-255,530-590`
- Modify: `messages.html:516-554`
- Modify: `js/browse.js:1-105`
- Modify: `js/my-interests.js:1-65`

**Interfaces:**
- Consumes: `Authorization: Bearer <JWT>` and query parameters `partnerId`, `partnerName`, `partnerRole`, `portfolioId`, `portfolioName`.
- Produces: authenticated message identity and deterministic owner-thread navigation.

- [ ] **Step 1: Rewrite route tests to authenticate with JWT and reject prototype headers**

In `backend/test/messages-route.test.js`, set a test secret and replace prototype headers with:

```js
const jwt = require('jsonwebtoken');
process.env.JWT_SECRET = 'messages-route-test-secret';

function authHeaders(user) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${jwt.sign(user, process.env.JWT_SECRET)}`,
  };
}
```

Make `postMessage` accept the complete sender object and use `authHeaders(sender)`. Remove the resolver-only `db.query` expectation from `stubPool`. Add:

```js
test('prototype headers cannot authenticate an anonymous message request', async (t) => {
  const server = await listen(createMessagingApp());
  t.after(server.close);
  const response = await fetch(`${server.origin}/api/messages/me`, {
    headers: { 'X-LumiLabs-Prototype-User': 'beta' },
  });
  assert.equal(response.status, 401);
});
```

- [ ] **Step 2: Run the route test and observe the anonymous prototype access**

```bash
cd backend && node --test test/messages-route.test.js
```

Expected: FAIL because the prototype header currently authenticates.

- [ ] **Step 3: Require the shared JWT middleware on every message route**

In `backend/src/routes/messages.js`, import:

```js
const { authenticate } = require('../middleware/auth');
```

Delete `jsonwebtoken`, `prototypeUsers`, and `resolveMessageUser`. Replace every `resolveMessageUser` route middleware with `authenticate`.

Replace hard-coded identity SQL expressions with database identity:

```sql
COALESCE(u.name, CONCAT('User ', latest.partner_id)) AS partner_name,
COALESCE(u.role, '') AS partner_role
```

and:

```sql
COALESCE(u.name, CONCAT('User ', m.sender_id)) AS sender_name
```

- [ ] **Step 4: Remove prototype state and headers from the message client**

Delete `SELECTED_USER_KEY`, `PROTOTYPE_USERS`, `state.selectedUser`, `renderSelectedUser`, `updateRoleMenu`, `switchPrototypeRole`, `getSelectedUser`, and all `X-LumiLabs-Prototype-*` headers.

Start `initMessages` with:

```js
state.token = getAuthToken();
if (!state.token) {
  window.location.href = 'signin.html';
  return;
}

try {
  const user = await apiFetch('/messages/me');
  state.user = { id: user.id, name: user.name, role: user.role, roleLabel: roleLabel(user.role) };
} catch (err) {
  clearMessageSession();
  window.location.href = 'signin.html';
  return;
}
```

Add:

```js
function clearMessageSession() {
  localStorage.removeItem('lumilabsToken');
  localStorage.removeItem('lumilabsUser');
  localStorage.removeItem('lumilabsSelectedUser');
}

function signOutMessages() {
  clearMessageSession();
  window.location.href = 'signin.html';
}
```

Make refresh report success only when `loadConversations()` returns `true`; return `false` from its catch branch.

- [ ] **Step 5: Replace the prototype dropdown with sign out and repair investor navigation**

In `messages.html`, add `onclick` targets to Browse and My Interests and replace both Alpha/Beta buttons with:

```html
<button class="role-option" id="messages-signout" type="button" onclick="signOutMessages()" role="menuitem">
  <span class="role-option-avatar"><i class="ti ti-logout"></i></span>
  <span class="role-option-name">Sign out</span>
</button>
```

- [ ] **Step 6: Pass owner and portfolio context from investor pages**

Add this helper to both `js/browse.js` and `js/my-interests.js`:

```js
function messageOwnerUrl(portfolio) {
  const params = new URLSearchParams({
    partnerId: portfolio.owner_id,
    partnerName: portfolio.owner_name,
    partnerRole: 'business_owner',
    portfolioId: portfolio.id,
    portfolioName: portfolio.name,
  });
  return `messages.html?${params.toString()}`;
}
```

Render each message button with the encoded URL:

```js
const messageUrl = escapeHtml(messageOwnerUrl(p));
const messageButton = `
  <button class="btn-message" onclick="window.location.href='${messageUrl}'" title="Message owner">
    <i class="ti ti-message"></i>
  </button>
`;
```

Insert `messageButton` inside the existing card-actions template for that portfolio.

Extend both local `escapeHtml` functions to escape double and single quotes.

- [ ] **Step 7: Update client tests and verify JWT messaging**

Remove prototype setup from `backend/test/messages-client.test.js`; initialize only:

```js
state.token = 'signed-test-token';
state.user = { id: 3, name: 'Beta Founder', role: 'business_owner' };
```

Assert that the fetch request contains `Authorization` and contains no header whose name starts with `X-LumiLabs-Prototype`.

Run and commit:

```bash
cd backend && npm test
cd ..
git add backend/src/routes/messages.js backend/test/messages-route.test.js backend/test/messages-client.test.js js/messages.js messages.html js/browse.js js/my-interests.js
git commit -m "fix: authenticate real messaging users"
```

---

### Task 4: Make Portfolio Submission, Moderation, and Interest Atomic

**Files:**
- Create: `backend/src/services/workflow.js`
- Create: `backend/test/workflow-transactions.test.js`
- Modify: `backend/src/routes/portfolios.js:303-345`
- Modify: `backend/src/routes/admin.js:27-114`
- Modify: `backend/src/routes/interests.js:8-43`
- Modify: `backend/schema.sql`
- Modify: `backend/migrate.js`

**Interfaces:**
- Consumes: the MySQL pool, authenticated IDs, and validated route inputs.
- Produces: `submitPortfolio`, `moderatePortfolio`, and `expressInterest`, each committing all related writes or none.

- [ ] **Step 1: Write transaction tests with a fake connection**

Create a fake connection whose `query` method delegates to a per-test handler and records every SQL statement:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/config/db');
const {
  WorkflowError,
  submitPortfolio,
  moderatePortfolio,
  expressInterest,
} = require('../src/services/workflow');

function fakeConnection(handler) {
  const calls = { begin: 0, queries: [], commit: 0, rollback: 0, release: 0 };
  return {
    calls,
    async beginTransaction() { calls.begin += 1; },
    async query(sql, params) {
      calls.queries.push({ sql, params });
      return handler(sql, params);
    },
    async commit() { calls.commit += 1; },
    async rollback() { calls.rollback += 1; },
    release() { calls.release += 1; },
  };
}

function useConnection(t, connection) {
  const original = db.getConnection;
  db.getConnection = async () => connection;
  t.after(() => { db.getConnection = original; });
}

test('submission rolls back when admin notification insert fails', async (t) => {
  const connection = fakeConnection(async (sql) => {
    if (sql.includes('FROM portfolios') && sql.includes('FOR UPDATE')) {
      return [[{ id: 7, owner_id: 4, name: 'Flow Co', status: 'draft' }], []];
    }
    if (sql.startsWith('UPDATE portfolios')) return [{ affectedRows: 1 }, []];
    if (sql.includes("role='admin'")) return [[{ id: 9 }], []];
    if (sql.startsWith('INSERT INTO notifications')) throw new Error('notification failed');
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  useConnection(t, connection);
  await assert.rejects(() => submitPortfolio({ portfolioId: 7, ownerId: 4, ownerName: 'Owner' }), /notification failed/);
  assert.deepEqual(connection.calls, {
    begin: 1,
    queries: connection.calls.queries,
    commit: 0,
    rollback: 1,
    release: 1,
  });
});

test('moderation changes status, audit, and notification in one commit', async (t) => {
  const connection = fakeConnection(async (sql) => {
    if (sql.includes('FROM portfolios') && sql.includes('FOR UPDATE')) {
      return [[{ id: 7, owner_id: 4, name: 'Flow Co', status: 'pending' }], []];
    }
    if (sql.startsWith('UPDATE portfolios')) return [{ affectedRows: 1 }, []];
    if (sql.startsWith('INSERT INTO audit_logs')) return [{ affectedRows: 1 }, []];
    if (sql.startsWith('INSERT INTO notifications')) return [{ affectedRows: 1 }, []];
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  useConnection(t, connection);
  await moderatePortfolio({ portfolioId: 7, adminId: 9, action: 'approved', reason: null });
  assert.equal(connection.calls.commit, 1);
  assert.equal(connection.calls.rollback, 0);
  assert.equal(connection.calls.release, 1);
  assert.ok(connection.calls.queries.some(({ sql }) => /WHERE id=\? AND status='pending'/.test(sql)));
  assert.ok(connection.calls.queries.some(({ sql }) => sql.startsWith('INSERT INTO audit_logs')));
  assert.ok(connection.calls.queries.some(({ sql }) => sql.startsWith('INSERT INTO notifications')));
});

test('a concurrent second moderation receives a conflict without inserts', async (t) => {
  const connection = fakeConnection(async (sql) => {
    if (sql.includes('FROM portfolios') && sql.includes('FOR UPDATE')) {
      return [[{ id: 7, owner_id: 4, name: 'Flow Co', status: 'pending' }], []];
    }
    if (sql.startsWith('UPDATE portfolios')) return [{ affectedRows: 0 }, []];
    throw new Error(`Unexpected SQL after conflict: ${sql}`);
  });
  useConnection(t, connection);
  await assert.rejects(
    () => moderatePortfolio({ portfolioId: 7, adminId: 9, action: 'rejected', reason: 'No fit' }),
    (error) => error instanceof WorkflowError && error.status === 409
  );
  assert.equal(connection.calls.commit, 0);
  assert.equal(connection.calls.rollback, 1);
  assert.equal(connection.calls.queries.length, 2);
});

test('duplicate interest returns created false and creates no notification', async (t) => {
  const connection = fakeConnection(async (sql) => {
    if (sql.includes('FROM portfolios') && sql.includes('FOR UPDATE')) {
      return [[{ id: 7, owner_id: 4, name: 'Flow Co' }], []];
    }
    if (sql.startsWith('INSERT IGNORE INTO investor_interests')) return [{ affectedRows: 0 }, []];
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  useConnection(t, connection);
  assert.deepEqual(await expressInterest({ portfolioId: 7, investorId: 8, investorName: 'Investor' }), { created: false });
  assert.equal(connection.calls.commit, 1);
  assert.equal(connection.calls.queries.length, 2);
});

test('new interest and notification commit together', async (t) => {
  const connection = fakeConnection(async (sql) => {
    if (sql.includes('FROM portfolios') && sql.includes('FOR UPDATE')) {
      return [[{ id: 7, owner_id: 4, name: 'Flow Co' }], []];
    }
    if (sql.startsWith('INSERT IGNORE INTO investor_interests')) return [{ affectedRows: 1 }, []];
    if (sql.startsWith('INSERT INTO notifications')) return [{ affectedRows: 1 }, []];
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  useConnection(t, connection);
  assert.deepEqual(await expressInterest({ portfolioId: 7, investorId: 8, investorName: 'Investor' }), { created: true });
  assert.equal(connection.calls.commit, 1);
  assert.equal(connection.calls.rollback, 0);
  assert.equal(connection.calls.queries.length, 3);
});
```

- [ ] **Step 2: Run the new tests and observe missing service exports**

```bash
cd backend && node --test test/workflow-transactions.test.js
```

Expected: FAIL because `src/services/workflow.js` does not exist.

- [ ] **Step 3: Add the shared transaction and typed workflow errors**

Start `backend/src/services/workflow.js` with:

```js
const db = require('../config/db');

class WorkflowError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function inTransaction(work) {
  const connection = await db.getConnection();
  await connection.beginTransaction();
  try {
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
```

Implement the three exported functions with these exact transaction bodies:

```js
async function submitPortfolio({ portfolioId, ownerId, ownerName }) {
  return inTransaction(async (connection) => {
    const [rows] = await connection.query(
      'SELECT id, owner_id, name, status FROM portfolios WHERE id=? AND owner_id=? FOR UPDATE',
      [portfolioId, ownerId]
    );
    if (!rows.length) throw new WorkflowError(404, 'Portfolio not found');
    if (rows[0].status === 'pending') {
      throw new WorkflowError(409, 'Portfolio is already pending review');
    }
    await connection.query(
      "UPDATE portfolios SET status='pending', submitted_at=NOW(), rejection_reason=NULL WHERE id=?",
      [portfolioId]
    );
    const [admins] = await connection.query("SELECT id FROM users WHERE role='admin'");
    if (admins.length) {
      const values = admins.map(({ id }) => [
        id, 'portfolio_submitted', 'New Portfolio Submitted',
        `${ownerName} submitted "${rows[0].name}" for review`, portfolioId, ownerId,
      ]);
      await connection.query(
        'INSERT INTO notifications (user_id,type,title,body,related_portfolio_id,related_user_id) VALUES ?',
        [values]
      );
    }
    return { message: 'Portfolio submitted for review' };
  });
}

async function moderatePortfolio({ portfolioId, adminId, action, reason }) {
  if (!['approved', 'rejected'].includes(action)) {
    throw new WorkflowError(400, 'Invalid moderation action');
  }
  return inTransaction(async (connection) => {
    const [rows] = await connection.query(
      "SELECT id,owner_id,name,status FROM portfolios WHERE id=? AND status='pending' FOR UPDATE",
      [portfolioId]
    );
    if (!rows.length) throw new WorkflowError(404, 'Pending portfolio not found');
    const rejected = action === 'rejected';
    const [update] = await connection.query(
      "UPDATE portfolios SET status=?, rejection_reason=? WHERE id=? AND status='pending'",
      [action, rejected ? reason : null, portfolioId]
    );
    if (update.affectedRows !== 1) {
      throw new WorkflowError(409, 'Portfolio has already been moderated');
    }
    await connection.query(
      'INSERT INTO audit_logs (admin_id,action,portfolio_id,reason) VALUES (?,?,?,?)',
      [adminId, action, portfolioId, rejected ? reason : null]
    );
    await connection.query(
      'INSERT INTO notifications (user_id,type,title,body,related_portfolio_id,related_user_id) VALUES (?,?,?,?,?,?)',
      [
        rows[0].owner_id,
        rejected ? 'portfolio_rejected' : 'portfolio_approved',
        rejected ? 'Portfolio Rejected' : 'Portfolio Approved!',
        rejected
          ? `Your portfolio "${rows[0].name}" was rejected: ${reason}`
          : `Your portfolio "${rows[0].name}" has been approved and is now visible to investors`,
        portfolioId,
        adminId,
      ]
    );
    return { message: rejected ? 'Portfolio rejected' : 'Portfolio approved' };
  });
}

async function expressInterest({ portfolioId, investorId, investorName }) {
  return inTransaction(async (connection) => {
    const [rows] = await connection.query(
      "SELECT id,owner_id,name FROM portfolios WHERE id=? AND status='approved' FOR UPDATE",
      [portfolioId]
    );
    if (!rows.length) throw new WorkflowError(404, 'Approved portfolio not found');
    const [insert] = await connection.query(
      'INSERT IGNORE INTO investor_interests (investor_id,portfolio_id) VALUES (?,?)',
      [investorId, portfolioId]
    );
    if (!insert.affectedRows) return { created: false };
    await connection.query(
      'INSERT INTO notifications (user_id,type,title,body,related_portfolio_id,related_user_id) VALUES (?,?,?,?,?,?)',
      [
        rows[0].owner_id, 'new_interest', 'New Investor Interest!',
        `${investorName} is interested in "${rows[0].name}"`, portfolioId, investorId,
      ]
    );
    return { created: true };
  });
}
```

Export exactly:

```js
module.exports = { WorkflowError, submitPortfolio, moderatePortfolio, expressInterest };
```

- [ ] **Step 4: Make routes translate workflow results and errors**

Use this route error adapter in the three route files:

```js
function sendWorkflowError(res, error) {
  if (error && Number.isInteger(error.status)) {
    return res.status(error.status).json({ error: error.message });
  }
  console.error(error);
  return res.status(500).json({ error: 'Server error' });
}
```

The interest route returns `201` for `created: true` and `200` with `Interest already recorded` for `created: false`. Admin approve passes `{ action: 'approved', reason: null }`; reject passes the validated reason.

- [ ] **Step 5: Align the checked-in schema without running destructive production SQL**

Replace the `portfolios` definition in `backend/schema.sql` with:

```sql
CREATE TABLE IF NOT EXISTS portfolios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  owner_id INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  sector VARCHAR(100) NOT NULL,
  description TEXT,
  mvp_status ENUM('Idea','Prototype','Beta','Launched') NOT NULL DEFAULT 'Idea',
  funding_goal DECIMAL(15,2) DEFAULT 0,
  team_size INT,
  founded_year YEAR,
  location VARCHAR(255),
  website VARCHAR(500),
  monthly_revenue DECIMAL(15,2),
  user_count INT,
  growth_rate DECIMAL(5,2),
  market_size VARCHAR(500),
  competitor_analysis TEXT,
  advisor_names VARCHAR(500),
  burn_rate DECIMAL(15,2),
  runway_months INT,
  readiness_score INT DEFAULT 0 CHECK (readiness_score BETWEEN 0 AND 100),
  status ENUM('draft','pending','approved','rejected') NOT NULL DEFAULT 'draft',
  rejection_reason TEXT,
  submitted_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);
```

Define `audit_logs.reason TEXT`, retain the existing `approved`, `rejected`, and `requested_changes` enum values (the current UI writes only the first two), and remove the default admin insert and known password hash entirely.

Update `backend/migrate.js` to remove the weak Victor seed and to use `reason`, not `notes`. Do not run `schema.sql` or `migrate.js` against production during this task.

- [ ] **Step 6: Verify and commit atomic workflow behavior**

```bash
cd backend && npm test
cd ..
git add backend/src/services/workflow.js backend/test/workflow-transactions.test.js backend/src/routes/portfolios.js backend/src/routes/admin.js backend/src/routes/interests.js backend/schema.sql backend/migrate.js
git commit -m "fix: make role workflows transactional"
```

---

### Task 5: Enforce the Portfolio State Machine and Idempotent Client Retries

**Files:**
- Create: `backend/test/portfolio-state.test.js`
- Modify: `backend/src/routes/portfolios.js:206-301,303-345,347-480`
- Modify: `js/createportfolio.js:1-285`
- Modify: `createportfolio.html:19-63,223-235`

**Interfaces:**
- Consumes: draft/rejected/approved/pending status and one browser save operation.
- Produces: pending records that cannot be edited, approved/rejected edits that return to draft, and retries that reuse a just-created portfolio ID.

- [ ] **Step 1: Write failing state-contract tests**

Create `backend/test/portfolio-state.test.js` with concrete source-contract assertions:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const route = fs.readFileSync(path.join(root, 'backend/src/routes/portfolios.js'), 'utf8');
const client = fs.readFileSync(path.join(root, 'js/createportfolio.js'), 'utf8');
const page = fs.readFileSync(path.join(root, 'createportfolio.html'), 'utf8');

test('pending portfolios cannot be updated or receive document changes', () => {
  assert.match(route, /portfolio\.status === 'pending'/);
  assert.match(route, /pending portfolio cannot be edited|A pending portfolio cannot be edited/i);
  assert.match(route, /loadOwnedEditablePortfolio/);
});

test('editing approved or rejected content resets review state', () => {
  assert.match(route, /rejection_reason=\?/);
  assert.match(route, /submitted_at=\?/);
  assert.match(route, /was_reset_to_draft/);
});

test('owners cannot delete pending or approved portfolios', () => {
  assert.match(route, /status IN \('draft','rejected'\)/);
  assert.match(route, /cannot be deleted/i);
});

test('a created portfolio ID is written into history before upload starts', () => {
  const replaceAt = client.indexOf('history.replaceState');
  const uploadAt = client.indexOf('API.uploadDocuments');
  assert.ok(replaceAt > 0, 'history.replaceState is required');
  assert.ok(uploadAt > replaceAt, 'the URL must be stabilized before upload');
});

test('save buttons remain disabled while a request is in flight', () => {
  assert.match(client, /let isSaving = false/);
  assert.match(client, /if \(isSaving\) return/);
  assert.match(client, /setSaving\(true\)/);
  assert.match(client, /finally\s*\{\s*setSaving\(false\)/);
  assert.equal((page.match(/data-portfolio-save/g) || []).length, 2);
});
```

- [ ] **Step 2: Run the tests and confirm the current pending/edit behavior fails**

```bash
cd backend && node --test test/portfolio-state.test.js
```

- [ ] **Step 3: Enforce server-side state transitions**

In the update route:

```js
if (portfolio.status === 'pending') {
  return res.status(409).json({ error: 'A pending portfolio cannot be edited' });
}
const newStatus = 'draft';
const submittedAt = null;
const rejectionReason = null;
```

Include `rejection_reason=?` in the update SQL. Return `was_reset_to_draft: portfolio.status !== 'draft'`.

Before upload or document delete, fetch the owned portfolio before Multer/file mutation and reject `pending`. Reset approved/rejected records to draft after a document change. Restrict portfolio deletion with `status IN ('draft','rejected')`; return 409 for pending/approved records.

- [ ] **Step 4: Make the client retain a newly created ID and guard in-flight saves**

Change the declarations to:

```js
let editId = params.get('id') ? Number.parseInt(params.get('id'), 10) : null;
let isSaving = false;
```

Add:

```js
function setSaving(saving) {
  isSaving = saving;
  document.querySelectorAll('[data-portfolio-save]').forEach((button) => {
    button.disabled = saving;
  });
}
```

At the start of `submitForm`, return when `isSaving`, then call `setSaving(true)`. After a successful create:

```js
editId = created.id;
portfolioId = created.id;
history.replaceState(null, '', `createportfolio.html?id=${created.id}`);
```

Always restore `setSaving(false)` in `finally`. Do not return after an update resets to draft; continue to upload and call `/submit` when the requested action is pending.

Mark both buttons in `createportfolio.html` with `data-portfolio-save`, and add the missing Messages navigation target.

- [ ] **Step 5: Match frontend upload limits before sending**

Define:

```js
const ALLOWED_UPLOAD_EXTENSIONS = new Set(['pdf', 'ppt', 'pptx', 'doc', 'docx']);
const MAX_UPLOAD_FILES = 5;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
```

Reject unsupported extensions, files over 10 MB, and a combined existing/pending count over five before changing `pendingFiles`.

- [ ] **Step 6: Verify and commit the state flow**

```bash
cd backend && npm test
cd ..
git add backend/test/portfolio-state.test.js backend/src/routes/portfolios.js js/createportfolio.js createportfolio.html
git commit -m "fix: enforce portfolio review states"
```

---

### Task 6: Secure Document Storage and Download Authorization

**Files:**
- Create: `backend/test/documents-security.test.js`
- Modify: `backend/src/middleware/upload.js`
- Modify: `backend/src/routes/portfolios.js:108-143,347-448`
- Modify: `backend/server.js:76`
- Modify: `js/api.js`
- Modify: `js/moderatordashboard.js:176-193`

**Interfaces:**
- Consumes: authenticated user, portfolio/document IDs, and allowed Office/PDF uploads.
- Produces: safe server extensions, no public static upload directory, and authorized attachment downloads.

- [ ] **Step 1: Write failing document-security tests**

Create `backend/test/documents-security.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const multer = require('multer');
const { fileFilter } = require('../src/middleware/upload');

const root = path.join(__dirname, '..', '..');
const route = fs.readFileSync(path.join(root, 'backend/src/routes/portfolios.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'backend/server.js'), 'utf8');

test('an allowed MIME with an html extension is rejected', async () => {
  const error = await new Promise((resolve) => {
    fileFilter(null, { mimetype: 'application/pdf', originalname: 'payload.html' }, (value) => resolve(value));
  });
  assert.ok(error instanceof multer.MulterError);
});

test('the owned portfolio is checked before multer writes a file', () => {
  assert.match(route, /loadOwnedEditablePortfolio,\s*upload\.array\('documents', 5\)/);
});

test('draft documents are unavailable to unrelated investors', () => {
  assert.match(route, /req\.user\.role === 'investor' && doc\.status === 'approved'/);
  assert.match(route, /return res\.status\(403\)\.json\(\{ error: 'Forbidden' \}\)/);
});

test('download responses use attachment disposition', () => {
  assert.match(route, /documents\/:docId\/download/);
  assert.match(route, /res\.download\(absolute, doc\.file_name\)/);
  assert.doesNotMatch(server, /express\.static\(path\.join\(__dirname, 'uploads'\)\)/);
});

test('multer size and type failures return 4xx JSON', () => {
  assert.match(server, /error instanceof multer\.MulterError/);
  assert.match(server, /error\.code === 'LIMIT_FILE_SIZE' \? 413 : 400/);
});
```

- [ ] **Step 2: Run the tests and confirm the existing public/static behavior fails**

```bash
cd backend && node --test test/documents-security.test.js
```

- [ ] **Step 3: Make filenames derive only from the allowlisted MIME type**

In `upload.js`, require the original extension to equal `ALLOWED_MIME_TYPES[file.mimetype]`, name the stored file with only that mapped extension, name the Multer instance `upload`, and export the tested pieces:

```js
function fileFilter(req, file, cb) {
  const expected = ALLOWED_MIME_TYPES[file.mimetype];
  const actual = path.extname(file.originalname).toLowerCase();
  if (!expected || actual !== expected) {
    return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'documents'));
  }
  cb(null, true);
}

filename: (req, file, cb) => {
  const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  cb(null, `${unique}${ALLOWED_MIME_TYPES[file.mimetype]}`);
}

module.exports = { upload, fileFilter, ALLOWED_MIME_TYPES };
```

Update `portfolios.js` to import `{ upload }`.

- [ ] **Step 4: Authorize before upload and serve downloads through a route**

Add a `loadOwnedEditablePortfolio` middleware before `upload.array`. Add:

```js
router.get('/:id/documents/:docId/download', authenticate, async (req, res) => {
  const [rows] = await db.query(
    `SELECT d.*, p.owner_id, p.status
       FROM portfolio_documents d
       JOIN portfolios p ON p.id=d.portfolio_id
      WHERE d.id=? AND p.id=?`,
    [req.params.docId, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Document not found' });
  const doc = rows[0];
  const allowed = req.user.role === 'admin'
    || Number(doc.owner_id) === Number(req.user.id)
    || (req.user.role === 'investor' && doc.status === 'approved');
  if (!allowed) return res.status(403).json({ error: 'Forbidden' });
  const absolute = path.join(__dirname, '..', '..', doc.file_url.replace(/^\/uploads\//, 'uploads/'));
  return res.download(absolute, doc.file_name);
});
```

Remove this exact line from `server.js`:

```js
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
```

Map each returned document with:

```js
const withDownloadUrl = (doc) => ({
  ...doc,
  download_url: `/api/portfolios/${doc.portfolio_id}/documents/${doc.id}/download`,
});
```

- [ ] **Step 5: Update the frontend and classify upload errors**

Change `API.resolveFileUrl` to return its input unchanged, and make the moderator use `d.download_url`. Import `multer` in `server.js` and place this handler after all routes but before the generic 500 handler:

```js
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return res.status(status).json({ error: 'Invalid document upload' });
  }
  return next(error);
});
```

- [ ] **Step 6: Verify and commit document security**

```bash
cd backend && npm test
cd ..
git add backend/test/documents-security.test.js backend/src/middleware/upload.js backend/src/routes/portfolios.js backend/server.js js/api.js js/moderatordashboard.js
git commit -m "fix: protect portfolio documents"
```

---

### Task 7: Remove Dead Ends and Escape Stored Dashboard Data

**Files:**
- Create: `backend/test/frontend-flow-contract.test.js`
- Modify: `businessownerdashboard.html`
- Modify: `investordashboard.html`
- Modify: `messages.html`
- Modify: `moderatordashboard.html`
- Modify: `audit-logs.html`
- Modify: `mybusinesses.html`
- Modify: `createportfolio.html`
- Modify: `js/browse.js`
- Modify: `js/api.js`
- Modify: `js/my-interests.js`
- Modify: `js/mybusinesses.js`
- Modify: `js/createportfolio.js`
- Modify: `js/moderatordashboard.js`
- Modify: `js/audit-logs.js`
- Modify: `js/investordashboard.js`

**Interfaces:**
- Consumes: existing page IDs, role APIs, and stored database strings.
- Produces: valid navigation targets, consistent redirects/sign-out, visible failures, and escaped dynamic content.

- [ ] **Step 1: Write the static flow-contract test**

Create `backend/test/frontend-flow-contract.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..', '..');
const pages = fs.readdirSync(root).filter((name) => name.endsWith('.html'));
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('every literal local html target exists', () => {
  for (const page of pages) {
    const source = read(page);
    const targets = [...source.matchAll(/(?:href=|location\.href\s*=\s*)["']([^"'?#]+\.html)/g)].map((match) => match[1]);
    for (const target of targets) {
      assert.ok(fs.existsSync(path.join(root, target)), `${page} -> ${target}`);
    }
  }
});

test('visible navigation buttons have click behavior', () => {
  for (const page of pages) {
    const source = read(page);
    const buttons = [...source.matchAll(/<button\b[^>]*class=["'][^"']*nav-btn[^"']*["'][^>]*>/g)].map((match) => match[0]);
    for (const button of buttons) {
      assert.match(button, /onclick=|id=/, `${page}: ${button}`);
    }
  }
});

test('all protected role pages provide sign out', () => {
  const protectedPages = [
    'businessownerdashboard.html', 'mybusinesses.html', 'createportfolio.html',
    'investordashboard.html', 'browse.html', 'my-interests.html', 'messages.html',
    'moderatordashboard.html', 'audit-logs.html',
  ];
  for (const page of protectedPages) assert.match(read(page), /signOut|signout/i, page);
});

test('business dashboard escapes database strings before interpolation', () => {
  const source = read('businessownerdashboard.html');
  for (const expression of ['p.name', 'p.sector', 'i.investor', 'i.portfolio', 'n.title', 'n.body']) {
    assert.match(source, new RegExp(`escapeHtml\\(${expression.replace('.', '\\.') }\\)`), expression);
  }
});

test('investor message buttons include partner and portfolio context', () => {
  for (const file of ['js/browse.js', 'js/my-interests.js']) {
    const source = read(file);
    assert.match(source, /partnerId: portfolio\.owner_id/);
    assert.match(source, /portfolioId: portfolio\.id/);
  }
});

test('browser JavaScript passes node syntax checking', () => {
  for (const name of fs.readdirSync(path.join(root, 'js')).filter((item) => item.endsWith('.js'))) {
    const result = spawnSync(process.execPath, ['--check', path.join(root, 'js', name)], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
});
```

- [ ] **Step 2: Run it and record the dead controls and unsafe dashboard output**

```bash
cd backend && node --test test/frontend-flow-contract.test.js
```

- [ ] **Step 3: Escape all business-dashboard database strings**

Add the full five-character `escapeHtml` helper. Build message URLs with `URLSearchParams` once, then escape the complete URL before interpolation. Escape portfolio name/sector/status, investor name, portfolio name, notification title, and notification body. Never embed raw names inside single-quoted JavaScript arguments.

Use:

```js
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function investorMessageUrl(interest) {
  return `messages.html?${new URLSearchParams({
    partnerId: interest.investor_id,
    partnerName: interest.investor,
    partnerRole: 'investor',
    portfolioId: interest.portfolio_id,
    portfolioName: interest.portfolio,
  }).toString()}`;
}
```

Inside each interest map, compute `const messageUrl = escapeHtml(investorMessageUrl(i));` and set `onclick="window.location.href='${messageUrl}'"`.

- [ ] **Step 4: Make authentication failures and sign-out consistent**

On failed `/auth/me` or wrong role, call `clearSession()` and redirect to `signin.html` in My Businesses, Create Portfolio, Moderator Dashboard, and Audit Logs. Remove duplicate local `signOut` implementations in pages that load `js/api.js`; use the shared function.

Add this shared helper to `js/api.js`:

```js
async function requirePageRole(requiredRole) {
  try {
    const user = await API.getCurrentUser();
    if (user.role !== requiredRole) throw new Error('Incorrect role');
    return user;
  } catch (error) {
    clearSession();
    window.location.href = 'signin.html';
    return null;
  }
}
```

Use `await requirePageRole('business_owner')` in My Businesses/Create Portfolio and `await requirePageRole('admin')` in Moderator/Audit Logs; return immediately when it returns `null`.

- [ ] **Step 5: Resolve visible dead ends without adding a new product feature**

- Add the missing Messages, Browse, and My Interests navigation targets.
- Make recommendation Refresh call the existing dashboard reload function with an in-flight guard.
- Remove inert bell buttons from pages that have no notification panel.
- Remove the inert business-dashboard `View all` button while retaining the existing notification list.
- Show an explicit error state when Browse API requests fail instead of rendering zero startups.
- Ensure message refresh reports success only after its request succeeds.

- [ ] **Step 6: Verify and commit frontend coherence**

```bash
for file in js/*.js; do node --check "$file"; done
cd backend && npm test
cd ..
git add backend/test/frontend-flow-contract.test.js businessownerdashboard.html investordashboard.html messages.html moderatordashboard.html audit-logs.html mybusinesses.html createportfolio.html js
git commit -m "fix: complete the three-role navigation flow"
```

---

### Task 8: Build the Unified Loopback Service and Deployment Contract

**Files:**
- Create: `backend/src/schema-contract.js`
- Create: `backend/deploy/lumilabs-backend.service`
- Create: `backend/deploy/apache-lumilabs-proxy.conf`
- Create: `backend/deploy/runtime-manifest.txt`
- Modify: `backend/server.js`
- Modify: `backend/package.json`
- Modify: `backend/package-lock.json`
- Modify: `backend/test/messages-server.test.js`
- Modify: `backend/test/messages-route.test.js`
- Modify: `backend/test/messages-deployment-files.test.js`
- Delete: `backend/messages-server.js`
- Delete: `backend/deploy/lumilabs-messaging.service`
- Delete: `backend/deploy/apache-messages-proxy.conf`

**Interfaces:**
- Consumes: private `.env`, loopback port 3100, MySQL schema, and Apache `/api` requests.
- Produces: `createApp()`, `/api/health`, `/api/ready`, `lumilabs-backend.service`, and an allowlisted release manifest.

- [ ] **Step 1: Rewrite deployment tests for the approved end state**

Assert that:

```js
assert.match(service, /WorkingDirectory=\/var\/www\/lumilabs-backend/);
assert.match(service, /Environment=HOST=127\.0\.0\.1/);
assert.match(service, /Environment=PORT=3100/);
assert.match(service, /EnvironmentFile=\/var\/www\/lumilabs-backend\/\.env/);
assert.match(service, /ExecStart=.*\/node server\.js/);
assert.match(proxy, /ProxyPass "\/api\/" "http:\/\/127\.0\.0\.1:3100\/api\/"/);
assert.match(proxy, /ProxyPassReverse "\/api\/" "http:\/\/127\.0\.0\.1:3100\/api\/"/);
assert.doesNotMatch(proxy, /3001|messages-server/);
```

The runtime manifest test must reject `backend/.env`, `backend/node_modules`, `backend/test`, `backend/deploy`, `docs`, `.vscode`, and `README.md`.

Update both message server and route tests to import `createApp` from `../server` instead of `createMessagingApp` from `../messages-server`. The shallow server test requests `/api/health` and expects `{ status: 'ok' }`; it must not call `/api/ready` because that intentionally checks MySQL.

- [ ] **Step 2: Run deployment tests and observe old messaging-only expectations**

```bash
cd backend && node --test test/messages-deployment-files.test.js test/messages-server.test.js
```

- [ ] **Step 3: Add schema readiness without returning schema or secrets**

Create `backend/src/schema-contract.js`:

```js
const REQUIRED_COLUMNS = {
  users: ['id', 'email', 'password_hash', 'name', 'role'],
  portfolios: [
    'id', 'owner_id', 'name', 'sector', 'description', 'mvp_status',
    'funding_goal', 'team_size', 'founded_year', 'location', 'website',
    'monthly_revenue', 'user_count', 'growth_rate', 'market_size',
    'competitor_analysis', 'advisor_names', 'burn_rate', 'runway_months',
    'readiness_score', 'status', 'rejection_reason', 'submitted_at',
    'created_at', 'updated_at',
  ],
  portfolio_documents: ['id', 'portfolio_id', 'file_name', 'file_url', 'file_type', 'uploaded_at'],
  investor_interests: ['id', 'investor_id', 'portfolio_id', 'created_at'],
  messages: ['id', 'sender_id', 'receiver_id', 'portfolio_id', 'content', 'read_at', 'created_at'],
  notifications: [
    'id', 'user_id', 'type', 'title', 'body', 'related_portfolio_id',
    'related_user_id', 'read_at', 'created_at',
  ],
  audit_logs: ['id', 'admin_id', 'action', 'portfolio_id', 'reason', 'created_at'],
};

async function verifySchema(db) {
  const [rows] = await db.query(
    `SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name
       FROM information_schema.columns
      WHERE TABLE_SCHEMA = DATABASE()`
  );
  const present = new Set(rows.map(({ table_name, column_name }) => `${table_name}.${column_name}`));
  const missing = [];
  for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
    for (const column of columns) {
      if (!present.has(`${table}.${column}`)) missing.push(`${table}.${column}`);
    }
  }
  if (missing.length) throw new Error(`Missing schema fields: ${missing.join(', ')}`);
  return true;
}

module.exports = { REQUIRED_COLUMNS, verifySchema };
```

- [ ] **Step 4: Refactor `server.js` into a testable unified app**

Replace `backend/server.js` with a module organized around these complete functions. Keep route imports inside `createApp` so the DB pool is created after the optional tunnel updates `DB_HOST`/`DB_PORT`:

```js
require('dotenv').config();

function validateEnvironment() {
  const required = ['JWT_SECRET', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`Missing environment variables: ${missing.join(', ')}`);
  if (process.env.SSH_HOST) {
    const sshRequired = ['SSH_USER', 'SSH_PASSWORD'];
    const sshMissing = sshRequired.filter((name) => !process.env[name]);
    if (sshMissing.length) throw new Error(`Missing SSH environment variables: ${sshMissing.join(', ')}`);
  }
}

async function openSshTunnel() {
  if (!process.env.SSH_HOST) return null;
  const { Client } = require('ssh2');
  const net = require('node:net');
  const tunnelPort = Number(process.env.DB_TUNNEL_PORT || 3307);
  return new Promise((resolve, reject) => {
    const connection = new Client();
    connection.on('ready', () => {
      const server = net.createServer((socket) => {
        connection.forwardOut('127.0.0.1', 0, '127.0.0.1', 3306, (error, stream) => {
          if (error) return socket.destroy(error);
          socket.pipe(stream).pipe(socket);
        });
      });
      server.once('error', reject);
      server.listen(tunnelPort, '127.0.0.1', () => {
        process.env.DB_HOST = '127.0.0.1';
        process.env.DB_PORT = String(tunnelPort);
        resolve({ connection, server });
      });
    });
    connection.on('keyboard-interactive', (name, instructions, language, prompts, finish) => {
      finish([process.env.SSH_PASSWORD]);
    });
    connection.once('error', reject);
    connection.connect({
      host: process.env.SSH_HOST,
      port: Number(process.env.SSH_PORT || 22),
      username: process.env.SSH_USER,
      password: process.env.SSH_PASSWORD,
      tryKeyboard: true,
      readyTimeout: 30000,
    });
  });
}

function createApp() {
  const express = require('express');
  const multer = require('multer');
  const db = require('./src/config/db');
  const { verifySchema } = require('./src/schema-contract');
  const app = express();

  app.use(express.json());
  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
  app.get('/api/ready', async (req, res) => {
    try {
      await db.query('SELECT 1');
      await verifySchema(db);
      res.json({ status: 'ready' });
    } catch (error) {
      console.error('Readiness check failed:', error.message);
      res.status(503).json({ status: 'not_ready' });
    }
  });

  app.use('/api/auth', require('./src/routes/auth'));
  app.use('/api/portfolios', require('./src/routes/portfolios'));
  app.use('/api/interests', require('./src/routes/interests'));
  app.use('/api/messages', require('./src/routes/messages'));
  app.use('/api/admin', require('./src/routes/admin'));
  app.use('/api/notifications', require('./src/routes/notifications'));
  app.use('/api/recommendations', require('./src/routes/recommendations'));
  app.use('/api/dashboard', require('./src/routes/dashboard'));

  app.use((req, res) => res.status(404).json({ error: 'Route not found' }));
  app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
      const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return res.status(status).json({ error: 'Invalid document upload' });
    }
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  });
  return app;
}

async function main() {
  validateEnvironment();
  await openSshTunnel();
  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT) || 3100;
  const app = createApp();
  app.listen(port, host, () => console.log(`Lumi5 Labs API listening on ${host}:${port}`));
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Fatal startup error:', error.message);
    process.exit(1);
  });
}

module.exports = { createApp, main, openSshTunnel, validateEnvironment };
```

Remove the unused `cors` dependency with `cd backend && npm uninstall cors && cd ..`; same-origin Apache requests do not require CORS.

- [ ] **Step 5: Add exact systemd and Apache artifacts**

`lumilabs-backend.service`:

```ini
[Unit]
Description=LumiLabs unified API
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=user
Group=www-data
WorkingDirectory=/var/www/lumilabs-backend
Environment=NODE_ENV=production
Environment=HOST=127.0.0.1
Environment=PORT=3100
EnvironmentFile=/var/www/lumilabs-backend/.env
ExecStart=/opt/lumilabs-messaging/current/bin/node server.js
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=/var/www/lumilabs-backend/uploads

[Install]
WantedBy=multi-user.target
```

`apache-lumilabs-proxy.conf`:

```apache
ProxyPass "/api/" "http://127.0.0.1:3100/api/"
ProxyPassReverse "/api/" "http://127.0.0.1:3100/api/"
```

Create `runtime-manifest.txt` with exactly:

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
signin.html
signup.html
css/style.css
js/api.js
js/audit-logs.js
js/browse.js
js/createportfolio.js
js/investordashboard.js
js/messages.js
js/moderatordashboard.js
js/my-interests.js
js/mybusinesses.js
js/script.js
backend/server.js
backend/package.json
backend/package-lock.json
backend/src/schema-contract.js
backend/src/config/db.js
backend/src/middleware/auth.js
backend/src/middleware/upload.js
backend/src/routes/admin.js
backend/src/routes/auth.js
backend/src/routes/dashboard.js
backend/src/routes/interests.js
backend/src/routes/messages.js
backend/src/routes/notifications.js
backend/src/routes/portfolios.js
backend/src/routes/recommendations.js
backend/src/services/workflow.js
```

It intentionally contains no secret, dependency, upload, test, docs, editor, or deployment-source path.

- [ ] **Step 6: Remove obsolete messaging-only source and verify**

```bash
git rm backend/messages-server.js backend/deploy/lumilabs-messaging.service backend/deploy/apache-messages-proxy.conf
cd backend && npm test
cd ..
git add backend/server.js backend/src/schema-contract.js backend/deploy backend/test
git commit -m "feat: add the unified private API service"
```

---

### Task 9: Add a Self-Cleaning Live Three-Role Smoke Runner

**Files:**
- Create: `backend/scripts/live-three-role-smoke.js`
- Create: `backend/test/live-smoke-contract.test.js`
- Modify: `backend/package.json`

**Interfaces:**
- Consumes: `LUMILABS_E2E_ORIGIN`, the private `.env`, and the already-running SSH tunnel at `DB_TUNNEL_PORT`.
- Produces: temporary owner/investor/admin records, full workflow evidence, and guaranteed cleanup by unique email prefix.

- [ ] **Step 1: Write a contract test for safe live-runner behavior**

Create `backend/test/live-smoke-contract.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'scripts', 'live-three-role-smoke.js'),
  'utf8'
);

test('live smoke is explicitly targeted and self-cleaning', () => {
  assert.match(source, /LUMILABS_E2E_ORIGIN/);
  assert.match(source, /codex_e2e_/);
  assert.match(source, /finally/);
  assert.match(source, /DELETE FROM users WHERE email IN/);
  assert.doesNotMatch(source, /victor@lumilabs\.com|admin123|password\s*=/i);
});
```

- [ ] **Step 2: Implement the smoke runner with exact lifecycle**

Create `backend/scripts/live-three-role-smoke.js` with this complete lifecycle:

```js
require('dotenv').config();
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const mysql = require('mysql2/promise');

const origin = String(process.env.LUMILABS_E2E_ORIGIN || '').replace(/\/$/, '');
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin) && origin !== 'http://35.212.144.149') {
  throw new Error('LUMILABS_E2E_ORIGIN must target loopback or the approved public origin');
}

const prefix = `codex_e2e_${Date.now()}`;
const emails = {
  owner: `${prefix}_owner@example.invalid`,
  investor: `${prefix}_investor@example.invalid`,
  admin: `${prefix}_admin@example.invalid`,
};
const userPassword = crypto.randomBytes(24).toString('base64url');
let db;
let portfolioId;

async function api(requestPath, { method = 'GET', token, body, form } = {}) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${origin}/api${requestPath}`, {
    method,
    headers,
    body: form || (body === undefined ? undefined : JSON.stringify(body)),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.error || payload.errors?.[0]?.msg || 'request failed';
    const error = new Error(`${method} ${requestPath}: ${response.status} ${message}`);
    error.status = response.status;
    throw error;
  }
  return { status: response.status, data: payload };
}

async function register(role, email, name) {
  return (await api('/auth/register', {
    method: 'POST',
    body: { role, email, name, password: userPassword },
  })).data;
}

async function main() {
  db = await mysql.createConnection({
    host: '127.0.0.1',
    port: Number(process.env.DB_TUNNEL_PORT || process.env.DB_PORT || 3307),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  try {
    const adminHash = await bcrypt.hash(userPassword, 10);
    await db.execute(
      "INSERT INTO users (email,password_hash,name,role) VALUES (?,?,?,'admin')",
      [emails.admin, adminHash, `${prefix} Admin`]
    );

    const owner = await register('business_owner', emails.owner, `${prefix} Owner`);
    const investor = await register('investor', emails.investor, `${prefix} Investor`);
    const admin = (await api('/auth/login', {
      method: 'POST', body: { email: emails.admin, password: userPassword },
    })).data;

    assert.equal((await api('/auth/me', { token: owner.token })).data.role, 'business_owner');
    assert.equal((await api('/auth/me', { token: investor.token })).data.role, 'investor');
    assert.equal((await api('/auth/me', { token: admin.token })).data.role, 'admin');
    await assert.rejects(
      api('/admin/stats', { token: owner.token }),
      (error) => error.status === 403
    );

    const created = (await api('/portfolios', {
      method: 'POST', token: owner.token,
      body: {
        name: `${prefix} Portfolio`, sector: 'Technology', mvp_status: 'Beta',
        description: 'Temporary end-to-end portfolio used only for deployment verification.',
        funding_goal: 100000, team_size: 3, founded_year: 2026,
        location: 'Singapore', website: '', monthly_revenue: 1000,
        user_count: 10, growth_rate: 5, market_size: 'Temporary market',
        competitor_analysis: 'Temporary comparison', advisor_names: '',
        burn_rate: 100, runway_months: 12,
      },
    })).data;
    portfolioId = created.id;

    const form = new FormData();
    const pdf = new Blob([Buffer.from('%PDF-1.4\n%%EOF\n')], { type: 'application/pdf' });
    form.append('documents', pdf, `${prefix}.pdf`);
    const uploaded = (await api(`/portfolios/${portfolioId}/documents`, {
      method: 'POST', token: owner.token, form,
    })).data;
    assert.equal(uploaded.documents.length, 1);

    await api(`/portfolios/${portfolioId}/submit`, { method: 'POST', token: owner.token });
    const queue = (await api('/admin/queue', { token: admin.token })).data;
    assert.ok(queue.some(({ id }) => Number(id) === Number(portfolioId)));
    await api(`/admin/portfolios/${portfolioId}/approve`, { method: 'PUT', token: admin.token });

    const browse = (await api('/portfolios', { token: investor.token })).data;
    assert.ok(browse.some(({ id }) => Number(id) === Number(portfolioId)));

    const firstInterest = await api(`/interests/${portfolioId}`, { method: 'POST', token: investor.token });
    const secondInterest = await api(`/interests/${portfolioId}`, { method: 'POST', token: investor.token });
    assert.equal(firstInterest.status, 201);
    assert.equal(secondInterest.status, 200);

    await api('/messages', {
      method: 'POST', token: owner.token,
      body: { receiver_id: investor.user.id, portfolio_id: portfolioId, content: `${prefix} owner message` },
    });
    await api('/messages', {
      method: 'POST', token: investor.token,
      body: { receiver_id: owner.user.id, portfolio_id: portfolioId, content: `${prefix} investor reply` },
    });
    const thread = (await api(`/messages/conversations/${owner.user.id}`, { token: investor.token })).data;
    assert.ok(thread.some(({ content }) => content === `${prefix} owner message`));
    assert.ok(thread.some(({ content }) => content === `${prefix} investor reply`));

    const ownerNotifications = (await api('/notifications', { token: owner.token })).data;
    const matchingInterest = ownerNotifications.filter(
      ({ type, related_portfolio_id }) => type === 'new_interest' && Number(related_portfolio_id) === Number(portfolioId)
    );
    assert.equal(matchingInterest.length, 1);
    const audit = (await api('/admin/audit-logs', { token: admin.token })).data;
    assert.ok(audit.some(({ portfolio_id, action }) => Number(portfolio_id) === Number(portfolioId) && action === 'approved'));

    console.log('Live three-role smoke passed');
  } finally {
    if (db) {
      const [documents] = await db.query(
        `SELECT d.file_url FROM portfolio_documents d
          JOIN portfolios p ON p.id=d.portfolio_id
          JOIN users u ON u.id=p.owner_id
         WHERE u.email IN (?,?,?)`,
        [emails.owner, emails.investor, emails.admin]
      );
      for (const { file_url: fileUrl } of documents) {
        if (!/^\/uploads\/portfolio-documents\/[A-Za-z0-9._-]+$/.test(fileUrl)) continue;
        const absolute = path.join(__dirname, '..', fileUrl.replace(/^\/uploads\//, 'uploads/'));
        await fs.unlink(absolute).catch((error) => {
          if (error.code !== 'ENOENT') throw error;
        });
      }
      await db.query('DELETE FROM users WHERE email IN (?,?,?)', [emails.owner, emails.investor, emails.admin]);
      const [remaining] = await db.query('SELECT id FROM users WHERE email IN (?,?,?)', [emails.owner, emails.investor, emails.admin]);
      assert.equal(remaining.length, 0, 'temporary users must be removed');
      await db.end();
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
```

The helper reports method, path, status, and API error only; it never prints tokens or credentials.

- [ ] **Step 3: Add the explicit npm command**

```json
"smoke:live": "node scripts/live-three-role-smoke.js"
```

- [ ] **Step 4: Verify the contract without touching production**

```bash
cd backend
node --test test/live-smoke-contract.test.js
npm test
cd ..
git add backend/scripts/live-three-role-smoke.js backend/test/live-smoke-contract.test.js backend/package.json backend/package-lock.json
git commit -m "test: add a self-cleaning live role smoke check"
```

Do not run `smoke:live` locally or against the public origin yet.

---

### Task 10: Run the Complete Local Release Gate

**Files:**
- No source changes expected.

**Interfaces:**
- Consumes: Tasks 1-9.
- Produces: one tested commit set eligible for remote staging.

- [ ] **Step 1: Run syntax, dependency, test, and secret-path checks**

```bash
for file in js/*.js backend/*.js backend/src/**/*.js backend/scripts/*.js backend/test/*.js; do node --check "$file"; done
cd backend
npm ci
npm ls --depth=0
npm test
cd ..
test -z "$(git ls-files backend/.env '.vscode/**' 'backend/node_modules/**')"
! rg -n 'https?://(localhost|127\.0\.0\.1)|\$\{hostname\}:3000|35\.212\.144\.149:3000' --glob '*.html' --glob 'js/*.js' .
git diff --check origin/main...HEAD
git status --short
```

Expected: every command exits 0, the tests report zero failures, the tracked secret/generated-path check is empty, and the browser-origin scan returns no matches.

- [ ] **Step 2: Stop if the release gate changes the worktree**

If `npm ci` or tests modify tracked files, inspect and either commit an intentional manifest update or restore only generated changes. Do not proceed with an unclean worktree.

---

### Task 11: Preflight and Stage the Private Backend Without Changing Live Traffic

**Files:**
- Create remotely: `/var/www/lumilabs-backend`
- Create remotely: `/etc/systemd/system/lumilabs-backend.service`
- Create remotely: `/home/user/lumilabs-quarantine-20260722-unified-api`
- Preserve remotely: `/var/www/html`, `/etc/apache2/sites-available/000-default.conf`, `lumilabs-messaging.service`

**Interfaces:**
- Consumes: verified source, current production `.env`/uploads, and Node runtime.
- Produces: a ready service on `127.0.0.1:3100` with live traffic unchanged.

- [ ] **Step 1: Establish SSH and record exact live state**

Run interactively without putting passwords in command arguments:

```bash
ssh user@35.212.144.149
```

Then:

```bash
set -eu
test ! -e /home/user/lumilabs-quarantine-20260722-unified-api
test ! -e /var/www/html-pre-unified-api-20260722
test ! -e /var/www/html-next
sudo systemctl is-active apache2
sudo systemctl is-active lumilabs-messaging
ss -ltn
sudo apache2ctl -S
sudo apache2ctl configtest
```

Expected: Apache and the current messaging service are active, configtest says `Syntax OK`, and port 3100 is unused. Stop if any target path already exists.

- [ ] **Step 2: Create recoverable backups and inventory the current web root**

```bash
install -d -m 0750 /home/user/lumilabs-quarantine-20260722-unified-api
sudo cp -a /etc/apache2/sites-available/000-default.conf /home/user/lumilabs-quarantine-20260722-unified-api/000-default.conf.before
sudo cp -a /etc/systemd/system/lumilabs-messaging.service /home/user/lumilabs-quarantine-20260722-unified-api/lumilabs-messaging.service.before
sudo find /var/www/html -type f -exec sha256sum {} \; | sudo tee /home/user/lumilabs-quarantine-20260722-unified-api/webroot-before.sha256 >/dev/null
```

- [ ] **Step 3: Stage private runtime data without exposing or overwriting secrets**

```bash
sudo install -d -o user -g www-data -m 0750 /var/www/lumilabs-backend
sudo install -d -o user -g www-data -m 0770 /var/www/lumilabs-backend/uploads
sudo cp -a /var/www/html/backend/.env /var/www/lumilabs-backend/.env
sudo cp -a /var/www/html/backend/uploads/. /var/www/lumilabs-backend/uploads/
sudo chown -R user:www-data /var/www/lumilabs-backend
chmod 0640 /var/www/lumilabs-backend/.env
```

Upload only manifest paths beginning with `backend/`; strip that prefix so `backend/server.js` becomes `/var/www/lumilabs-backend/server.js` and `backend/src/routes/auth.js` becomes `/var/www/lumilabs-backend/src/routes/auth.js`. Do not upload `.env`, dependencies, uploads, tests, docs, or deployment sources.

Upload `backend/deploy/lumilabs-backend.service` separately to the exact staging path `/home/user/lumilabs-quarantine-20260722-unified-api/lumilabs-backend.service.next`.

- [ ] **Step 4: Install production dependencies and start the staged service**

On the server:

```bash
cd /var/www/lumilabs-backend
/opt/lumilabs-messaging/current/bin/npm ci --omit=dev
sudo install -o root -g root -m 0644 /home/user/lumilabs-quarantine-20260722-unified-api/lumilabs-backend.service.next /etc/systemd/system/lumilabs-backend.service
sudo systemctl daemon-reload
sudo systemctl enable --now lumilabs-backend.service
sudo systemctl is-active lumilabs-backend.service
curl -fsS http://127.0.0.1:3100/api/health
curl -fsS http://127.0.0.1:3100/api/ready
```

Before executing the `install` command, verify that the staged service file is owned by `user`, is mode `0644` or stricter, and matches the repository SHA-256 hash.

- [ ] **Step 5: Run the temporary three-role smoke test against loopback**

```bash
cd /var/www/lumilabs-backend
LUMILABS_E2E_ORIGIN=http://127.0.0.1:3100 /opt/lumilabs-messaging/current/bin/npm run smoke:live
```

Expected: every role step passes and the script confirms zero temporary users remain. If any step fails, stop here; do not alter Apache or `/var/www/html`.

---

### Task 12: Perform the Staged Apache and Atomic Frontend Cutover

**Files:**
- Create remotely: `/var/www/html-next`
- Modify remotely from a staged, reviewed copy: `/etc/apache2/sites-available/000-default.conf`
- Rename remotely: `/var/www/html` to `/var/www/html-pre-unified-api-20260722`
- Rename remotely: `/var/www/html-next` to `/var/www/html`

**Interfaces:**
- Consumes: ready service at port 3100 and allowlisted frontend release.
- Produces: public same-origin frontend/API with immediate directory/config rollback.

- [ ] **Step 1: Stage only allowlisted frontend files**

```bash
sudo install -d -o user -g www-data -m 0755 /var/www/html-next
install -d -m 0755 /var/www/html-next/css /var/www/html-next/js
```

Upload the 12 HTML files, `css/style.css`, and ten JavaScript files from the runtime manifest. Verify:

```bash
find /var/www/html-next -type f -print | sort
! find /var/www/html-next -maxdepth 1 -type d -name backend | grep .
! grep -R -nE 'localhost|:3000' /var/www/html-next
```

- [ ] **Step 2: Stage and validate the Apache change**

Fetch `/etc/apache2/sites-available/000-default.conf` to a local temporary file. Use `apply_patch` to replace the two port-3001 message-only proxy lines with:

```apache
ProxyPass "/api/" "http://127.0.0.1:3100/api/"
ProxyPassReverse "/api/" "http://127.0.0.1:3100/api/"
```

Upload the reviewed file to the quarantine staging directory, then:

```bash
sudo install -o root -g root -m 0644 /home/user/lumilabs-quarantine-20260722-unified-api/000-default.conf.next /etc/apache2/sites-available/000-default.conf
sudo apache2ctl configtest
```

Expected: `Syntax OK`. On failure, restore `000-default.conf.before` immediately and stop.

- [ ] **Step 3: Reload Apache onto the already-verified unified API**

```bash
sudo systemctl reload apache2
curl -fsS http://35.212.144.149/api/health
curl -fsS http://35.212.144.149/api/ready
```

Expected: both checks succeed while the old frontend directory is still active. If either fails, restore `000-default.conf.before`, reload Apache, and stop.

- [ ] **Step 4: Switch the frontend directory atomically**

Resolve and validate all three paths literally, then run:

```bash
sudo mv /var/www/html /var/www/html-pre-unified-api-20260722
sudo mv /var/www/html-next /var/www/html
```

- [ ] **Step 5: Run immediate public checks with automatic rollback on failure**

Check all 12 pages, their local scripts/styles, `/api/health`, `/api/ready`, unauthenticated `401` behavior, and absence of public backend paths. If any critical check fails:

```bash
sudo install -o root -g root -m 0644 /home/user/lumilabs-quarantine-20260722-unified-api/000-default.conf.before /etc/apache2/sites-available/000-default.conf
sudo mv /var/www/html /var/www/html-failed-unified-api-20260722
sudo mv /var/www/html-pre-unified-api-20260722 /var/www/html
sudo apache2ctl configtest
sudo systemctl reload apache2
```

Do not improvise another fix during rollback.

---

### Task 13: Quarantine the Old Web Root and Complete Live Verification

**Files:**
- Move remotely: `/var/www/html-pre-unified-api-20260722`
- Preserve remotely: `/home/user/lumilabs-quarantine-20260722-unified-api/**`
- Disable but retain remotely: `lumilabs-messaging.service`

**Interfaces:**
- Consumes: successful cutover and public smoke checks.
- Produces: clean web root, recoverable quarantine, and one active unified API service.

- [ ] **Step 1: Run the live three-role smoke test through Apache**

```bash
cd /var/www/lumilabs-backend
LUMILABS_E2E_ORIGIN=http://35.212.144.149 /opt/lumilabs-messaging/current/bin/npm run smoke:live
```

Expected: all role flows pass and the unique temporary records are removed.

- [ ] **Step 2: Verify public exposure boundaries**

For each path, require a non-200 response:

```text
/backend/.env
/backend/package.json
/backend/src/routes/auth.js
/backend/test/messages-route.test.js
/backend/schema.sql
/docs/
/.vscode/sftp.json
```

Also confirm every public HTML page and its referenced local asset returns 200.

- [ ] **Step 3: Disable the old service only after all public checks pass**

```bash
sudo systemctl disable --now lumilabs-messaging.service
sudo systemctl is-active lumilabs-backend.service
sudo systemctl is-active apache2.service
ss -ltn | grep -F '127.0.0.1:3100'
```

Expected: the unified backend and Apache are active, and only the unified loopback listener is required for the application.

- [ ] **Step 4: Move the complete old root into recoverable quarantine**

```bash
sudo mv /var/www/html-pre-unified-api-20260722 /home/user/lumilabs-quarantine-20260722-unified-api/webroot-before
sudo chown -R user:www-data /home/user/lumilabs-quarantine-20260722-unified-api
find /home/user/lumilabs-quarantine-20260722-unified-api -type f -exec sha256sum {} \; > /home/user/lumilabs-quarantine-20260722-unified-api/quarantine.sha256
find /var/www/html -maxdepth 2 -type f -print | sort
```

Expected: `/var/www/html` contains only allowlisted frontend files; all prior backend/docs/support files remain recoverable in quarantine.

- [ ] **Step 5: Run final service, page, API, and database checks**

```bash
sudo apache2ctl configtest
sudo systemctl is-active apache2 lumilabs-backend
curl -fsS http://35.212.144.149/api/health
curl -fsS http://35.212.144.149/api/ready
```

Repeat the page/asset inventory and confirm no temporary `codex_e2e_` users remain.

---

### Task 14: Final Git Review and Push to `main`

**Files:**
- No new source changes expected.

**Interfaces:**
- Consumes: verified local commits and verified live deployment.
- Produces: synchronized local `main`, `origin/main`, and SFTP runtime.

- [ ] **Step 1: Review the complete outgoing scope**

```bash
git status --short --branch
git log --oneline origin/main..main
git diff --stat origin/main..main
git diff --check origin/main..main
```

Expected: a clean worktree and only the approved cleanup/flow commits.

- [ ] **Step 2: Repeat the local release gate**

```bash
cd backend && npm ci && npm test && npm ls --depth=0
cd ..
for file in js/*.js backend/*.js backend/src/**/*.js backend/scripts/*.js backend/test/*.js; do node --check "$file"; done
```

Expected: every command exits 0 with zero test failures.

- [ ] **Step 3: Push without force and verify the remote commit**

```bash
git push origin main
git fetch origin
test "$(git rev-parse main)" = "$(git rev-parse origin/main)"
git status --short --branch
```

Expected: `main` and `origin/main` match and the worktree is clean.

- [ ] **Step 4: Report the security follow-up without changing shared credentials automatically**

Report that the old tracked `.env`, SFTP configuration, and weak seeded-admin hash remain in Git history even though current tracking is removed. Recommend coordinated rotation of the database password, JWT secret, SFTP password, and existing Victor admin password after confirming which teammate tools depend on them. Do not rotate shared credentials as part of this deployment without a separate explicit approval.
