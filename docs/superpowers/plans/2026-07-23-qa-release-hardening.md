# Confirmed QA Release Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Normalize business-owner portfolio counts, invalidate the affected browser assets, publish the confirmed QA fixes to GitHub `main`, and deploy the exact committed runtime to production with rollback protection.

**Architecture:** Keep the application changes narrow: normalize five values at the MySQL-to-JSON boundary and add one release query key to four affected pages. Deploy the single backend route to the private Node runtime, restart and verify it, then publish physical frontend assets before HTML exposes their final cache key.

**Tech Stack:** Node.js 24, Express 4, MySQL 8 with `mysql2`, static HTML/CSS/JavaScript, Node `node:test`, GitHub, SSH/SFTP, Apache, and systemd.

## Global Constraints

- Use `v=20260723.3` for every newly versioned asset reference.
- Do not change database schema or rows, migrations, seeds, accounts, credentials, uploads, Apache configuration, dependencies, or systemd unit files.
- Never upload `.env`, tests, documentation, deployment sources, dependencies, or uploads.
- Map `backend/src/routes/dashboard.js` only to `/var/www/lumilabs-backend/src/routes/dashboard.js`; never place backend source under `/var/www/html`.
- Keep every deployment action hash-verified, staged beside its target, and recoverable from a private release backup.
- Restart only `lumilabs-backend.service`; do not run daemon-reload or reload Apache.
- Never put the SFTP, sudo, or QA-account password in a command, file, Git history, log, or tool output.
- Do not claim signed-in visual coverage unless a browser backend is available and the walkthrough is actually performed.

---

### Task 1: Normalize Portfolio Status Counts at the API Boundary

**Files:**
- Modify: `backend/test/business-owner-dashboard-route.test.js`
- Modify: `backend/src/routes/dashboard.js`

**Interfaces:**
- Consumes: the first-row MySQL aggregate object returned by the business-owner dashboard query.
- Produces: `payload.portfolios.{total,approved,pending,rejected,draft}` as JSON numbers.

- [ ] **Step 1: Make the route regression fixture model MySQL string aggregates**

Change the populated fixture in
`backend/test/business-owner-dashboard-route.test.js` to:

```js
stubDashboardQueries(t, {
  total: '4',
  approved: '1',
  pending: '1',
  rejected: '1',
  draft: '1',
  avg_readiness: '70',
});
```

After the existing deep equality assertion, add:

```js
for (const field of ['total', 'approved', 'pending', 'rejected', 'draft']) {
  assert.equal(typeof payload.portfolios[field], 'number');
}
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test backend/test/business-owner-dashboard-route.test.js
```

Expected: the populated-status test fails because at least one returned field is
a string instead of a number.

- [ ] **Step 3: Normalize the five response fields**

In `backend/src/routes/dashboard.js`, replace the portfolio response object with:

```js
portfolios: {
  total: Number(portfolioStats.total || 0),
  approved: Number(portfolioStats.approved || 0),
  pending: Number(portfolioStats.pending || 0),
  rejected: Number(portfolioStats.rejected || 0),
  draft: Number(portfolioStats.draft || 0),
},
```

Do not change `avg_readiness` or any other route field.

- [ ] **Step 4: Run the route tests and verify GREEN**

Run:

```bash
node --test backend/test/business-owner-dashboard-route.test.js
```

Expected: both route tests pass.

- [ ] **Step 5: Commit the numeric contract fix**

```bash
git add backend/src/routes/dashboard.js backend/test/business-owner-dashboard-route.test.js
git commit -m "fix: normalize owner dashboard status counts"
```

---

### Task 2: Cache-Key the Confirmed QA Assets

**Files:**
- Modify: `backend/test/frontend-flow-contract.test.js`
- Modify: `businessownerdashboard.html`
- Modify: `browse.html`
- Modify: `mybusinesses.html`
- Modify: `relationshipmanagerdashboard.html`

**Interfaces:**
- Consumes: changed physical assets at their existing paths.
- Produces: HTML requests using the exact `v=20260723.3` release key.

- [ ] **Step 1: Add the failing cache-key contract**

Append this test to `backend/test/frontend-flow-contract.test.js`:

```js
test('confirmed QA pages cache-key every changed frontend asset', () => {
  assert.match(
    read('businessownerdashboard.html'),
    /href=["']css\/style\.css\?v=20260723\.3["']/,
  );
  assert.match(
    read('browse.html'),
    /src=["']js\/browse\.js\?v=20260723\.3["']/,
  );
  assert.match(
    read('mybusinesses.html'),
    /src=["']js\/mybusinesses\.js\?v=20260723\.3["']/,
  );

  const manager = read('relationshipmanagerdashboard.html');
  assert.match(manager, /href=["']css\/style\.css\?v=20260723\.3["']/);
  assert.match(
    manager,
    /src=["']js\/relationshipmanagerdashboard\.js\?v=20260723\.3["']/,
  );
});
```

- [ ] **Step 2: Run the contract test and verify RED**

Run:

```bash
node --test backend/test/frontend-flow-contract.test.js
```

Expected: the new test fails on the first unversioned asset reference.

- [ ] **Step 3: Add only the specified release keys**

Make these exact HTML substitutions:

```html
<!-- businessownerdashboard.html -->
<link rel="stylesheet" href="css/style.css?v=20260723.3" />

<!-- browse.html -->
<script src="js/browse.js?v=20260723.3"></script>

<!-- mybusinesses.html -->
<script src="js/mybusinesses.js?v=20260723.3"></script>

<!-- relationshipmanagerdashboard.html -->
<link rel="stylesheet" href="css/style.css?v=20260723.3" />
<script src="js/relationshipmanagerdashboard.js?v=20260723.3"></script>
```

Do not version unrelated assets.

- [ ] **Step 4: Run the contract test and verify GREEN**

Run:

```bash
node --test backend/test/frontend-flow-contract.test.js
```

Expected: every frontend flow-contract test passes.

- [ ] **Step 5: Commit the cache contract**

```bash
git add \
  backend/test/frontend-flow-contract.test.js \
  businessownerdashboard.html \
  browse.html \
  mybusinesses.html \
  relationshipmanagerdashboard.html
git commit -m "fix: version confirmed QA assets"
```

---

### Task 3: Run the Final Local Release Gate

**Files:**
- Verify only: every path changed from `f3cbbc290926f7526c1f24e4675de69e8c6a2157` through `HEAD`.

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces: a reviewed, clean commit eligible for push and deployment.

- [ ] **Step 1: Run focused tests**

```bash
node --test \
  backend/test/business-owner-dashboard-route.test.js \
  backend/test/frontend-flow-contract.test.js \
  backend/test/mybusinesses-client.test.js \
  backend/test/browse-client.test.js \
  backend/test/relationship-manager-client.test.js
```

Expected: zero failures.

- [ ] **Step 2: Run the complete suite and syntax checks**

```bash
npm --prefix backend test
for release_script in js/*.js; do
  node --check "$release_script"
done
```

Expected: 198 tests pass and every browser script exits with status zero.

- [ ] **Step 3: Verify exact scope and patch hygiene**

Require this exact path set from the production base:

```text
backend/src/routes/dashboard.js
backend/test/browse-client.test.js
backend/test/business-owner-dashboard-route.test.js
backend/test/frontend-flow-contract.test.js
backend/test/mybusinesses-client.test.js
backend/test/relationship-manager-client.test.js
browse.html
businessownerdashboard.html
css/style.css
docs/superpowers/plans/2026-07-23-confirmed-qa-defects.md
docs/superpowers/plans/2026-07-23-qa-release-hardening.md
docs/superpowers/specs/2026-07-23-confirmed-qa-defects-design.md
docs/superpowers/specs/2026-07-23-qa-release-hardening-design.md
js/browse.js
js/mybusinesses.js
js/relationshipmanagerdashboard.js
mybusinesses.html
relationshipmanagerdashboard.html
```

Run:

```bash
git diff --check
git status --porcelain
git diff --name-only f3cbbc290926f7526c1f24e4675de69e8c6a2157..HEAD | sort
```

Expected: no patch-hygiene or worktree output and exactly the 18 paths above.

- [ ] **Step 4: Request fresh code, specification, and release reviews**

Provide reviewers:

```text
Base: f3cbbc290926f7526c1f24e4675de69e8c6a2157
Head: current HEAD
Spec: docs/superpowers/specs/2026-07-23-qa-release-hardening-design.md
Plan: docs/superpowers/plans/2026-07-23-qa-release-hardening.md
```

Do not proceed with any Critical or Important finding unresolved.

---

### Task 4: Publish GitHub `main`

**Files:**
- Remote ref only: `origin/main`.

**Interfaces:**
- Consumes: a clean Task 3 release gate.
- Produces: local and GitHub `main` at one verified commit.

- [ ] **Step 1: Create a temporary preimage reference and fetch**

```bash
test -z "$(git tag --list codex-pre-qa-release-20260723)"
git tag codex-pre-qa-release-20260723 f3cbbc290926f7526c1f24e4675de69e8c6a2157
git fetch origin
git rev-list --left-right --count origin/main...HEAD
```

Expected: zero behind and the known local commits ahead. Stop if
`origin/main` is no longer `f3cbbc290926f7526c1f24e4675de69e8c6a2157`.

- [ ] **Step 2: Push without force**

```bash
git push origin main
```

Expected: a normal fast-forward push.

- [ ] **Step 3: Prove remote identity**

```bash
git rev-parse HEAD
git ls-remote origin refs/heads/main
git status --short --branch
```

Expected: both hashes are identical and local `main` tracks `origin/main`
without divergence.

---

### Task 5: Stage, Back Up, and Deploy the Private Backend

**Files:**
- Deploy: `backend/src/routes/dashboard.js`
- Back up with the frontend runtime files listed in Task 6.

**Interfaces:**
- Consumes: the pushed commit and production preimage commit.
- Produces: a restarted private backend serving numeric portfolio counts.

- [ ] **Step 1: Open one authenticated SSH control connection**

Start a local interactive shell and define:

```bash
release_ssh_dir=$(mktemp -d)
release_socket="$release_ssh_dir/control"
release_host='user@35.212.144.149'
release_frontend_root='/var/www/html'
release_backend_root='/var/www/lumilabs-backend'
release_commit=$(git rev-parse HEAD)
release_short=$(git rev-parse --short=12 HEAD)
release_backup="/home/user/lumilabs-qa-release-$release_short"
```

Open the control master interactively:

```bash
ssh -M -S "$release_socket" -o ControlPersist=600 -fnNT "$release_host"
```

Enter the SFTP password only at the hidden prompt.

- [ ] **Step 2: Require exact live preimages**

Use this runtime mapping:

```text
backend/src/routes/dashboard.js -> /var/www/lumilabs-backend/src/routes/dashboard.js
businessownerdashboard.html -> /var/www/html/businessownerdashboard.html
browse.html -> /var/www/html/browse.html
mybusinesses.html -> /var/www/html/mybusinesses.html
relationshipmanagerdashboard.html -> /var/www/html/relationshipmanagerdashboard.html
css/style.css -> /var/www/html/css/style.css
js/browse.js -> /var/www/html/js/browse.js
js/mybusinesses.js -> /var/www/html/js/mybusinesses.js
js/relationshipmanagerdashboard.js -> /var/www/html/js/relationshipmanagerdashboard.js
```

For every mapping, compare:

```bash
git show "codex-pre-qa-release-20260723:$release_path" |
  shasum -a 256
ssh -n -S "$release_socket" "$release_host" \
  sha256sum -- "$release_target"
```

Expected: all nine SHA-256 values match. Stop before backup or upload on any
live drift.

- [ ] **Step 3: Create and verify a private backup**

Create `$release_backup`, mode `0700`, with `frontend/` and `backend/`
subdirectories. Copy exactly the nine targets into matching relative paths and
set backup files to mode `0600`.

Verify:

```bash
ssh -n -S "$release_socket" "$release_host" \
  "cd '$release_backup' && find . -type f -print | sort"
```

Expected: exactly nine files. Compare every backup SHA-256 to the preimage Git
blob before continuing.

- [ ] **Step 4: Upload and verify adjacent staged files**

Upload each committed runtime file beside its final target using:

```text
<target>.release-<release_short>.tmp
```

Set staged modes to `0644`. Compare every staged SHA-256 with:

```bash
git show "$release_commit:$release_path" | shasum -a 256
```

Expected: all nine staged hashes match the pushed commit.

- [ ] **Step 5: Replace and restart the backend**

Immediately recheck the live backend preimage, then atomically rename the
staged backend route into place. Restart only the existing service:

```bash
sudo systemctl restart lumilabs-backend.service
sudo systemctl is-active lumilabs-backend.service
curl -fsS http://127.0.0.1:3100/api/health
curl -fsS http://127.0.0.1:3100/api/ready
```

Expected: `active`, `{"status":"ok"}`, and `{"status":"ready"}`.

- [ ] **Step 6: Verify authorization and the numeric live payload**

Require unauthenticated access to return `401`:

```bash
test "$(curl -sS -o /dev/null -w '%{http_code}' \
  http://35.212.144.149/api/dashboard/business-owner)" = 401
```

Read existing QA owner credentials interactively without echo and call
`POST /api/auth/login`. Use the returned bearer token only in memory. Call
`GET /api/dashboard/business-owner` and run:

```js
const fields = ['total', 'approved', 'pending', 'rejected', 'draft'];
for (const field of fields) {
  if (typeof payload.portfolios[field] !== 'number') process.exit(1);
}
const subtotal = fields.slice(1)
  .reduce((sum, field) => sum + payload.portfolios[field], 0);
if (subtotal !== payload.portfolios.total) process.exit(1);
```

Do not print the token or credentials. On failure, restore the backed-up route,
restart the service, verify health/readiness, and stop before frontend cutover.

---

### Task 6: Cut Over the Frontend and Complete Production Verification

**Files:**
- Deploy:
  - `css/style.css`
  - `js/browse.js`
  - `js/mybusinesses.js`
  - `js/relationshipmanagerdashboard.js`
  - `businessownerdashboard.html`
  - `browse.html`
  - `mybusinesses.html`
  - `relationshipmanagerdashboard.html`

**Interfaces:**
- Consumes: the verified backend and eight staged frontend files.
- Produces: the final public release and a clean server.

- [ ] **Step 1: Cut over physical assets before HTML**

In one remote `set -eu` command, immediately recheck all eight live frontend
preimage hashes and then atomically rename in this order:

```text
css/style.css
js/browse.js
js/mybusinesses.js
js/relationshipmanagerdashboard.js
businessownerdashboard.html
browse.html
mybusinesses.html
relationshipmanagerdashboard.html
```

The `v=20260723.3` key is exposed only after all changed assets are live.

- [ ] **Step 2: Verify all nine deployed hashes**

Compare every live file SHA-256 with its pushed Git blob. Also fetch the eight
public frontend URLs with a release query and compare response-body SHA-256
values to Git.

Expected: every local, live, and public hash matches.

- [ ] **Step 3: Run public and service gates**

Require HTTP 200 for every non-backend path in
`backend/deploy/runtime-manifest.txt`, plus:

```text
GET /api/health
GET /api/ready
```

Require `401` for the unauthenticated owner-dashboard route. Require
`lumilabs-backend.service` to remain active and inspect service logs since the
restart for new error-level entries.

- [ ] **Step 4: Run the final automated gate**

```bash
npm --prefix backend test
for release_script in js/*.js; do
  node --check "$release_script"
done
git diff --check
git status --short --branch
```

Expected: 198 tests pass, syntax and diff checks exit zero, and local `main`
matches `origin/main`.

- [ ] **Step 5: Roll back on any failed post-cutover gate**

Restore in this order using adjacent rollback staging files:

```text
businessownerdashboard.html
browse.html
mybusinesses.html
relationshipmanagerdashboard.html
css/style.css
js/browse.js
js/mybusinesses.js
js/relationshipmanagerdashboard.js
backend/src/routes/dashboard.js
```

Restart `lumilabs-backend.service`, then re-verify all preimage hashes, service
activity, health, readiness, protected-route `401`, and every frontend manifest
URL. Do not delete the backup after rollback.

- [ ] **Step 6: Clean only known release artifacts after success**

Re-verify the backup contains exactly the nine expected files, delete those
explicit files, remove the now-empty release backup directories, and verify no
`release-$release_short` or `rollback-$release_short` file remains in either
runtime root.

Close the SSH control master and remove its empty temporary directory.

After proving the pushed `main` contains the preimage commit, delete only the
temporary local tag:

```bash
git merge-base --is-ancestor codex-pre-qa-release-20260723 main
git tag -d codex-pre-qa-release-20260723
```

- [ ] **Step 7: Record the final evidence**

Report:

- pushed commit SHA and matching GitHub `main`;
- nine deployed files and matching hashes;
- service active, health 200, readiness 200, protected route 401;
- numeric and reconciled owner portfolio counts;
- final automated test total;
- no database, schema, secret, upload, dependency, Apache, or systemd-unit
  changes;
- no release backup or temporary artifact remaining;
- whether signed-in visual verification was actually available.
