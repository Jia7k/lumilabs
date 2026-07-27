# Messaging Participant Dot Colors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each managed-conversation participant dot its approved role color while leaving every other messaging visual and behavior unchanged.

**Architecture:** Keep the default `.participant-dot` rule as the safe fallback. A small role-to-class function in the messaging renderer returns only fixed modifier classes, and `messages.html` owns the three corresponding presentation rules.

**Tech Stack:** Vanilla HTML/CSS, browser JavaScript, Node.js built-in test runner, VM-based client tests

## Global Constraints

- Relationship manager dot: muted brown `#8B5E3C`.
- Investor dot: muted green `#2E8B57`.
- Business owner dot: clear blue `#3B82F6`.
- Unknown or future roles retain the existing primary-color fallback.
- Only the six-pixel participant dot changes; chips, names, roles, message bubbles, alignment, data, APIs, and permissions remain unchanged.
- Production changes are limited to `messages.html` and `js/messages.js`.

---

### Task 1: Role-specific participant dot presentation

**Files:**
- Modify: `backend/test/managed-messages-client.test.js`
- Modify: `backend/test/messages-layout.test.js`
- Modify: `js/messages.js`
- Modify: `messages.html`

**Interfaces:**
- Consumes: `participant.role`, one of `relationship_manager`, `investor`, `business_owner`, or an unrecognized value.
- Produces: `participantDotClass(role): string`, returning the base `participant-dot` class plus one fixed modifier for a supported role.

- [ ] **Step 1: Write the failing renderer and stylesheet tests**

Add a focused mapping test to `backend/test/managed-messages-client.test.js`:

```js
test('participant dots use fixed role classes with a safe fallback', () => {
  const sandbox = {
    window: { LUMILABS_API_BASE: undefined, location: { search: '', href: '' } },
    document: { addEventListener() {} },
    localStorage: { getItem() { return ''; }, removeItem() {} },
    console,
    setTimeout,
    clearTimeout,
    URLSearchParams,
    encodeURIComponent,
    Intl,
    Date,
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);

  assert.equal(
    vm.runInContext("participantDotClass('relationship_manager')", sandbox),
    'participant-dot participant-dot--relationship-manager',
  );
  assert.equal(
    vm.runInContext("participantDotClass('investor')", sandbox),
    'participant-dot participant-dot--investor',
  );
  assert.equal(
    vm.runInContext("participantDotClass('business_owner')", sandbox),
    'participant-dot participant-dot--business-owner',
  );
  assert.equal(
    vm.runInContext("participantDotClass('future_role')", sandbox),
    'participant-dot',
  );
});
```

Extend the existing participant-rail rendering assertion so its active owner and investor chips contain `participant-dot--business-owner` and `participant-dot--investor`.

Add a stylesheet test to `backend/test/messages-layout.test.js`:

```js
test('participant dot modifiers use the approved role palette', () => {
  assert.match(
    firstRule('.participant-dot--relationship-manager'),
    /background:\s*#8B5E3C\s*;/i,
  );
  assert.match(
    firstRule('.participant-dot--investor'),
    /background:\s*#2E8B57\s*;/i,
  );
  assert.match(
    firstRule('.participant-dot--business-owner'),
    /background:\s*#3B82F6\s*;/i,
  );
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
node --test backend/test/managed-messages-client.test.js backend/test/messages-layout.test.js
```

Expected: FAIL because `participantDotClass` and the three modifier rules do not exist.

- [ ] **Step 3: Add the minimal safe role mapper**

Add this fixed mapping function near the existing role-label helpers in `js/messages.js`:

```js
function participantDotClass(role) {
  if (role === 'relationship_manager') {
    return 'participant-dot participant-dot--relationship-manager';
  }
  if (role === 'investor') {
    return 'participant-dot participant-dot--investor';
  }
  if (role === 'business_owner') {
    return 'participant-dot participant-dot--business-owner';
  }
  return 'participant-dot';
}
```

Use it in `renderActiveHeader()`:

```js
<span class="${participantDotClass(participant.role)}" aria-hidden="true"></span>
```

- [ ] **Step 4: Add the approved CSS modifiers**

Immediately after the existing `.participant-dot` fallback rule in `messages.html`, add:

```css
.participant-dot--relationship-manager { background: #8B5E3C; }
.participant-dot--investor { background: #2E8B57; }
.participant-dot--business-owner { background: #3B82F6; }
```

- [ ] **Step 5: Run focused and full verification**

Run:

```bash
node --test backend/test/managed-messages-client.test.js backend/test/messages-layout.test.js
npm --prefix backend test
git diff --check
```

Expected: all focused tests and all backend tests pass; `git diff --check` emits no output.

- [ ] **Step 6: Review the scoped diff**

Run:

```bash
git diff -- messages.html js/messages.js backend/test/managed-messages-client.test.js backend/test/messages-layout.test.js
git status --short
```

Expected: only the four messaging implementation/test files are modified beyond the already committed design and plan documents.

- [ ] **Step 7: Commit the implementation**

```bash
git add messages.html js/messages.js backend/test/managed-messages-client.test.js backend/test/messages-layout.test.js
git commit -m "style(messages): color participant dots by role"
```

- [ ] **Step 8: Publish and deploy**

Fetch `origin/main`, require a zero-behind fast-forward state, push `main`, deploy only `messages.html` and `js/messages.js` to the existing SFTP targets, and verify the remote SHA-256 hashes match the committed files.

- [ ] **Step 9: Visually verify the live room**

Open the populated managed room as a signed-in relationship manager and confirm:

- Relationship manager dot is brown.
- Investor dot is green.
- Business owner dot is blue.
- Desktop and 390-pixel layouts have no horizontal overflow.
- No browser-console errors or warnings appear.
