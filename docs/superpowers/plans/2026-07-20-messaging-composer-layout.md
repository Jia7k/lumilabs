# Messaging Composer Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the message composer pinned and reusable while the growing message history scrolls inside the thread.

**Architecture:** Correct the three-row CSS Grid so its middle history row may shrink below min-content height, then bound the narrow-screen thread height. Lock the layout contract with a dependency-free HTML/CSS test and extend the existing client harness to prove two consecutive sends re-enable the controls.

**Tech Stack:** HTML5, CSS Grid, browser JavaScript, Node.js built-in `node:test`.

## Global Constraints

- Modify only messaging-related files.
- Keep the thread header and composer fixed while only message history scrolls.
- Support desktop and viewports up to 820 pixels wide.
- Do not change production JavaScript, API routes, database behavior, or service configuration.
- Add no runtime or test dependency.
- Deploy only `messages.html`.
- Preserve the existing public Alpha/Beta prototype behavior and persisted thread.

---

### Task 1: Bounded Thread Grid and Repeat-Send Regression

**Files:**
- Create: `backend/test/messages-layout.test.js`
- Modify: `backend/test/messages-client.test.js:68-127`
- Modify: `messages.html:349-354`
- Modify: `messages.html:390-396`
- Modify: `messages.html:492`

**Interfaces:**
- Consumes: the existing `.messaging-shell > .thread-panel` markup and three grid children: header, `#message-list`, and `#message-form`.
- Produces: a bounded grid with `grid-template-rows: auto minmax(0, 1fr) auto`; the middle row scrolls and the composer remains the final visible row.
- Test contract: two consecutive calls to `sendActiveMessage` issue two POSTs and leave `messageInput.disabled === false` and `sendBtn.disabled === false`.

- [ ] **Step 1: Write the failing layout contract test**

Create `backend/test/messages-layout.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(
  path.join(__dirname, '..', '..', 'messages.html'),
  'utf8'
);

function firstRule(selector) {
  const escaped = selector.replaceAll('.', '\\.');
  const match = html.match(new RegExp(escaped + '\\s*\\{([^}]*)\\}'));
  assert.ok(match, 'Expected CSS rule for ' + selector);
  return match[1];
}

test('thread grid keeps the composer inside the clipped shell', () => {
  const thread = firstRule('.thread-panel');

  assert.match(thread, /min-height:\s*0\s*;/);
  assert.match(thread, /overflow:\s*hidden\s*;/);
  assert.match(
    thread,
    /grid-template-rows:\s*auto\s+minmax\(0,\s*1fr\)\s+auto\s*;/
  );
});

test('message history is the only shrinking scroll row', () => {
  const history = firstRule('.message-list');

  assert.match(history, /min-height:\s*0\s*;/);
  assert.match(history, /overflow-y:\s*auto\s*;/);
});

test('narrow layout gives the thread a bounded height', () => {
  const match = html.match(
    /@media\s*\(max-width:\s*820px\)[\s\S]*?\.thread-panel\s*\{([^}]*)\}/
  );
  assert.ok(match, 'Expected narrow-screen thread-panel rule');
  assert.match(match[1], /height:\s*560px\s*;/);
  assert.match(match[1], /min-height:\s*0\s*;/);
});
```

- [ ] **Step 2: Extend the client test for two consecutive sends**

In the existing successful-send test in `backend/test/messages-client.test.js`, replace its fixed response hook with a `savedMessages` array that returns all committed messages on each reload:

```js
  const savedMessages = [];
  client.hooks.request = async (requestPath, options) => {
    if (requestPath === '/messages') {
      const body = JSON.parse(options.body);
      const saved = {
        id: 51 + savedMessages.length,
        sender_id: 3,
        receiver_id: 2,
        portfolio_id: null,
        content: body.content,
        read_at: null,
        created_at: '2026-07-20T09:10:00.000Z',
      };
      savedMessages.push(saved);
      return saved;
    }
    if (requestPath === '/messages/conversations/2') {
      return savedMessages.map((message) => ({
        ...message,
        sender_name: 'Beta',
      }));
    }
    if (requestPath === '/messages/conversations') {
      const latest = savedMessages[savedMessages.length - 1];
      return [{
        ...latest,
        partner_id: 2,
        partner_name: 'Alpha',
        partner_role: 'investor',
        portfolio_name: null,
        unread_count: 0,
      }];
    }
    throw new Error('Unexpected request: ' + requestPath);
  };
```

After the first `sendActiveMessage` call, assert both controls are enabled, enter a second draft, and submit again:

```js
  await client.run('sendActiveMessage({ preventDefault() {} })');

  assert.equal(client.run('els.messageInput.disabled'), false);
  assert.equal(client.run('els.sendBtn.disabled'), false);

  client.run("els.messageInput.value = 'Persist again'");
  await client.run('sendActiveMessage({ preventDefault() {} })');

  assert.equal(savedMessages.length, 2);
  assert.deepEqual(
    savedMessages.map((message) => message.content),
    ['Persist me', 'Persist again']
  );
  assert.equal(client.run('els.messageInput.value'), '');
  assert.equal(client.run('els.messageInput.disabled'), false);
  assert.equal(client.run('els.sendBtn.disabled'), false);
  assert.equal(client.run('state.messages.length'), 2);
```

Update the expected request sequence to contain two complete POST/thread/list cycles:

```js
  assert.deepEqual(client.hooks.requests, [
    '/messages',
    '/messages/conversations/2',
    '/messages/conversations',
    '/messages',
    '/messages/conversations/2',
    '/messages/conversations',
  ]);
```

- [ ] **Step 3: Run the focused tests and verify the red state**

```bash
node --test backend/test/messages-layout.test.js backend/test/messages-client.test.js
```

Expected: the repeat-send client assertions PASS, while all three layout tests FAIL because the current CSS uses `auto 1fr auto`, lacks zero minimum heights, and uses only `min-height: 560px` on narrow screens.

- [ ] **Step 4: Apply the minimal CSS grid correction**

In `messages.html`, replace the base thread rule with:

```css
  .thread-panel {
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    background: #FFFFFF;
  }
```

Add `min-height: 0` to the message history:

```css
  .message-list {
    min-height: 0;
    padding: 20px 18px;
    overflow-y: auto;
    background:
      linear-gradient(#FFFFFF, #FFFFFF) padding-box,
      linear-gradient(180deg, rgba(67, 97, 238, 0.04), rgba(82, 164, 117, 0.04)) border-box;
  }
```

Replace the narrow-screen thread rule with:

```css
    .thread-panel {
      height: 560px;
      min-height: 0;
    }
```

- [ ] **Step 5: Run all messaging tests and syntax checks**

```bash
MESSAGES_SMOKE_ORIGIN=http://35.212.144.149 node --test \
  backend/test/messages-layout.test.js \
  backend/test/messages-client.test.js \
  backend/test/messages-route.test.js \
  backend/test/messages-server.test.js \
  backend/test/messages-deployment-files.test.js
node --check backend/test/messages-layout.test.js
node --check backend/test/messages-client.test.js
git diff --check
```

Expected: 16 tests PASS, 0 fail, 0 skipped; both syntax checks exit `0`; the diff check is silent.

- [ ] **Step 6: Commit the messaging-only layout fix**

```bash
git add -- messages.html backend/test/messages-layout.test.js backend/test/messages-client.test.js
git diff --cached --check
git diff --cached --name-only
git commit -m "fix: keep message composer visible"
```

Expected: exactly the messaging page and two messaging tests are committed.

### Task 2: Deploy and Publish the Composer Fix

**Files:**
- Deploy: `messages.html`
- Do not deploy: tests, documentation, backend routes, JavaScript, or service files

**Interfaces:**
- Public page: `http://35.212.144.149/messages.html`
- Git branch: `agent/fix-messaging-persistence`
- Existing draft PR: `https://github.com/Jia7k/lumilabs/pull/1`

- [ ] **Step 1: Verify local and branch scope before deployment**

```bash
git status -sb
git diff --check origin/main...HEAD
git diff --name-only origin/main...HEAD
```

Expected: the worktree is clean and every changed path is messaging runtime, messaging test, or messaging design/plan documentation.

- [ ] **Step 2: Upload only the messaging page**

```bash
sftp user@35.212.144.149
```

At the `sftp>` prompt:

```text
put messages.html /var/www/html/messages.html
bye
```

Expected: one successful upload; no service restart is performed.

- [ ] **Step 3: Prove the deployed HTML matches the committed page**

```bash
shasum -a 256 messages.html
curl --fail --silent --show-error http://35.212.144.149/messages.html | shasum -a 256
curl --fail --silent --show-error http://35.212.144.149/messages.html \
  | rg 'grid-template-rows: auto minmax\(0, 1fr\) auto|min-height: 0|height: 560px'
```

Expected: local and remote SHA-256 hashes are identical, and the deployed output contains all three layout constraints.

- [ ] **Step 4: Rerun the live-backed messaging suite**

```bash
MESSAGES_SMOKE_ORIGIN=http://35.212.144.149 node --test \
  backend/test/messages-layout.test.js \
  backend/test/messages-client.test.js \
  backend/test/messages-route.test.js \
  backend/test/messages-server.test.js \
  backend/test/messages-deployment-files.test.js
```

Expected: 16 tests PASS, 0 fail, 0 skipped.

- [ ] **Step 5: Push the branch and verify the draft PR head**

```bash
git push origin agent/fix-messaging-persistence
git status -sb
git rev-parse HEAD
git ls-remote --heads origin agent/fix-messaging-persistence
gh pr view 1 --json number,url,state,isDraft,baseRefName,headRefName,title
```

Expected: local and remote hashes match; PR #1 remains an open draft from `agent/fix-messaging-persistence` to `main`.

- [ ] **Step 6: Hand off the single visual confirmation**

If an interactive browser is available, load the current six-message thread, submit twice, and confirm the composer remains visible after both sends and refresh. If no browser is available, ask the user to refresh `http://35.212.144.149/messages.html` and confirm the pinned composer; do not claim visual verification.
