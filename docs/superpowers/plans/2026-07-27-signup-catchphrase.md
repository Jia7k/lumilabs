# Signup Catchphrase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the sign-up page its approved momentum-focused story copy while preserving the sign-in page and all authentication behavior.

**Architecture:** Add one static frontend contract that pins both pages' exact story wording and requires the messages to differ. Then make the smallest possible production change by replacing only the two text nodes in `signup.html`; no JavaScript, CSS, API, backend, or database code changes.

**Tech Stack:** Static HTML, Node.js built-in test runner, `node:assert/strict`

## Global Constraints

- The sign-in eyebrow must remain exactly “Private markets, made human”.
- The sign-in headline must remain exactly “Where ambition meets opportunity.”
- The sign-up eyebrow must become exactly “Your next move awaits”.
- The sign-up headline must become exactly “Keep opportunity moving forward.”
- Preserve the existing sign-up markup, heading IDs, layout, styling, artwork, form fields, role selection, validation, accessibility structure, and authentication behavior.
- Do not change JavaScript, APIs, backend code, database behavior, or any page other than `signup.html`.

---

### Task 1: Pin and Apply the Distinct Sign-up Story Copy

**Files:**
- Modify: `backend/test/frontend-flow-contract.test.js:728`
- Modify: `signup.html:115-116`

**Interfaces:**
- Consumes: the existing `read(relativePath)` test helper and the static `.auth-story-copy` markup in `signin.html` and `signup.html`
- Produces: an automated content contract for the two approved story messages and the updated static sign-up copy

- [ ] **Step 1: Write the failing frontend content contract**

Insert this test immediately before the existing `authentication source order and responsive grid placement keep focus aligned with the layout` test:

```js
test('authentication pages use distinct approved story copy', () => {
  const signin = read('signin.html');
  const signup = read('signup.html');

  assert.match(
    signin,
    /<p class="auth-eyebrow">Private markets, made human<\/p>/,
  );
  assert.match(
    signin,
    /<h2 id="auth-story-title">Where ambition meets opportunity\.<\/h2>/,
  );
  assert.match(
    signup,
    /<p class="auth-eyebrow">Your next move awaits<\/p>/,
  );
  assert.match(
    signup,
    /<h2 id="auth-story-title">Keep opportunity moving forward\.<\/h2>/,
  );
  assert.doesNotMatch(
    signup,
    /Private markets, made human|Where ambition meets opportunity\./,
  );
});
```

- [ ] **Step 2: Run the focused test and verify the red state**

Run from `backend/`:

```bash
node --test --test-name-pattern="authentication pages use distinct approved story copy" test/frontend-flow-contract.test.js
```

Expected: FAIL because `signup.html` does not yet contain “Your next move awaits”.

- [ ] **Step 3: Apply the minimal sign-up-only copy change**

Replace only the two story lines in `signup.html`:

```html
<p class="auth-eyebrow">Your next move awaits</p>
<h2 id="auth-story-title">Keep opportunity moving forward.</h2>
```

Do not alter the following supporting paragraph, any surrounding markup, or
`signin.html`.

- [ ] **Step 4: Run the focused test and verify the green state**

Run from `backend/`:

```bash
node --test --test-name-pattern="authentication pages use distinct approved story copy" test/frontend-flow-contract.test.js
```

Expected: PASS for `authentication pages use distinct approved story copy`.

- [ ] **Step 5: Run the complete authentication frontend contracts**

Run from `backend/`:

```bash
node --test test/frontend-flow-contract.test.js test/auth-client-boundaries.test.js
```

Expected: exit code 0 with no failed tests.

- [ ] **Step 6: Run the complete project suite**

Run from `backend/`:

```bash
npm test
```

Expected: 663 tests pass, 0 fail.

- [ ] **Step 7: Verify scope and patch integrity**

Run from the repository root:

```bash
git diff --check
git diff --name-only
```

Expected: no whitespace errors; the implementation diff lists only
`backend/test/frontend-flow-contract.test.js` and `signup.html`.

- [ ] **Step 8: Commit the verified implementation**

```bash
git add backend/test/frontend-flow-contract.test.js signup.html
git commit -m "copy(auth): distinguish signup story"
```
