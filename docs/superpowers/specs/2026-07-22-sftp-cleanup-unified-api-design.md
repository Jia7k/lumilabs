# SFTP Cleanup and Unified API Design

## Objective

Create a clean, recoverable production deployment for the existing business-owner, investor, and admin workflows. Browser code must use same-origin `/api` requests, one private Node.js service must connect to MySQL, and the Apache document root must contain only public frontend assets.

The relationship-manager and group-chat workflow is explicitly deferred to a later project.

## Safety Constraints

- Keep the current website available while the replacement runtime is staged and tested.
- Do not expose MySQL credentials or place them in browser code.
- Do not permanently delete deployment files during this cleanup.
- Move retired files into a dated quarantine directory with an inventory and SHA-256 hashes.
- Do not switch Apache until the staged backend passes health, database, route, and role-flow checks.
- Keep the existing messaging service and Apache configuration available for immediate rollback until post-cutover verification passes.
- Fix verified defects in the current three-role workflows, but do not add relationship-manager or group-chat behavior.
- Synchronize verified source changes to GitHub `main` and deploy only runtime files to SFTP.

## Architecture

### Public frontend

Apache serves `/var/www/html`. The directory contains only:

- the 12 public HTML pages;
- `css/style.css`; and
- browser JavaScript under `js/`.

Every browser-facing API request uses a relative `/api` URL. No delivered HTML, CSS, or browser JavaScript may reference `localhost`, a loopback address, a database host, or a public Node.js port.

### Private backend

The unified backend lives at `/var/www/lumilabs-backend`, outside Apache's document root. It contains:

- `server.js`;
- `src/`;
- `package.json` and `package-lock.json`;
- the production `.env`;
- production-installed `node_modules/`; and
- `uploads/portfolio-documents/`.

One systemd unit, `lumilabs-backend.service`, runs `server.js` on `127.0.0.1:3100`. Apache proxies `/api/*` to that service. Uploaded documents remain outside the public document root and are downloaded through authenticated `/api/portfolios/:portfolioId/documents/:documentId/download` routes. Loopback networking is intentionally retained between Apache and Node because it is server-internal; only browser-facing `localhost` references are removed.

Node is the only component that connects to MySQL. It reads database and JWT configuration from the private production `.env` without printing secrets.

### Staged cutover

1. Record the current process, port, Apache, and systemd state.
2. Back up the active Apache configuration and create the dated quarantine directory.
3. Stage the private backend without modifying the current public runtime.
4. Install production dependencies and start the unified service on `127.0.0.1:3100`, after confirming that the port is unused.
5. Verify its health endpoint, MySQL connection, API route map, authentication, authorization, and uploads.
6. Run the approved three-role workflow using temporary test records.
7. Validate the proposed Apache configuration with `apachectl configtest`.
8. Activate it with an Apache reload, not a stop/start.
9. Run public post-cutover checks.
10. Move non-runtime files out of the public document root only after the new path passes.
11. Retain the previous messaging service and configuration until final verification is complete.

If any pre-cutover check fails, the active website remains unchanged. If a post-cutover check fails, restore the saved Apache configuration and reload Apache immediately.

## Existing Product Flows

### Visitor and authentication

1. A visitor opens the landing page.
2. The visitor signs up as a business owner or investor, or signs in to an existing account.
3. The backend validates credentials and returns a JWT and user data.
4. The frontend stores the session and redirects according to role.
5. Unauthenticated sessions return to `signin.html`; authenticated users cannot use another role's protected APIs.

### Business owner

1. Open the business-owner dashboard.
2. Create or edit a portfolio.
3. Upload supported portfolio documents.
4. Submit the portfolio for moderation.
5. Observe its pending, approved, rejected, or needs-changes status.
6. See investor interest associated with owned portfolios.
7. Open the current one-to-one messaging experience with a relevant investor.

### Investor

1. Open the investor dashboard.
2. Browse approved portfolios and recommendations.
3. Express or remove interest.
4. Review saved interests.
5. Open the current one-to-one messaging experience with the portfolio owner.

### Admin

1. Open the moderation dashboard.
2. Review submitted portfolio information and documents.
3. Approve or reject the submission with the required audit data.
4. Review resulting audit-log entries and dashboard statistics.

### Notifications and messaging

- Portfolio and interest actions create only the notifications implemented by the current backend.
- Messaging remains one-to-one and persists messages and notifications atomically.
- Refreshing the message page reloads committed messages from MySQL.
- Group conversations and relationship-manager membership are outside this cleanup.

## Flow Audit Rules

For every page and action in the three supported roles, the audit checks:

- navigation targets exist and are appropriate for the role;
- buttons and forms have matching JavaScript handlers;
- frontend methods call mounted backend routes with matching methods and payloads;
- protected routes enforce authentication and role authorization;
- database writes are committed once and survive refresh;
- errors are surfaced without losing valid user input;
- document upload and download URLs resolve through the production origin;
- sign-out clears session data and returns to sign-in; and
- no browser-delivered file contains a development-only API origin.

Verified defects found by these checks are fixed with focused regression tests before deployment.

## SFTP Cleanup Boundary

### Remain in `/var/www/html`

- `audit-logs.html`
- `browse.html`
- `businessownerdashboard.html`
- `createportfolio.html`
- `index.html`
- `investordashboard.html`
- `messages.html`
- `moderatordashboard.html`
- `my-interests.html`
- `mybusinesses.html`
- `signin.html`
- `signup.html`
- `css/style.css`
- the production browser files under `js/`

### Move to the private backend

- production backend entry point and `src/` routes/middleware/configuration;
- package manifests and installed production dependencies;
- production `.env`; and
- uploaded documents.

### Move to dated quarantine

- root `README.md`, `.gitignore`, and `docs/` copies;
- `backend/test/`;
- `backend/deploy/` and obsolete proxy artifacts;
- `backend/.env.example`;
- `backend/schema.sql` and `backend/migrate.js`;
- the old messaging-only entry point after unified-service verification; and
- the retired public `backend/` tree after required runtime data is safely staged privately.

The quarantine lives outside `/var/www/html` under the SFTP user's home. Its manifest records original path, quarantine path, size, and SHA-256 hash. Nothing in quarantine is permanently deleted during this project.

## Repository Hygiene

- Keep documentation, tests, migrations, schema, and deployment source in Git even though they are not deployed under the public web root.
- Stop tracking local editor/SFTP configuration, `backend/.env`, and `backend/node_modules/`; keep them ignored locally.
- Never commit production credentials.
- Use an explicit deployment allowlist so a repository sync cannot republish tests, docs, credentials, or dependencies into `/var/www/html`.
- Preserve the server-managed production `.env`, installed dependencies, and uploads during code deployment.

Because a production `.env` has previously been tracked, credential rotation is a separate security action that must be completed without placing replacement credentials in Git or chat.

## Verification

### Automated checks

- Run all existing backend tests.
- Add regression coverage for same-origin frontend API configuration.
- Add static flow checks for page targets, element-handler wiring, and frontend-to-backend route compatibility.
- Verify production dependency installation from `package-lock.json`.

### Staged service checks

- Confirm the service binds only to loopback.
- Confirm health succeeds.
- Confirm MySQL connectivity through the production `.env`.
- Confirm unauthenticated and wrong-role requests are rejected.
- Confirm authenticated document-download URLs resolve through Apache and unauthorized downloads are rejected.

### Temporary end-to-end data

Create uniquely prefixed temporary business-owner, investor, and admin records. Exercise signup/sign-in where supported, portfolio creation and upload, submission, moderation, interest creation/removal, messaging, notifications, refresh persistence, and sign-out. Remove only records bearing the unique test identifier after evidence is captured; do not alter existing users or business data.

### Public post-cutover checks

- Every public page returns the expected status and loads its local assets.
- Every browser API call targets the public origin's `/api` namespace.
- All three role journeys pass.
- Backend source, `.env`, tests, schema, deployment files, and documentation are not publicly retrievable.
- Local and `origin/main` are synchronized after the verified commit is pushed.

## Failure Handling

- A failed staged-service or database check stops the deployment before Apache changes.
- A failed Apache configuration test prevents reload.
- A failed public smoke test triggers immediate restoration of the saved Apache configuration.
- A failed temporary-data cleanup is reported with the exact remaining test identifiers; unrelated data is never deleted.
- Quarantined files remain available for manual restoration.
