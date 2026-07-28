# Homepage Shared Footer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the homepage's minimal footer with the complete footer used by About and Contact.

**Architecture:** `index.html`, `about.html`, and `contact.html` will use the same `public-footer` structure. The footer declarations will move into one shared CSS component, scoped to both `.landing-page` and `.public-content-page`, while the public-content-only CSS contract remains isolated.

**Tech Stack:** Semantic HTML5, shared CSS, Node.js built-in test runner, existing HTML/CSS contract helpers.

## Global Constraints

- Preserve all homepage content and header behavior.
- Footer navigation contains only Home, About, and Contact.
- The complete address, email, telephone, social links, copyright, and version remain exact.
- Do not change backend behavior, database behavior, environment files, or uploads.
- Do not add dependencies.
- Mobile-specific redesign is out of scope; preserve the existing public footer's responsive behavior without introducing a new layout.
- GitHub and SFTP release actions require explicit authorization after local implementation.

---

### Task 1: Share the complete footer markup

**Files:**
- Modify: `backend/test/public-content-pages.test.js:1423-1591`
- Modify: `index.html:207-210`

**Interfaces:**
- Consumes: existing `parseHtml`, `findOne`, `findAll`, `assertExactLinks`, `footerRoutes`, `socialRoutes`, and `footerFacts` test helpers.
- Produces: one `public-footer` element on each public page with identical navigation, contact, social, copyright, and version content.

- [ ] **Step 1: Extract the existing footer assertions into a reusable helper**

Add this helper immediately after `footerFacts`:

```js
function assertCompletePublicFooter(body, file) {
  const footer = findOne(body, (node) => (
    node.tagName === 'footer' && hasClass(node, 'public-footer')
  ), `${file}: footer`);
  const footerNav = findOne(footer, (node) => (
    node.tagName === 'nav' && node.attributes['aria-label'] === 'Footer navigation'
  ), `${file}: footer navigation`);
  assertExactLinks(
    footerNav,
    footerRoutes.map(([label, href]) => ({ label, href, current: null })),
    `${file}: footer navigation links`,
  );
  const socials = findOne(footer, (node) => (
    node.tagName === 'section' && hasClass(node, 'public-socials')
  ), `${file}: footer social links`);
  assertExactLinks(
    socials,
    socialRoutes.map(([label, href]) => ({ label, href, current: null })),
    `${file}: exact social links`,
  );
  const footerContact = findOne(footer, (node) => (
    node.tagName === 'div' && hasClass(node, 'public-footer-contact')
  ), `${file}: footer contact group`);
  assert.equal(
    visibleTextContent(findOne(
      footerContact,
      (node) => node.tagName === 'h2',
      `${file}: footer contact heading`,
    )),
    'Visit & contact',
  );
  const address = findOne(
    footerContact,
    (node) => node.tagName === 'address',
    `${file}: footer address`,
  );
  assert.equal(findAll(address, (node) => /^h[1-6]$/.test(node.tagName)).length, 0);
  assertExactLinks(address, [
    {
      label: '1 Fullerton Rd, #02-01 One Fullerton Singapore 049213',
      href: 'https://www.google.com/maps/search/?api=1&query=1%20Fullerton%20Rd%20Singapore%20049213',
      current: null,
    },
    { label: 'business@lumi5labs.com', href: 'mailto:business@lumi5labs.com', current: null },
    { label: '+65-6599-1991', href: 'tel:+6565991991', current: null },
  ], `${file}: footer contact links`);
  const footerText = visibleTextContent(footer);
  for (const fact of footerFacts) {
    assert.ok(footerText.includes(fact), `${file}: ${fact}`);
  }
}
```

Replace the duplicated footer assertion block in the About/Contact test with:

```js
assertCompletePublicFooter(body, file);
```

- [ ] **Step 2: Write the failing homepage footer test**

Add:

```js
test('homepage exposes the same complete public footer', () => {
  const source = read('index.html');
  const document = parseHtml(source);
  const body = findOne(document, (node) => node.tagName === 'body', 'index.html: body');

  assert.equal(body.attributes.class, 'landing-page');
  assertCompletePublicFooter(body, 'index.html');
  assert.doesNotMatch(source, /href="[^"]*\/(?:portfolio|blog|faq)\/?"/i);
});
```

- [ ] **Step 3: Run the test to verify RED**

Run:

```bash
node --test --test-name-pattern="homepage exposes the same complete public footer" backend/test/public-content-pages.test.js
```

Expected: FAIL because `index.html` contains `landing-footer`, not `public-footer`.

- [ ] **Step 4: Replace the homepage footer with the canonical markup**

Replace `index.html` lines 207-210 with the exact `public-footer` element from
`about.html`, including:

```html
<footer class="public-footer">
  <div class="public-footer-grid">
    <section>
      <h2>LUMI5 LABS</h2>
      <p>A venture studio and innovation lab based in Singapore, fueling the growth of technology startups with expert guidance and funding.</p>
    </section>
    <nav aria-label="Footer navigation">
      <h2>Navigate</h2>
      <a href="index.html">Home</a>
      <a href="about.html">About</a>
      <a href="contact.html">Contact</a>
    </nav>
    <div class="public-footer-contact">
      <h2>Visit &amp; contact</h2>
      <address>
        <a href="https://www.google.com/maps/search/?api=1&amp;query=1%20Fullerton%20Rd%20Singapore%20049213">1 Fullerton Rd, #02-01 One Fullerton<br>Singapore 049213</a>
        <a href="mailto:business@lumi5labs.com">business@lumi5labs.com</a>
        <a href="tel:+6565991991">+65-6599-1991</a>
      </address>
    </div>
    <section class="public-socials">
      <h2>Follow</h2>
      <a href="https://www.linkedin.com/company/lumi5-labs/">LinkedIn</a>
      <a href="https://www.instagram.com/lumi5labs/">Instagram</a>
      <a href="https://bsky.app/profile/lumi5labs.bsky.social">Bluesky</a>
      <a href="https://www.facebook.com/profile.php?id=61575224522339">Facebook</a>
    </section>
  </div>
  <div class="public-footer-meta">
    <span>Copyright © 2026 LUMI5 LABS</span>
    <span>v26.02.13.1</span>
  </div>
</footer>
```

- [ ] **Step 5: Run the focused structural tests**

Run:

```bash
node --test backend/test/public-content-pages.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add index.html backend/test/public-content-pages.test.js
git commit -m "fix(public): share complete homepage footer"
```

---

### Task 2: Make the footer a shared CSS component

**Files:**
- Modify: `backend/test/public-content-pages.test.js:1838-1885`
- Modify: `backend/test/frontend-flow-contract.test.js:525-565`
- Modify: `css/style.css:1208-1220, 1420-1430, 2054-2103, 2152-2154, 2214-2234`

**Interfaces:**
- Consumes: the `public-footer`, `public-footer-grid`, `public-footer-contact`, `public-socials`, and `public-footer-meta` markup contract from Task 1.
- Produces: one shared footer presentation for `.landing-page` and `.public-content-page`.

- [ ] **Step 1: Write the failing shared-style contract**

Add to `backend/test/public-content-pages.test.js`:

```js
test('homepage and content pages use one shared footer style contract', () => {
  const css = read('css/style.css');
  for (const selector of [
    '.landing-page .public-footer',
    '.landing-page .public-footer-grid',
    '.landing-page .public-footer h2',
    '.landing-page .public-footer p',
    '.landing-page .public-footer a',
    '.landing-page .public-footer-meta',
  ]) {
    assert.ok(css.includes(selector), `${selector}: shared footer selector`);
  }
  assert.doesNotMatch(css, /\.landing-page \.landing-footer/);
});
```

Remove `'\\.landing-footer'` from the grey-text selector list in the homepage
accessibility test because the replacement footer intentionally uses the
public footer's dark-surface palette.

- [ ] **Step 2: Run the test to verify RED**

Run:

```bash
node --test --test-name-pattern="one shared footer style contract" backend/test/public-content-pages.test.js
```

Expected: FAIL because the CSS still scopes `public-footer` to
`.public-content-page` and still contains `landing-footer`.

- [ ] **Step 3: Move the footer declarations into a shared component block**

Immediately before `/* PUBLIC CONTENT PAGES (ABOUT / CONTACT) */`, create
`/* SHARED PUBLIC FOOTER */`. Move the complete footer declarations out of the
public-content-only block and group every base selector:

```css
.landing-page .public-footer,
.public-content-page .public-footer {
  padding: 64px clamp(24px, 8vw, 132px) 24px;
  color: #d9dfef;
  background: #080c1b;
}

.landing-page .public-footer-grid,
.public-content-page .public-footer-grid {
  display: grid;
  grid-template-columns: 1.4fr repeat(3, minmax(150px, 0.7fr));
  gap: 38px;
}

.landing-page .public-footer h2,
.public-content-page .public-footer h2 {
  margin: 0 0 18px;
  color: #fff;
  font-size: 0.9rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.landing-page .public-footer p,
.public-content-page .public-footer p {
  max-width: 450px;
  margin: 0;
  line-height: 1.75;
}

.landing-page .public-footer nav,
.landing-page .public-footer address,
.public-content-page .public-footer nav,
.public-content-page .public-footer address {
  display: grid;
  align-content: start;
  gap: 10px;
  font-style: normal;
}

.landing-page .public-footer a,
.public-content-page .public-footer a {
  color: #d9dfef;
  text-decoration-color: rgba(217, 223, 239, 0.4);
}

.landing-page .public-footer-meta,
.public-content-page .public-footer-meta {
  display: flex;
  justify-content: space-between;
  gap: 24px;
  padding-top: 24px;
  margin-top: 48px;
  color: #9ea8bf;
  border-top: 1px solid rgba(255, 255, 255, 0.12);
  font-size: 0.84rem;
}
```

Move and group the existing responsive footer declarations in the same shared
component section:

```css
@media (max-width: 979px) {
  .landing-page .public-footer-grid,
  .public-content-page .public-footer-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 660px) {
  .landing-page .public-footer-grid,
  .public-content-page .public-footer-grid {
    grid-template-columns: 1fr;
  }

  .landing-page .public-footer-meta,
  .public-content-page .public-footer-meta {
    flex-direction: column;
  }
}
```

Delete the obsolete base and `max-width: 599px` `.landing-footer` rules.

- [ ] **Step 4: Update the public-content CSS contract**

In `backend/test/public-content-pages.test.js`:

- remove `.public-content-page .public-footer` from the base rules required
  inside `publicContentCss(css)`;
- remove `.public-content-page .public-footer-grid` from the narrow rules
  required inside `assertPublicResponsiveContract`;
- keep the new shared-footer test responsible for the extracted component.

- [ ] **Step 5: Run CSS and homepage tests**

Run:

```bash
node --test backend/test/public-content-pages.test.js backend/test/frontend-flow-contract.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add css/style.css backend/test/public-content-pages.test.js backend/test/frontend-flow-contract.test.js
git commit -m "fix(public): share footer styling"
```

---

### Task 3: Bump the frontend release key

**Files:**
- Modify: all runtime HTML files containing `20260728.3`
- Modify: `js/messages.js`
- Modify: frontend tests containing literal or regular-expression forms of `20260728.3`

**Interfaces:**
- Consumes: shared stylesheet changes from Task 2.
- Produces: one coherent release key, `20260728.4`, across every deployed local CSS and JavaScript reference.

- [ ] **Step 1: Change release-key expectations to `20260728.4`**

Update all direct and escaped test expectations from `20260728.3` to
`20260728.4`, including:

```js
const releaseKey = '20260728.4';
```

and regular expressions such as:

```js
/css\/style\.css\?v=20260728\.4/
```

- [ ] **Step 2: Run the release-key tests to verify RED**

Run:

```bash
node --test \
  backend/test/assignments-client.test.js \
  backend/test/browse-client.test.js \
  backend/test/frontend-flow-contract.test.js \
  backend/test/investor-pages-client.test.js \
  backend/test/managed-messages-client.test.js \
  backend/test/mybusinesses-client.test.js \
  backend/test/public-content-pages.test.js \
  backend/test/superadmin-client.test.js
```

Expected: FAIL because runtime files still reference `20260728.3`.

- [ ] **Step 3: Update runtime asset references**

Mechanically replace `20260728.3` with `20260728.4` in every runtime HTML file
and in `js/messages.js`. Do not alter external CDN URLs.

- [ ] **Step 4: Run the release-key tests and stale-key scan**

Run:

```bash
node --test \
  backend/test/assignments-client.test.js \
  backend/test/browse-client.test.js \
  backend/test/frontend-flow-contract.test.js \
  backend/test/investor-pages-client.test.js \
  backend/test/managed-messages-client.test.js \
  backend/test/mybusinesses-client.test.js \
  backend/test/public-content-pages.test.js \
  backend/test/superadmin-client.test.js
rg -n "20260728\\\\?\\.3" --glob '*.html' --glob '*.js'
```

Expected: tests PASS and the scan returns no matches.

- [ ] **Step 5: Commit**

```bash
git add '*.html' js/messages.js backend/test/*.test.js
git commit -m "chore(frontend): bump shared footer release key"
```

---

### Task 4: Verify and prepare release handoff

**Files:**
- Verify only; no production-file changes expected.

**Interfaces:**
- Consumes: Tasks 1-3.
- Produces: a clean, tested commit ready for an explicitly authorized GitHub and SFTP release.

- [ ] **Step 1: Run formatting and scope checks**

Run:

```bash
git diff --check
git status --short --branch
git diff --name-only origin/main..HEAD
```

Expected: no whitespace errors, no uncommitted files, and only the footer,
release-key, test, spec, and plan files appear.

- [ ] **Step 2: Run the full test suite**

Run:

```bash
cd backend && npm test
```

Expected: all tests PASS with zero failures.

- [ ] **Step 3: Verify the homepage footer over local HTTP**

Serve the repository locally and request `/index.html`. Verify HTTP 200 and
that the response contains:

```html
<footer class="public-footer">
```

Verify it contains `Home`, `About`, `Contact`, `Visit &amp; contact`, all four
social links, `Copyright © 2026 LUMI5 LABS`, and `v26.02.13.1`.

- [ ] **Step 4: Request release authorization**

Report the verified commit and ask whether to push GitHub `main` and deploy the
runtime-manifest files to SFTP. Do not perform either external release action
without that confirmation.
