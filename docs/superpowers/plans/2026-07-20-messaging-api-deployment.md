# Messaging API Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the deployed messaging page load the existing MySQL messages while changing no unrelated LumiLabs application file.

**Architecture:** A messaging-only Express entry point mounts the existing messages router on loopback port 3001. A dedicated `systemd` unit runs it with an isolated official Node.js 24.18.0 LTS runtime, and Apache proxies only `/api/messages` to that process.

**Tech Stack:** Node.js 24.18.0 LTS, Express 4, MySQL 8, Node built-in test runner, systemd 249, Apache 2.4 `mod_proxy`/`mod_proxy_http`.

## Global Constraints

- Do not modify dashboards, authentication routes, database schema, portfolios, interests, notifications, shared styling, or unrelated backend files.
- Do not expose the Node.js listener publicly; bind it to `127.0.0.1:3001`.
- Proxy only `/api/messages`; do not proxy the broader `/api` namespace.
- Do not install or replace a system-wide Node.js package.
- Keep existing database and JWT secrets only in `/var/www/html/backend/.env`.
- Preserve the current Apache virtual-host file before applying the messaging-only patch.

---

### Task 1: Messaging-only Express entry point

**Files:**
- Create: `backend/test/messages-server.test.js`
- Create: `backend/messages-server.js`

**Interfaces:**
- Consumes: the existing Express router exported by `backend/src/routes/messages.js` and the existing `backend/.env` database/JWT settings.
- Produces: `createMessagingApp()` for tests and a process listening on `127.0.0.1:${MESSAGES_PORT:-3001}` when `backend/messages-server.js` is executed directly.

- [ ] **Step 1: Write the failing entry-point and deployment smoke tests**

Create `backend/test/messages-server.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMessagingApp } = require('../messages-server');

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

async function readJson(response) {
  const body = await response.text();
  assert.equal(response.status, 200, body);
  return JSON.parse(body);
}

test('serves health inside the messaging namespace', async (t) => {
  const server = await listen(createMessagingApp());
  t.after(server.close);

  const payload = await readJson(await fetch(`${server.origin}/api/messages/health`));
  assert.deepEqual(payload, { status: 'ok' });
});

test('does not expose unrelated API namespaces', async (t) => {
  const server = await listen(createMessagingApp());
  t.after(server.close);

  const response = await fetch(`${server.origin}/api/health`);
  assert.equal(response.status, 404);
});

const smokeOrigin = process.env.MESSAGES_SMOKE_ORIGIN;

test('deployed API returns Beta and the seeded Alpha conversation', {
  skip: !smokeOrigin,
}, async () => {
  const headers = {
    'X-LumiLabs-Prototype-User': 'beta',
    'X-LumiLabs-Prototype-Name': 'Beta',
    'X-LumiLabs-Prototype-Role': 'business_owner',
  };

  const user = await readJson(await fetch(`${smokeOrigin}/api/messages/me`, { headers }));
  assert.equal(Number(user.id), 3);

  const conversations = await readJson(
    await fetch(`${smokeOrigin}/api/messages/conversations`, { headers })
  );
  const alpha = conversations.find((row) => Number(row.partner_id) === 2);
  assert.ok(alpha, 'Expected the seeded Alpha conversation');
  assert.equal(Number(alpha.id), 3);
  assert.match(alpha.content, /currently raising/i);
});
```

- [ ] **Step 2: Run the test and verify the RED state**

Run:

```bash
node --test backend/test/messages-server.test.js
```

Expected: FAIL with `Cannot find module '../messages-server'`. This proves the test detects the missing messaging process entry point.

- [ ] **Step 3: Implement the minimal messaging-only server**

Create `backend/messages-server.js`:

```js
require('dotenv').config();
const express = require('express');
const messageRoutes = require('./src/routes/messages');

function createMessagingApp() {
  const app = express();

  app.use(express.json());
  app.get('/api/messages/health', (req, res) => res.json({ status: 'ok' }));
  app.use('/api/messages', messageRoutes);
  app.use((req, res) => res.status(404).json({ error: 'Route not found' }));
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

if (require.main === module) {
  const port = Number(process.env.MESSAGES_PORT) || 3001;
  const host = '127.0.0.1';

  createMessagingApp().listen(port, host, () => {
    console.log(`LumiLabs messaging API running at http://${host}:${port}`);
  });
}

module.exports = { createMessagingApp };
```

- [ ] **Step 4: Run the focused tests and verify the GREEN state**

Run:

```bash
node --test backend/test/messages-server.test.js
```

Expected: two tests PASS and the live deployment smoke test is SKIPPED because `MESSAGES_SMOKE_ORIGIN` is unset.

- [ ] **Step 5: Check syntax and commit only the messaging entry point**

Run:

```bash
node --check backend/messages-server.js
node --check backend/test/messages-server.test.js
git add backend/messages-server.js backend/test/messages-server.test.js
git commit -m "fix: add messaging-only API entry point"
```

Expected: both syntax checks exit 0 and the commit includes only the two listed files.

---

### Task 2: Messaging-only deployment configuration

**Files:**
- Create: `backend/test/messages-deployment-files.test.js`
- Create: `backend/deploy/lumilabs-messaging.service`
- Create: `backend/deploy/apache-messages-proxy.patch`

**Interfaces:**
- Consumes: `/opt/lumilabs-messaging/current/bin/node` and `/var/www/html/backend/messages-server.js` from Tasks 1 and 3.
- Produces: a `lumilabs-messaging.service` unit and a two-directive Apache patch scoped to `/api/messages`.

- [ ] **Step 1: Write failing configuration-scope tests**

Create `backend/test/messages-deployment-files.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const deployDir = path.join(__dirname, '..', 'deploy');

test('systemd unit runs only the messaging entry point on the isolated runtime', () => {
  const service = fs.readFileSync(path.join(deployDir, 'lumilabs-messaging.service'), 'utf8');

  assert.match(service, /ExecStart=\/opt\/lumilabs-messaging\/current\/bin\/node \/var\/www\/html\/backend\/messages-server\.js/);
  assert.doesNotMatch(service, /\/var\/www\/html\/backend\/server\.js/);
  assert.match(service, /User=user/);
});

test('Apache patch proxies only the messaging namespace', () => {
  const patch = fs.readFileSync(path.join(deployDir, 'apache-messages-proxy.patch'), 'utf8');
  const additions = patch
    .split('\n')
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .join('\n');

  assert.match(additions, /ProxyPass "\/api\/messages" "http:\/\/127\.0\.0\.1:3001\/api\/messages"/);
  assert.match(additions, /ProxyPassReverse "\/api\/messages" "http:\/\/127\.0\.0\.1:3001\/api\/messages"/);
  assert.doesNotMatch(additions, /ProxyPass "\/api" /);
});
```

- [ ] **Step 2: Run the configuration tests and verify the RED state**

Run:

```bash
node --test backend/test/messages-deployment-files.test.js
```

Expected: FAIL with `ENOENT` because the messaging-specific deployment files do not exist.

- [ ] **Step 3: Add the dedicated systemd unit**

Create `backend/deploy/lumilabs-messaging.service`:

```ini
[Unit]
Description=LumiLabs messaging API
After=network-online.target mysql.service
Wants=network-online.target

[Service]
Type=simple
User=user
Group=www-data
WorkingDirectory=/var/www/html/backend
Environment=NODE_ENV=production
ExecStart=/opt/lumilabs-messaging/current/bin/node /var/www/html/backend/messages-server.js
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 4: Add the narrow Apache patch**

Create `backend/deploy/apache-messages-proxy.patch`:

```diff
--- 000-default.conf
+++ 000-default.conf
@@ -11,6 +11,9 @@
 	ServerAdmin webmaster@localhost
 	DocumentRoot /var/www/html
 
+	ProxyPass "/api/messages" "http://127.0.0.1:3001/api/messages"
+	ProxyPassReverse "/api/messages" "http://127.0.0.1:3001/api/messages"
+
 	# Available loglevels: trace8, ..., trace1, debug, info, notice, warn,
 	# error, crit, alert, emerg.
 	# It is also possible to configure the loglevel for particular modules, e.g.
```

- [ ] **Step 5: Run the configuration and entry-point tests**

Run:

```bash
node --test backend/test/messages-server.test.js backend/test/messages-deployment-files.test.js
```

Expected: four tests PASS and one live deployment smoke test is SKIPPED.

- [ ] **Step 6: Commit only messaging deployment files**

Run:

```bash
git add backend/deploy/lumilabs-messaging.service backend/deploy/apache-messages-proxy.patch backend/test/messages-deployment-files.test.js
git commit -m "ops: add messaging-only service configuration"
```

Expected: the commit includes only the three listed files.

---

### Task 3: Install the isolated runtime and deploy messaging files

**Files:**
- Create remotely: `/opt/lumilabs-messaging/node-v24.18.0-linux-x64/**`
- Create remotely: `/opt/lumilabs-messaging/current` symlink
- Create remotely: `/var/www/html/backend/messages-server.js`
- Create remotely: `/var/www/html/backend/test/messages-server.test.js`
- Create remotely: `/var/www/html/backend/test/messages-deployment-files.test.js`
- Create remotely: `/var/www/html/backend/deploy/lumilabs-messaging.service`
- Create remotely: `/var/www/html/backend/deploy/apache-messages-proxy.patch`

**Interfaces:**
- Consumes: the official Node.js 24.18.0 Linux x64 archive and checksum `55aa7153f9d88f28d765fcdad5ae6945b5c0f98a36881703817e4c450fa76742`.
- Produces: a private Node executable and the tested messaging artifacts on the server.

- [ ] **Step 1: Download and verify the official Node.js LTS archive on the server**

Run over SSH:

```bash
cd /tmp
curl -fL --proto '=https' --tlsv1.2 -o node-v24.18.0-linux-x64.tar.xz https://nodejs.org/dist/v24.18.0/node-v24.18.0-linux-x64.tar.xz
printf '%s  %s\n' '55aa7153f9d88f28d765fcdad5ae6945b5c0f98a36881703817e4c450fa76742' 'node-v24.18.0-linux-x64.tar.xz' | sha256sum --check -
```

Expected: `node-v24.18.0-linux-x64.tar.xz: OK`. Stop without extracting if the checksum differs.

- [ ] **Step 2: Extract the runtime into the messaging-only directory**

Run over SSH:

```bash
sudo install -d -o root -g root -m 0755 /opt/lumilabs-messaging
sudo tar -xJf /tmp/node-v24.18.0-linux-x64.tar.xz -C /opt/lumilabs-messaging
sudo ln -sfn node-v24.18.0-linux-x64 /opt/lumilabs-messaging/current
/opt/lumilabs-messaging/current/bin/node --version
```

Expected: `v24.18.0`.

- [ ] **Step 3: Upload only the five messaging artifacts**

Using the configured SFTP account, create `/var/www/html/backend/test` and `/var/www/html/backend/deploy` if absent, then upload:

```text
backend/messages-server.js -> /var/www/html/backend/messages-server.js
backend/test/messages-server.test.js -> /var/www/html/backend/test/messages-server.test.js
backend/test/messages-deployment-files.test.js -> /var/www/html/backend/test/messages-deployment-files.test.js
backend/deploy/lumilabs-messaging.service -> /var/www/html/backend/deploy/lumilabs-messaging.service
backend/deploy/apache-messages-proxy.patch -> /var/www/html/backend/deploy/apache-messages-proxy.patch
```

Expected: SFTP reports successful upload for exactly these five files.

- [ ] **Step 4: Run the messaging tests with the deployed runtime**

Run over SSH:

```bash
cd /var/www/html/backend
/opt/lumilabs-messaging/current/bin/node --test test/messages-server.test.js test/messages-deployment-files.test.js
```

Expected: four tests PASS and one live deployment smoke test is SKIPPED.

- [ ] **Step 5: Remove only the verified temporary archive**

Run over SSH:

```bash
rm -f /tmp/node-v24.18.0-linux-x64.tar.xz
```

Expected: the extracted, checksum-verified runtime remains under `/opt/lumilabs-messaging`; only the downloadable temporary archive is removed.

---

### Task 4: Start the messaging service, proxy it, and verify the live page path

**Files:**
- Create remotely: `/etc/systemd/system/lumilabs-messaging.service`
- Modify remotely: `/etc/apache2/sites-available/000-default.conf`
- Create remotely: `/etc/apache2/sites-available/000-default.conf.before-lumilabs-messaging`
- Enable Apache module links for `proxy` and `proxy_http`.

**Interfaces:**
- Consumes: the deployed messaging process and Apache patch from Tasks 1–3.
- Produces: public same-origin `/api/messages/*` JSON responses for the existing messaging page.

- [ ] **Step 1: Install and start only the messaging service**

Run over SSH:

```bash
sudo install -o root -g root -m 0644 /var/www/html/backend/deploy/lumilabs-messaging.service /etc/systemd/system/lumilabs-messaging.service
sudo systemctl daemon-reload
sudo systemctl enable --now lumilabs-messaging.service
sudo systemctl is-active lumilabs-messaging.service
curl -fsS http://127.0.0.1:3001/api/messages/health
```

Expected: service state `active` and JSON `{"status":"ok"}`.

- [ ] **Step 2: Preserve and patch the Apache virtual host**

Run over SSH only after confirming the proxy lines are not already present:

```bash
grep -F 'ProxyPass "/api/messages"' /etc/apache2/sites-available/000-default.conf
sudo install -o root -g root -m 0644 /etc/apache2/sites-available/000-default.conf /etc/apache2/sites-available/000-default.conf.before-lumilabs-messaging
cd /etc/apache2/sites-available
sudo patch -p0 < /var/www/html/backend/deploy/apache-messages-proxy.patch
sudo a2enmod proxy proxy_http
sudo apache2ctl configtest
```

Expected: the initial `grep` returns no match, `patch` reports the file was patched, modules are enabled, and Apache reports `Syntax OK`. If `configtest` fails, restore the preserved file before any reload:

```bash
sudo install -o root -g root -m 0644 /etc/apache2/sites-available/000-default.conf.before-lumilabs-messaging /etc/apache2/sites-available/000-default.conf
```

- [ ] **Step 3: Reload Apache and run the automated live smoke test**

Run over SSH:

```bash
sudo systemctl reload apache2
cd /var/www/html/backend
MESSAGES_SMOKE_ORIGIN=http://127.0.0.1 /opt/lumilabs-messaging/current/bin/node --test test/messages-server.test.js
```

Expected: all three tests PASS, including the test that identifies Beta as user 3 and returns the seeded Alpha conversation with latest message id 3.

- [ ] **Step 4: Verify the public endpoints without mutating message read state**

Run from the local workspace:

```bash
curl -fsS http://35.212.144.149/api/messages/health
curl -fsS \
  -H 'X-LumiLabs-Prototype-User: beta' \
  -H 'X-LumiLabs-Prototype-Name: Beta' \
  -H 'X-LumiLabs-Prototype-Role: business_owner' \
  http://35.212.144.149/api/messages/conversations
curl -fsS http://35.212.144.149/messages.html
```

Expected: health JSON is `{"status":"ok"}`, the conversation response includes partner id 2 and latest message id 3, and the page returns HTML. Do not call the thread endpoint during automated verification because that endpoint intentionally updates `read_at`.

- [ ] **Step 5: Confirm scope and final service state**

Run locally:

```bash
git status --short
git diff HEAD~2 --name-only
```

Expected: application/deployment changes are limited to:

```text
backend/messages-server.js
backend/test/messages-server.test.js
backend/test/messages-deployment-files.test.js
backend/deploy/lumilabs-messaging.service
backend/deploy/apache-messages-proxy.patch
```

Run over SSH:

```bash
sudo systemctl is-active lumilabs-messaging.service
sudo systemctl is-active apache2.service
ss -ltn | grep -F '127.0.0.1:3001'
```

Expected: both services are `active`, and the messaging listener is bound only to loopback port 3001.
