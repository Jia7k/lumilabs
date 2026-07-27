# Connected Horizon Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build matching Connected Horizon sign-in and sign-up pages without changing Lumi5's authentication, registration, role-selection, storage, or redirect behavior.

**Architecture:** Replace each page's old shared navigation and centered card with one reusable split-shell markup pattern. Keep all new presentation rules beneath `.auth-shell-page`, use `.signin-page` and `.signup-page` only for page-specific grid differences, and limit JavaScript changes to synchronizing the existing signup role buttons' `aria-pressed` state.

**Tech Stack:** Semantic HTML5, existing vanilla CSS, existing vanilla JavaScript, Node.js built-in test runner.

## Global Constraints

- Modify runtime behavior only in `signin.html`, `signup.html`, `css/style.css`, and the signup role-selector accessibility state in `js/script.js`.
- Retain the exact `20260727.1` stylesheet and script query keys on both pages.
- Preserve every form ID, error ID, autocomplete value, length constraint, `novalidate`, API payload, storage operation, and redirect path used by `js/script.js`.
- Do not add role language to the default sign-in page; its existing `?role=` contextual hint remains supported.
- Keep the Business Owner and Investor signup selector, query-parameter preselection, dynamic hint, and dynamic submit label.
- At widths of 900 pixels and above, use a 46/54 sign-in grid and a 40/60 sign-up grid; below 900 pixels, place the form before the compact story panel.
- Use normal document scrolling with no nested form scrollbar and no horizontal overflow.
- Meet WCAG AA contrast, preserve visible focus, use polite live regions, connect errors with `aria-describedby`, and disable decorative motion under `prefers-reduced-motion`.

---

### Task 1: Lock the authentication-page structure with failing contract tests

**Files:**
- Modify: `backend/test/frontend-flow-contract.test.js`
- Modify: `backend/test/auth-client-boundaries.test.js`
- Test: `backend/test/frontend-flow-contract.test.js`
- Test: `backend/test/auth-client-boundaries.test.js`

**Interfaces:**
- Consumes: Current static auth HTML and the existing `authHarness(page)` DOM stub.
- Produces: Structural contracts for `.auth-shell-page`, `.auth-shell`, accessible messages and fields, duplicate-nav removal, and role-button `aria-pressed` synchronization.

- [ ] **Step 1: Add a failing static Connected Horizon contract**

Append this test to `backend/test/frontend-flow-contract.test.js`:

```js
test('authentication pages expose the Connected Horizon shell accessibly', () => {
  const cases = [
    {
      file: 'signin.html',
      bodyClass: 'signin-page',
      formId: 'signin-form',
      messageId: 'signin-message',
      fields: [
        ['si-email', 'si-email-error'],
        ['si-password', 'si-password-error'],
      ],
    },
    {
      file: 'signup.html',
      bodyClass: 'signup-page',
      formId: 'signup-form',
      messageId: 'signup-message',
      fields: [
        ['su-name', 'su-name-error'],
        ['su-email', 'su-email-error'],
        ['su-password', 'su-password-error'],
        ['su-confirm-password', 'su-confirm-password-error'],
      ],
    },
  ];

  for (const page of cases) {
    const html = read(page.file);
    assert.match(
      html,
      new RegExp(`<body[^>]*class=["'][^"']*auth-shell-page[^"']*${page.bodyClass}[^"']*["']`),
      page.file,
    );
    assert.match(html, /class=["'][^"']*auth-shell[^"']*["']/);
    assert.match(html, /class=["'][^"']*auth-story[^"']*["']/);
    assert.match(html, /class=["'][^"']*auth-form-panel[^"']*["']/);
    assert.match(html, new RegExp(`<form[^>]*id=["']${page.formId}["'][^>]*novalidate`));
    assert.match(
      html,
      new RegExp(`id=["']${page.messageId}["'][^>]*role=["']status["'][^>]*aria-live=["']polite["']`),
    );
    assert.doesNotMatch(html, /<nav\b/i, `${page.file} must not retain the old shared nav`);

    for (const [fieldId, errorId] of page.fields) {
      assertAttribute(elementTag(html, fieldId), 'aria-describedby', errorId);
    }
  }

  const signup = read('signup.html');
  const roleButtons = [...signup.matchAll(
    /<button\b[^>]*class=["'][^"']*role-toggle-btn[^"']*["'][^>]*>/gi,
  )].map((match) => match[0]);
  assert.equal(roleButtons.length, 2);
  assertAttribute(roleButtons[0], 'aria-pressed', 'true');
  assertAttribute(roleButtons[1], 'aria-pressed', 'false');
});
```

- [ ] **Step 2: Extend the DOM harness for attribute state and add a failing behavior test**

In `backend/test/auth-client-boundaries.test.js`, add an attribute map to
`makeElement`, return `roleButtons` from `authHarness`, and append the test:

```js
const attributes = new Map();
// Add these methods to each makeElement() return value:
setAttribute(name, value) { attributes.set(name, String(value)); },
getAttribute(name) { return attributes.get(name) ?? null; },
```

```js
return {
  elements,
  hooks,
  roleButtons,
  async submit() {
    await hooks.listeners[`${page}-form:submit`]({ preventDefault() {} });
  },
};
```

```js
test('signup role selection keeps aria-pressed synchronized', () => {
  const client = authHarness('signup');
  const [ownerButton, investorButton] = client.roleButtons;

  assert.equal(ownerButton.getAttribute('aria-pressed'), 'true');
  assert.equal(investorButton.getAttribute('aria-pressed'), 'false');

  client.hooks.listeners['role-investor:click']();

  assert.equal(ownerButton.getAttribute('aria-pressed'), 'false');
  assert.equal(investorButton.getAttribute('aria-pressed'), 'true');
  assert.equal(client.elements.get('role-input').value, 'investor');
});
```

- [ ] **Step 3: Run the focused tests and confirm the new contracts fail**

Run:

```bash
cd backend
node --test test/frontend-flow-contract.test.js test/auth-client-boundaries.test.js
```

Expected: existing tests pass, while the new tests fail because the shell
classes, live-region attributes, described-by links, and role-button attribute
updates do not exist yet.

- [ ] **Step 4: Commit the failing contract tests**

```bash
git add backend/test/frontend-flow-contract.test.js backend/test/auth-client-boundaries.test.js
git commit -m "test(auth): define connected horizon contracts"
```

---

### Task 2: Build the shared Connected Horizon shell and both form panels

**Files:**
- Modify: `signin.html`
- Modify: `signup.html`
- Modify: `css/style.css`
- Test: `backend/test/frontend-flow-contract.test.js`

**Interfaces:**
- Consumes: All existing auth form IDs and `js/script.js` DOM lookups.
- Produces: Shared `.auth-shell`, `.auth-story`, `.auth-form-panel`, `.auth-orbit`, and `.auth-form-content` markup and styles used by both pages.

- [ ] **Step 1: Replace the sign-in page shell without changing its form contract**

Set the body to `class="auth-shell-page signin-page"`, remove the old `<nav>`,
and wrap the preserved form in this structure:

```html
<body class="auth-shell-page signin-page">
  <main class="auth-shell">
    <section class="auth-story" aria-labelledby="auth-story-title">
      <a class="auth-brand" href="index.html" aria-label="Lumi5 Labs home">
        <span class="auth-brand-mark" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none"
            xmlns="http://www.w3.org/2000/svg">
            <polyline points="2,14 7,9 11,12 18,5" stroke="currentColor"
              stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
            <polyline points="14,5 18,5 18,9" stroke="currentColor"
              stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </span>
        <span>Lumi5 Labs</span>
      </a>
      <div class="auth-story-copy">
        <p class="auth-eyebrow">Private markets, made human</p>
        <h2 id="auth-story-title">Where ambition meets opportunity.</h2>
        <p>Build trusted connections around companies with the potential to grow.</p>
      </div>
      <div class="auth-orbit" aria-hidden="true">
        <span class="auth-orbit-ring auth-orbit-ring-one"></span>
        <span class="auth-orbit-ring auth-orbit-ring-two"></span>
        <span class="auth-orbit-node auth-orbit-node-one"></span>
        <span class="auth-orbit-node auth-orbit-node-two"></span>
        <span class="auth-orbit-node auth-orbit-node-three"></span>
      </div>
    </section>

    <section class="auth-form-panel">
      <a href="index.html" class="auth-back-link">&larr; Back to home</a>
      <div class="auth-form-content">
        <header class="auth-head">
          <p class="auth-kicker">Member access</p>
          <h1>Welcome back</h1>
          <p>Sign in to continue your Lumi5 journey.</p>
        </header>
        <div id="signin-message" class="form-message" role="status" aria-live="polite"></div>
        <p id="signin-role-context" class="form-hint" hidden></p>
        <form id="signin-form" novalidate>
          <div class="form-group">
            <label for="si-email">Email <span class="required">*</span></label>
            <input type="email" id="si-email" placeholder="you@example.com"
              autocomplete="email" required maxlength="255"
              aria-describedby="si-email-error" />
            <span class="form-error-text" id="si-email-error"></span>
          </div>
          <div class="form-group">
            <label for="si-password">Password <span class="required">*</span></label>
            <input type="password" id="si-password" placeholder="Enter your password"
              autocomplete="current-password" aria-describedby="si-password-error" />
            <span class="form-error-text" id="si-password-error"></span>
          </div>
          <button type="submit" class="auth-submit-btn" id="signin-submit-btn">
            Sign In
          </button>
        </form>
        <div class="auth-footer">
          Don't have an account? <a href="signup.html">Create an account</a>
        </div>
      </div>
    </section>
  </main>
  <script src="js/script.js?v=20260727.1"></script>
</body>
```

Add `aria-describedby="si-email-error"` to `si-email` and
`aria-describedby="si-password-error"` to `si-password`. Keep
`maxlength="255"`, `required`, autocomplete values, `novalidate`, and the
initial `Sign In` button text unchanged.

- [ ] **Step 2: Build the matched sign-up shell with its existing role and field controls**

Use the same story and form-panel classes, set
`class="auth-shell-page signup-page"`, remove the old `<nav>`, and use this form
header:

```html
<header class="auth-head">
  <p class="auth-kicker">Join Lumi5</p>
  <h1>Create your account</h1>
  <p>Choose how you want to begin, then tell us a little about yourself.</p>
</header>
<div id="signup-message" class="form-message" role="status" aria-live="polite"></div>
```

Keep the complete existing `signup-form`, `role-input`, role-button contents,
four form groups, `role-hint`, and submit button. Add:

```html
aria-pressed="true"
```

to the Business Owner button and:

```html
aria-pressed="false"
```

to the Investor button. Add these exact field/error relationships:

```html
aria-describedby="su-name-error"
aria-describedby="su-email-error"
aria-describedby="su-password-error"
aria-describedby="su-confirm-password-error"
```

Place the existing sign-in footer inside `.auth-form-content` after the form.

- [ ] **Step 3: Add the shared scoped visual system**

Add rules after the existing auth section in `css/style.css`, beginning with
these tokens and shell selectors:

```css
.auth-shell-page {
  --auth-indigo-deep: #242b82;
  --auth-indigo: #5558de;
  --auth-violet: #806de9;
  --auth-amber: #f0a45d;
  --auth-ink: #12192b;
  --auth-muted: #70798d;
  min-height: 100vh;
  background:
    radial-gradient(circle at 85% 8%, rgba(128, 109, 233, 0.12), transparent 26rem),
    #f4f5fb;
}

.auth-shell-page .auth-shell {
  display: grid;
  min-height: 100vh;
  overflow: hidden;
  background: #fff;
}

.auth-shell-page.signin-page .auth-shell {
  grid-template-columns: minmax(320px, 46fr) minmax(420px, 54fr);
}

.auth-shell-page.signup-page .auth-shell {
  grid-template-columns: minmax(320px, 40fr) minmax(520px, 60fr);
}

.auth-shell-page .auth-story {
  position: relative;
  display: flex;
  min-height: 100vh;
  flex-direction: column;
  overflow: hidden;
  padding: clamp(28px, 4vw, 64px);
  color: #fff;
  background:
    radial-gradient(circle at 78% 15%, rgba(181, 157, 255, 0.68), transparent 24%),
    linear-gradient(145deg, var(--auth-indigo-deep), var(--auth-indigo) 58%, var(--auth-violet));
}

.auth-shell-page .auth-form-panel {
  display: flex;
  min-width: 0;
  flex-direction: column;
  padding: clamp(24px, 4vw, 64px);
  background: rgba(255, 255, 255, 0.98);
}

.auth-shell-page .auth-form-content {
  width: min(100%, 520px);
  margin: auto;
}
```

Add the component rules beneath the same page scope:

```css
.auth-shell-page .auth-brand {
  position: relative;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  gap: 10px;
  color: #fff;
  font-size: 18px;
  font-weight: 800;
  text-decoration: none;
}

.auth-shell-page .auth-brand-mark {
  display: grid;
  width: 38px;
  height: 38px;
  place-items: center;
  border-radius: 12px;
  color: var(--auth-indigo);
  background: #fff;
}

.auth-shell-page .auth-story-copy {
  position: relative;
  z-index: 2;
  width: min(100%, 520px);
  margin: auto 0;
}

.auth-shell-page .auth-eyebrow,
.auth-shell-page .auth-kicker {
  margin: 0 0 14px;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.auth-shell-page .auth-eyebrow { color: #dfe1ff; }
.auth-shell-page .auth-kicker { color: var(--auth-indigo); }

.auth-shell-page .auth-story-copy h2 {
  max-width: 540px;
  margin: 0;
  font-size: clamp(40px, 5vw, 72px);
  line-height: 0.98;
  letter-spacing: -0.055em;
}

.auth-shell-page .auth-story-copy > p:last-child {
  max-width: 470px;
  margin: 24px 0 0;
  color: rgba(255, 255, 255, 0.78);
  font-size: 16px;
  line-height: 1.7;
}

.auth-shell-page .auth-orbit {
  position: absolute;
  right: clamp(-120px, -7vw, -48px);
  bottom: clamp(-120px, -8vw, -54px);
  width: clamp(300px, 34vw, 560px);
  aspect-ratio: 1;
}

.auth-shell-page .auth-orbit-ring,
.auth-shell-page .auth-orbit-node {
  position: absolute;
  border-radius: 50%;
}

.auth-shell-page .auth-orbit-ring {
  border: 1px solid rgba(255, 255, 255, 0.24);
}

.auth-shell-page .auth-orbit-ring-one { inset: 8%; }
.auth-shell-page .auth-orbit-ring-two { inset: 24%; }

.auth-shell-page .auth-orbit-node {
  width: 16px;
  height: 16px;
  border: 4px solid rgba(255, 255, 255, 0.28);
  background: #fff;
  box-sizing: content-box;
}

.auth-shell-page .auth-orbit-node-one { top: 17%; left: 34%; }
.auth-shell-page .auth-orbit-node-two { right: 17%; bottom: 32%; }
.auth-shell-page .auth-orbit-node-three {
  bottom: 17%;
  left: 24%;
  background: var(--auth-amber);
}

.auth-shell-page .auth-back-link {
  align-self: flex-end;
  margin: 0;
  color: var(--auth-muted);
  font-weight: 650;
}

.auth-shell-page .auth-head {
  margin-bottom: 30px;
  text-align: left;
}

.auth-shell-page .auth-head h1 {
  margin: 0 0 10px;
  color: var(--auth-ink);
  font-size: clamp(34px, 4vw, 48px);
  letter-spacing: -0.045em;
}

.auth-shell-page .auth-head > p:last-child {
  margin: 0;
  color: var(--auth-muted);
  font-size: 15px;
}

.auth-shell-page .form-group input {
  min-height: 48px;
  border-color: #dfe3ec;
  border-radius: 12px;
  background: #fbfbfe;
}

.auth-shell-page .form-group input:focus {
  border-color: var(--auth-indigo);
  box-shadow: 0 0 0 4px rgba(85, 88, 222, 0.12);
}

.auth-shell-page .auth-submit-btn {
  min-height: 50px;
  margin-top: 22px;
  border-radius: 12px;
  background: linear-gradient(115deg, var(--auth-indigo), var(--auth-violet));
  box-shadow: 0 12px 28px rgba(85, 88, 222, 0.22);
}

.auth-shell-page .auth-footer {
  margin-top: 22px;
}

.auth-shell-page .role-toggle-btn {
  min-height: 72px;
  border-radius: 14px;
}

.auth-shell-page .role-toggle-btn.active {
  border-color: var(--auth-indigo);
  background: #f0f1ff;
  box-shadow: 0 0 0 3px rgba(85, 88, 222, 0.10);
}

.auth-shell-page a:focus-visible,
.auth-shell-page button:focus-visible,
.auth-shell-page input:focus-visible {
  outline: 3px solid var(--auth-amber);
  outline-offset: 3px;
}
```

- [ ] **Step 4: Add the exact responsive and reduced-motion contracts**

Append:

```css
@media (max-width: 899px) {
  .auth-shell-page .auth-shell,
  .auth-shell-page.signin-page .auth-shell,
  .auth-shell-page.signup-page .auth-shell {
    grid-template-columns: 1fr;
  }

  .auth-shell-page .auth-form-panel {
    order: 1;
    min-height: 100vh;
  }

  .auth-shell-page .auth-story {
    order: 2;
    min-height: 420px;
  }
}

@media (max-width: 560px) {
  .auth-shell-page .auth-form-panel {
    padding: 22px 18px 32px;
  }

  .auth-shell-page .role-toggle {
    grid-template-columns: 1fr;
  }
}

@media (prefers-reduced-motion: reduce) {
  .auth-shell-page *,
  .auth-shell-page *::before,
  .auth-shell-page *::after {
    scroll-behavior: auto !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

- [ ] **Step 5: Run the static frontend contract**

Run:

```bash
cd backend
node --test test/frontend-flow-contract.test.js
```

Expected: all static frontend contracts pass, including the new shell, live
regions, field descriptions, fixed release key, and no duplicate nav.

- [ ] **Step 6: Commit the shared visual shell**

```bash
git add signin.html signup.html css/style.css
git commit -m "style(auth): add connected horizon pages"
```

---

### Task 3: Synchronize the signup role selector's accessible state

**Files:**
- Modify: `js/script.js`
- Test: `backend/test/auth-client-boundaries.test.js`

**Interfaces:**
- Consumes: `.role-toggle-btn[data-role]`, the existing `setRole(role)` function, and the two initial `aria-pressed` attributes.
- Produces: `aria-pressed="true"` on only the selected public role button after initial query-parameter selection and every click.

- [ ] **Step 1: Update the existing role-state loop**

Replace the single-line toggle inside `setRole(role)` with:

```js
roleButtons.forEach((btn) => {
  const isActive = btn.dataset.role === role;
  btn.classList.toggle('active', isActive);
  btn.setAttribute('aria-pressed', String(isActive));
});
```

Do not change the role input, hint text, submit label, request payload, or
post-registration destination.

- [ ] **Step 2: Run the client boundary tests**

Run:

```bash
cd backend
node --test test/auth-client-boundaries.test.js
```

Expected: all tests pass, including initial Business Owner selection, Investor
click selection, exact boundary validation, and existing API request behavior.

- [ ] **Step 3: Run all backend and frontend-contract tests**

Run:

```bash
cd backend
npm test
```

Expected: the entire Node test suite passes with zero failures.

- [ ] **Step 4: Commit the accessibility-state synchronization**

```bash
git add js/script.js backend/test/auth-client-boundaries.test.js backend/test/frontend-flow-contract.test.js
git commit -m "fix(auth): expose accessible role selection"
```

---

### Task 4: Validate both authentication journeys visually and functionally

**Files:**
- Verify: `signin.html`
- Verify: `signup.html`
- Verify: `css/style.css`
- Verify: `js/script.js`

**Interfaces:**
- Consumes: Completed Connected Horizon pages and current local API behavior.
- Produces: Evidence that both layouts, validation paths, keyboard states, and role behavior work without regression.

- [ ] **Step 1: Run syntax, whitespace, and focused contract checks**

Run:

```bash
node --check js/script.js
git diff --check
cd backend
node --test test/frontend-flow-contract.test.js test/auth-client-boundaries.test.js
```

Expected: JavaScript syntax is valid, no whitespace errors exist, and both
focused test files pass.

- [ ] **Step 2: Serve the workspace locally and inspect both pages**

From the repository root, run:

```bash
python3 -m http.server 4173 --bind 127.0.0.1
```

Open:

```text
http://127.0.0.1:4173/signin.html
http://127.0.0.1:4173/signup.html
http://127.0.0.1:4173/signup.html?role=investor
```

At a desktop viewport, confirm the 46/54 sign-in and 40/60 sign-up splits,
single logo, orbit artwork, complete form content, and no nested scrollbar. At
390 pixels wide, confirm form-first stacking, no horizontal overflow, and a
compact story section beneath the form.

- [ ] **Step 3: Exercise non-mutating browser behavior**

On sign-in, submit an invalid email with an empty password and confirm both
inline errors and the polite banner appear. On signup, switch between Business
Owner and Investor and confirm active styling, `aria-pressed`, role hint, and
submit text remain synchronized. Do not submit a valid registration during this
visual check.

- [ ] **Step 4: Check keyboard and motion accessibility**

Tab from `Back to home` through every control and confirm focus remains visible
in logical order. Emulate `prefers-reduced-motion: reduce` and confirm the orbit
and button transitions are effectively static.

- [ ] **Step 5: Record final repository evidence**

Run:

```bash
git status --short --branch
git log -4 --oneline
```

Expected: only intentional plan or implementation changes are present, with no
temporary visual-companion files staged.
