# Messaging API Deployment Design

## Problem

The deployed messaging page requests same-origin endpoints under `/api`, but Apache currently serves only static files. The server has no Node.js runtime, no running Express process, and no Apache reverse-proxy rule, so `/api/messages/*` returns Apache 404 responses even though MySQL contains the expected users and messages.

## Chosen approach

Install the supported Ubuntu Node.js and npm packages, add a messaging-only Express entry point, and run it as an unprivileged `systemd` service bound to `127.0.0.1:3001`. Reverse-proxy only `/api/messages` from Apache to that service. Keep MySQL bound to localhost and keep port 3001 private.

The deployed frontend and backend messaging files match the repository byte-for-byte, and the existing SQL returns the seeded Alpha/Beta conversation. The only application file added will be `backend/messages-server.js`, whose sole responsibility is mounting the existing messaging router. Existing dashboards, authentication routes, database schema, portfolios, interests, notifications, shared styling, and unrelated backend files will not be changed.

## Alternatives considered

1. Expose Express directly on a public port. This avoids Apache configuration but adds an unnecessary public service and requires cross-origin configuration, so it is rejected.
2. Render the seeded messages from static frontend data. This would hide the deployment fault and stop the page from reflecting MySQL, so it is rejected.
3. Start the complete backend through `backend/server.js`. This would make unrelated API areas part of the deployment even though the assigned scope is messaging, so it is rejected in favor of a messaging-only entry point.

## Components and data flow

1. The browser loads static files from Apache on port 80.
2. `js/messages.js` sends same-origin requests such as `/api/messages/conversations`.
3. Apache proxies only `/api/messages/*` to the dedicated Express process at `http://127.0.0.1:3001/api/messages/*`.
4. `backend/messages-server.js` mounts only `backend/src/routes/messages.js`; that router authenticates the selected prototype user and queries the existing `lumi5_labs` database.
5. Express returns JSON through Apache to the browser.

The `lumilabs-messaging` service will run as the existing `user` account with working directory `/var/www/html/backend`, load the existing `.env`, restart after failures, and start after networking and MySQL.

## Allowed file scope

- Add `backend/messages-server.js` as the messaging-only process entry point.
- Add a messaging smoke test under `backend/test/`.
- Add `/etc/systemd/system/lumilabs-messaging.service`, which starts only the messaging process.
- Modify `/etc/apache2/sites-available/000-default.conf` only to add the two `/api/messages` proxy directives.
- Do not modify any other project or application file.

Installing the missing Node.js runtime necessarily changes operating-system package files; it does not alter unrelated LumiLabs source code.

## Error handling and security

- Apache will return a gateway error if the messaging process is unavailable instead of silently serving an HTML 404 for messaging API routes.
- `systemd` will restart the messaging process on failure and retain logs in the journal.
- The messaging process will listen only on loopback; no new public firewall port is needed.
- Existing database and JWT secrets remain in `/var/www/html/backend/.env` and will not be copied into service definitions or logs.
- Before replacing Apache configuration, preserve the current file so rollback is possible.

## Verification

Before the change, a repeatable smoke check must fail because `/api/messages/health` and `/api/messages/conversations` return 404. After the change:

- `systemctl is-active lumilabs-messaging` returns `active`.
- `apache2ctl configtest` returns `Syntax OK`.
- `/api/messages/health` returns HTTP 200 and `{"status":"ok"}` through Apache.
- Alpha and Beta conversation-list endpoints each return the seeded conversation.
- The full Alpha/Beta thread returns the three seeded messages.
- The public messaging page still loads successfully.

## Rollback

Disable and remove the `lumilabs-messaging` service and `backend/messages-server.js`, restore the preserved Apache virtual-host configuration, disable proxy modules only if no other site uses them, reload Apache, and leave all unrelated application/database files unchanged.
