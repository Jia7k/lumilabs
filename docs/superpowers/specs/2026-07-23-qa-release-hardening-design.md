# Confirmed QA Release Hardening Design

## Goal

Safely publish the five pending confirmed-QA commits to GitHub `main` and the
production SFTP runtime without leaving returning browsers on stale assets or
violating the business-owner dashboard API contract.

The release must preserve the existing database, schema, credentials, uploads,
Apache configuration, dependencies, and unrelated runtime files.

## Confirmed Release Blockers

### Numeric dashboard counts

MySQL can return `COUNT()` and `SUM()` aggregates as strings through the current
`mysql2` configuration. The pending route exposes raw values, while the confirmed
QA plan promises numeric portfolio counts.

The business-owner dashboard route will normalize `total`, `approved`, `pending`,
`rejected`, and `draft` with `Number(value || 0)`. The route regression test will
use string-valued aggregate fixtures so it exercises the real adapter boundary.

### Browser cache invalidation

Production currently returns `ETag` and `Last-Modified` validators but no
`Cache-Control` policy. The affected CSS and JavaScript URLs are unversioned, so
returning browsers can retain the defects being released.

The affected pages will use one explicit release key:

```text
v=20260723.3
```

Only references to changed assets will be versioned:

- `businessownerdashboard.html` → `css/style.css?v=20260723.3`
- `browse.html` → `js/browse.js?v=20260723.3`
- `mybusinesses.html` → `js/mybusinesses.js?v=20260723.3`
- `relationshipmanagerdashboard.html` →
  `css/style.css?v=20260723.3` and
  `js/relationshipmanagerdashboard.js?v=20260723.3`

The physical asset paths remain unchanged. This avoids Apache configuration
changes and keeps existing unversioned pages compatible during the cutover.

## Scope

### Production code

- `backend/src/routes/dashboard.js`
- `businessownerdashboard.html`
- `browse.html`
- `mybusinesses.html`
- `relationshipmanagerdashboard.html`

The already committed QA runtime changes remain in scope:

- `css/style.css`
- `js/browse.js`
- `js/mybusinesses.js`
- `js/relationshipmanagerdashboard.js`

### Tests

- `backend/test/business-owner-dashboard-route.test.js`
- `backend/test/frontend-flow-contract.test.js`

The cache contract test will require the exact shared release key on every
affected reference. No test-only production hooks will be added.

### Explicitly excluded

- database schema or row changes;
- migrations, seeds, or account changes;
- Apache or systemd unit-file edits;
- dependency installation;
- `.env`, uploads, tests, documentation, or deployment sources on SFTP;
- unrelated page-wide cache versioning;
- the non-blocking broader aggregate-normalization refactor outside the five
  portfolio status fields.

## Test-Driven Implementation

1. Change the route fixture to return string-valued aggregates and require
   numeric response fields. Run the focused test and observe the type assertion
   fail.
2. Add a frontend contract test for the `20260723.3` asset references. Run it
   and observe the missing-key failure.
3. Normalize the five route fields and update the four HTML pages.
4. Re-run the focused tests, all browser syntax checks, and the complete backend
   suite.
5. Require a clean worktree after the focused hardening commit.

## Git Publication

Before pushing:

1. fetch `origin/main`;
2. require zero commits behind and the expected pending range;
3. require the exact reviewed path set;
4. run `git diff --check`, browser syntax checks, and the complete test suite;
5. obtain a fresh independent code and release review.

Push `main` without force. Confirm local `HEAD`, `origin/main`, and
`refs/heads/main` resolve to the same commit.

## SFTP Deployment

### Runtime mapping

Frontend paths map directly under `/var/www/html`.

The backend route maps as follows:

```text
backend/src/routes/dashboard.js
→ /var/www/lumilabs-backend/src/routes/dashboard.js
```

It must never be uploaded beneath the public web root.

### Preflight and backup

1. Require every live preimage to match the corresponding blob at the current
   production Git commit.
2. Create a private, release-specific backup outside both runtime roots.
3. Verify the backup file list and every backup SHA-256.
4. Upload committed files to adjacent staging paths and verify their SHA-256
   values before any rename.

### Cutover order

1. Atomically replace the private backend route.
2. Restart `lumilabs-backend.service`; no daemon reload is required.
3. Require the service to be active and require `/api/health` and `/api/ready`
   to return HTTP 200.
4. Verify the authenticated business-owner dashboard includes numeric,
   reconciled status counts.
5. Atomically replace `css/style.css` and the three changed JavaScript files.
6. Atomically replace the four affected HTML pages. The final cache key is not
   exposed until its assets are already live.

### Post-deployment verification

- every deployed live file matches the pushed Git blob;
- every frontend path in the runtime manifest returns HTTP 200;
- `/api/health` and `/api/ready` return HTTP 200;
- the backend service is active and has no new error log entries;
- unauthenticated protected routes still reject access;
- the owner dashboard status fields are numeric and reconcile to the total;
- affected static contracts and the complete automated suite still pass.

Signed-in visual verification should be repeated if a browser backend is
available. If it remains unavailable, the handoff must state that limitation
and must not claim unperformed visual coverage.

## Rollback

Any failed backend or post-cutover gate triggers rollback:

1. restore the prior HTML pages first, while the new assets remain backward
   compatible;
2. restore the prior CSS and JavaScript assets;
3. restore the prior private backend route;
4. restart `lumilabs-backend.service`;
5. verify all restored hashes, service activity, health, readiness, protected
   route behavior, and frontend HTTP responses.

The private backup is removed only after every release gate passes. Cleanup is
limited to the known release backup and staged/rollback artifacts.

## Success Criteria

- GitHub `main`, local `main`, and all nine deployed runtime files identify the
  same committed release.
- Portfolio status counts are JSON numbers and reconcile to `total`.
- Affected pages request the changed assets with `v=20260723.3`.
- The unified backend remains active and ready after restart.
- No database, schema, credentials, uploads, Apache configuration, dependency,
  or unrelated runtime content changes.
- No release-specific backup or temporary file remains after verified success.
