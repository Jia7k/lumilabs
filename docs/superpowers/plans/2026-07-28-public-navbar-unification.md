# Public Navbar Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Index, About, and Contact the same public navbar while removing Portfolio, Blog, and FAQ from public navigation and footer navigation.

**Architecture:** Keep the homepage navbar as the canonical static component. Copy its semantic structure into About and Contact, then extend the existing landing-header CSS selector groups to `.public-content-page` so the same markup receives the same styles without changing either page's content layout. Preserve the existing static-HTML architecture and add contract tests for exact destinations, current-page semantics, forbidden links, and cache coherence.

**Tech Stack:** Static HTML5, shared CSS, Node.js `node:test`, existing HTML/CSS contract helpers, Nginx static hosting, Express backend unchanged

## Global Constraints

- Desktop navigation order is: brand, About, Contact, Sign in, Sign up.
- The brand links to `index.html`; there is no separate Home text link in the navbar.
- Portfolio, Blog, and FAQ must not appear in public navbars or About/Contact footer navigation.
- About and Contact body content, Contact submission behavior, leadership links, and social links remain unchanged.
- Do not add a JavaScript navbar loader or a new runtime dependency.
- Dedicated mobile layout refinement and mobile visual QA are out of scope.
- Keep the runtime asset key coherent across all deployed HTML pages and the Messages API fallback.

---

### Task 1: Lock the shared navbar and footer contract

**Files:**
- Modify: `backend/test/public-content-pages.test.js:1432-1583`
- Modify: `about.html:11-65,174-184`
- Modify: `contact.html:11-65,129-139`

**Interfaces:**
- Consumes: the existing `parseHtml`, `findOne`, `findAll`, `assertExactLinks`, `hasClass`, and `visibleTextContent` test helpers.
- Produces: the canonical public route arrays and identical `landing-header` markup on all three public pages.

- [ ] **Step 1: Write the failing structural contract**

Replace the old route fixtures with:

```js
const publicNavbarRoutes = [
  ['About', 'about.html'],
  ['Contact', 'contact.html'],
];

const footerRoutes = [
  ['Home', 'index.html'],
  ...publicNavbarRoutes,
];

const authRoutes = [
  ['Sign in', 'signin.html'],
  ['Sign up', 'signup.html'],
];
```

Update the page-shell test so it:

```js
const header = findOne(body, (node) => (
  node.tagName === 'header' && hasClass(node, 'landing-header')
), `${file}: shared public header`);

const brand = findOne(header, (node) => (
  node.tagName === 'a' && hasClass(node, 'landing-brand')
), `${file}: brand`);
assert.equal(brand.attributes.href, 'index.html');
assert.equal(visibleTextContent(brand), 'Lumi5 Labs');

const desktopNav = findOne(header, (node) => (
  node.tagName === 'nav'
  && hasClass(node, 'landing-page-links')
  && node.attributes['aria-label'] === 'Primary navigation'
), `${file}: desktop navigation`);

assertExactLinks(
  desktopNav,
  publicNavbarRoutes.map(([label, href]) => ({
    label,
    href,
    current: label === currentPage ? 'page' : null,
  })),
  `${file}: desktop navigation links`,
);

const authActions = findOne(header, (node) => (
  node.tagName === 'div' && hasClass(node, 'landing-nav-actions')
), `${file}: authentication actions`);
```

Assert the compact `landing-menu` contains About, Contact, and Sign in, matching
the homepage component. Assert each footer contains only `footerRoutes`.
Add explicit negative assertions against the removed destinations:

```js
for (const forbidden of ['/portfolio/', '/blog/', '/faq/']) {
  assert.doesNotMatch(source, new RegExp(`href=["'][^"']*${forbidden}`, 'i'));
}
```

- [ ] **Step 2: Run the structural test and verify RED**

Run:

```bash
node --test backend/test/public-content-pages.test.js
```

Expected: FAIL because About and Contact still expose `public-header`,
Portfolio, Blog, and FAQ.

- [ ] **Step 3: Copy the canonical header markup**

Replace the About and Contact `<header class="public-header">...</header>` with
the `index.html` `landing-header` structure:

```html
<header class="landing-header">
  <div class="landing-nav">
    <a class="landing-brand" href="index.html" aria-label="Lumi5 Labs home">
      <span class="landing-brand-mark" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <polyline
            points="2,14 7,9 11,12 18,5"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <polyline
            points="14,5 18,5 18,9"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </span>
      <span>Lumi5 Labs</span>
    </a>
    <nav class="landing-page-links" aria-label="Primary navigation">
      <a href="about.html" aria-current="page">About</a>
      <a href="contact.html">Contact</a>
    </nav>
    <details class="landing-menu">
      <summary>Menu</summary>
      <nav aria-label="Compact primary navigation">
        <a href="about.html" aria-current="page">About</a>
        <a href="contact.html">Contact</a>
        <a href="signin.html">Sign in</a>
      </nav>
    </details>
    <div class="landing-nav-actions">
      <a class="landing-nav-link landing-nav-signin" href="signin.html">Sign in</a>
      <a class="landing-nav-link landing-nav-link--primary" href="signup.html">Sign up</a>
    </div>
  </div>
</header>
```

For `contact.html`, move `aria-current="page"` from About to Contact. Remove
Portfolio, Blog, and FAQ from each footer, leaving Home, About, and Contact.

- [ ] **Step 4: Run the structural tests and verify GREEN**

Run:

```bash
node --test backend/test/public-content-pages.test.js
```

Expected: PASS for shared header structure, link order, page-current semantics,
footer destinations, content, Contact form, and accessibility contracts.

- [ ] **Step 5: Commit the structural change**

```bash
git add about.html contact.html backend/test/public-content-pages.test.js
git commit -m "fix(public): unify navbar structure"
```

---

### Task 2: Reuse the homepage desktop navbar styling

**Files:**
- Modify: `css/style.css:547-694,1199-1215`
- Modify: `backend/test/public-content-pages.test.js:1818-1880`
- Test: `backend/test/frontend-flow-contract.test.js`

**Interfaces:**
- Consumes: the `landing-header` component classes produced by Task 1.
- Produces: identical desktop visual rules for a landing page or public-content page ancestor.

- [ ] **Step 1: Write a failing shared-style contract**

Add a test that requires every landing-header selector group to include the
public-page alias. The key assertions are:

```js
const css = read('css/style.css');
for (const selector of [
  '.landing-header',
  '.landing-nav',
  '.landing-brand',
  '.landing-brand-mark',
  '.landing-page-links',
  '.landing-menu',
  '.landing-nav-actions',
  '.landing-nav-link',
]) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.match(
    css,
    new RegExp(
      `\\.landing-page ${escaped}[\\s\\S]*?\\.public-content-page ${escaped}\\s*\\{`,
    ),
    `${selector} must share the homepage rule with public pages`,
  );
}
```

Also assert that About and Contact no longer contain `public-header`,
`public-brand`, `public-nav`, `public-auth-actions`, or `public-menu` classes.

- [ ] **Step 2: Run the shared-style test and verify RED**

Run:

```bash
node --test backend/test/public-content-pages.test.js
```

Expected: FAIL because the homepage rules are still scoped only to
`.landing-page`.

- [ ] **Step 3: Extend the existing header selector groups**

For every header-only homepage rule, add its public-page equivalent to the same
declaration block. Use this exact pattern:

```css
.landing-page .landing-header,
.public-content-page .landing-header {
  /* Preserve the existing declaration block unchanged. */
}

.landing-page .landing-page-links a,
.landing-page .landing-menu summary,
.landing-page .landing-menu nav a,
.public-content-page .landing-page-links a,
.public-content-page .landing-menu summary,
.public-content-page .landing-menu nav a {
  /* Preserve the existing declaration block unchanged. */
}
```

Apply the alias pattern to:

```text
landing-header
landing-nav
landing-brand
landing-brand-mark
landing-page-links
landing-page-links a
landing-menu
landing-menu summary
landing-menu summary::-webkit-details-marker
landing-menu summary::after
landing-menu[open] summary::after
landing-menu nav
landing-menu nav a
landing-nav-actions
landing-nav-link
landing-nav-link--primary
```

Apply the same aliasing to the header hover and focus-visible selector groups.
Do not change declaration values and do not touch body-content selectors such
as `.landing-hero`, `.landing-audiences`, or `.landing-footer`.

- [ ] **Step 4: Run focused style and page tests**

Run:

```bash
node --test \
  backend/test/public-content-pages.test.js \
  backend/test/frontend-flow-contract.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit the shared styling**

```bash
git add css/style.css backend/test/public-content-pages.test.js
git commit -m "fix(public): share homepage navbar styling"
```

---

### Task 3: Advance the coherent frontend release key

**Files:**
- Modify: all 17 runtime HTML files listed in `backend/deploy/runtime-manifest.txt`
- Modify: `js/messages.js:22`
- Modify: cache-key assertions in:
  - `backend/test/assignments-client.test.js`
  - `backend/test/browse-client.test.js`
  - `backend/test/frontend-flow-contract.test.js`
  - `backend/test/investor-pages-client.test.js`
  - `backend/test/managed-messages-client.test.js`
  - `backend/test/mybusinesses-client.test.js`
  - `backend/test/public-content-pages.test.js`
  - `backend/test/superadmin-client.test.js`

**Interfaces:**
- Consumes: changed HTML and CSS from Tasks 1–2.
- Produces: one runtime release key, `20260728.3`, for all local CSS/JS asset references and the Messages fallback.

- [ ] **Step 1: Change test expectations to `20260728.3`**

Replace exact cache-key expectations from `20260728.2` to `20260728.3` in the
listed test files. Do not change migration confirmation strings or backup
filenames that merely contain a date.

- [ ] **Step 2: Run cache-key tests and verify RED**

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

Expected: FAIL because runtime pages and `js/messages.js` still use
`20260728.2`.

- [ ] **Step 3: Update runtime references**

Mechanically replace `20260728.2` with `20260728.3` in the 17 manifest HTML
files and in:

```js
const MESSAGES_API_SCRIPT_SRC = 'js/api.js?v=20260728.3';
```

- [ ] **Step 4: Verify cache coherence**

Run:

```bash
! rg -n '20260728\.2' --glob '*.html' --glob 'js/*.js' .
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

Expected: no stale runtime key and all focused tests PASS.

- [ ] **Step 5: Commit the release-key update**

```bash
git add \
  about.html assignments.html audit-logs.html browse.html \
  businessownerdashboard.html contact.html createportfolio.html index.html \
  investordashboard.html messages.html moderatordashboard.html \
  relationshipmanagerdashboard.html my-interests.html mybusinesses.html \
  signin.html signup.html superadmindashboard.html js/messages.js \
  backend/test/assignments-client.test.js \
  backend/test/browse-client.test.js \
  backend/test/frontend-flow-contract.test.js \
  backend/test/investor-pages-client.test.js \
  backend/test/managed-messages-client.test.js \
  backend/test/mybusinesses-client.test.js \
  backend/test/public-content-pages.test.js \
  backend/test/superadmin-client.test.js
git commit -m "chore(frontend): bump navbar release key"
```

---

### Task 4: Verify and release

**Files:**
- Read: `backend/deploy/runtime-manifest.txt`
- Verify: all modified files and the deployed public URLs

**Interfaces:**
- Consumes: the committed navbar, shared CSS, and coherent release key.
- Produces: a tested commit ready for or applied to GitHub main and SFTP, with a rollback snapshot.

- [ ] **Step 1: Run the complete local verification gate**

Run:

```bash
npm --prefix backend test
npm --prefix backend audit --json
for release_script in \
  js/*.js backend/server.js backend/migrate.js backend/migrate-contact.js \
  backend/scripts/*.js backend/src/routes/*.js backend/src/services/*.js
do
  node --check "$release_script"
done
git diff --check
! git grep -n -E '^(<<<<<<<|=======|>>>>>>>)' -- .
! rg -n -i \
  'https?://(?:localhost|127\.0\.0\.1)|\$\{protocol\}//\$\{hostname\}:3000|35\.212\.144\.149:3000' \
  --glob '*.html' --glob 'js/*.js' .
```

Expected: full suite PASS, audit total 0, syntax PASS, clean diff, no conflict
markers, and no browser-local production origin.

- [ ] **Step 2: Review the final diff**

Confirm:

```bash
git diff origin/main...HEAD -- \
  index.html about.html contact.html css/style.css \
  backend/test/public-content-pages.test.js
```

Expected: only the approved navbar/footer, shared-header CSS, tests, cache key,
design, and plan changes.

- [ ] **Step 3: Deploy from the exact runtime manifest**

Create an archive from committed `HEAD` containing exactly the 68 paths in
`backend/deploy/runtime-manifest.txt`. On the SFTP server:

1. Confirm health and readiness before cutover.
2. Create a mode-700 rollback directory containing preimages for every manifest
   file.
3. Verify the uploaded archive checksum and all 68 staged paths.
4. Install CSS and JavaScript first, then HTML.
5. Do not change `.env`, `uploads`, `node_modules`, or database contents; this
   release has no backend or schema change.
6. Verify all 68 live hashes against the committed archive.
7. Confirm `/api/health`, `/api/ready`, and unauthenticated Messages 401.

- [ ] **Step 4: Perform desktop public-page QA**

At desktop width, verify:

```text
/
/about.html
/contact.html
```

Each page must show the same white navbar with the Lumi5 Labs brand, About,
Contact, Sign in, and Sign up. About and Contact footers must show only Home,
About, and Contact under Navigate. Confirm no horizontal overflow and no browser
console or missing-asset errors. Mobile visual QA is deferred.

- [ ] **Step 5: Push and verify identity**

After a final `git fetch origin main`, require zero commits behind, then:

```bash
git push origin main
git fetch origin main
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
```

Record the pushed commit in the rollback directory, recheck live hashes, remove
only temporary staging/archive artifacts, and retain the mode-700 rollback
directory.
