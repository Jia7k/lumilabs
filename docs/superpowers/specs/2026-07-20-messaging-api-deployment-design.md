# Messaging API Deployment Design

## Problem

The deployed messaging page requests same-origin endpoints under `/api`, but Apache currently serves only static files. The server has no Node.js runtime, no running Express process, and no Apache reverse-proxy rule, so `/api/messages/*` returns Apache 404 responses even though MySQL contains the expected users and messages.

## Chosen approach

Install the supported Ubuntu Node.js and npm packages, run the existing Express backend as an unprivileged `systemd` service bound to `127.0.0.1:3000`, and reverse-proxy `/api` from Apache to that service. Keep MySQL bound to localhost and keep port 3000 private.

The deployed frontend and backend messaging files match the repository byte-for-byte, and the existing SQL returns the seeded Alpha/Beta conversation. No messaging application-code change is required unless deployment verification reveals a separate defect.

## Alternatives considered

1. Expose Express directly on public port 3000. This avoids Apache configuration but adds an unnecessary public service and requires cross-origin configuration, so it is rejected.
2. Render the seeded messages from static frontend data. This would hide the deployment fault and stop the page from reflecting MySQL, so it is rejected.

## Components and data flow

1. The browser loads static files from Apache on port 80.
2. `js/messages.js` sends same-origin requests such as `/api/messages/conversations`.
3. Apache proxies `/api/*` to Express at `http://127.0.0.1:3000/api/*`.
4. Express authenticates the selected prototype user and queries the existing `lumi5_labs` database.
5. Express returns JSON through Apache to the browser.

The Express service will run as the existing `user` account with working directory `/var/www/html/backend`, load the existing `.env`, restart after failures, and start after networking and MySQL.

## Error handling and security

- Apache will return a gateway error if Express is unavailable instead of silently serving an HTML 404 for API routes.
- `systemd` will restart the backend on failure and retain logs in the journal.
- Express will listen only on loopback; no new public firewall port is needed.
- Existing database and JWT secrets remain in `/var/www/html/backend/.env` and will not be copied into service definitions or logs.
- Before replacing Apache configuration, preserve the current file so rollback is possible.

## Verification

Before the change, a repeatable smoke check must fail because `/api/health` and `/api/messages/conversations` return 404. After the change:

- `systemctl is-active lumilabs-backend` returns `active`.
- `apache2ctl configtest` returns `Syntax OK`.
- `/api/health` returns HTTP 200 and `{"status":"ok"}` through Apache.
- Alpha and Beta conversation-list endpoints each return the seeded conversation.
- The full Alpha/Beta thread returns the three seeded messages.
- The public messaging page still loads successfully.

## Rollback

Disable and remove the `lumilabs-backend` service, restore the preserved Apache virtual-host configuration, disable proxy modules only if no other site uses them, reload Apache, and leave the application/database files unchanged.
