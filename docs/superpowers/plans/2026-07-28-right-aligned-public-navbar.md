# Right-Aligned Public Navbar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the public desktop navigation links out of the visual center and into one right-aligned cluster with the existing authentication actions.

**Architecture:** Preserve the existing semantic link groups and page markup, and express the new hierarchy entirely through the shared public navbar CSS. Protect the alignment, spacing boundary, routes, responsive behavior, and cache release with automated contracts before publishing any runtime files.

**Tech Stack:** Static HTML5, shared CSS, Node.js 24 built-in test runner, Git, SFTP, Apache static hosting.

## Global Constraints

- Apply the same desktop navbar treatment to `index.html`, `about.html`, and `contact.html`.
- Keep `Lumi5 Labs` anchored on the left.
- Keep the visible right-side order `About`, `Contact`, `Sign in`, `Sign up`.
- Preserve existing text, destinations, `aria-current` values, accessibility labels, hover states, focus states, typography, colors, and button treatment.
- Keep `.landing-page-links` and `.landing-nav-actions` as separate semantic groups.
- Preserve existing compact-menu contents and breakpoint behavior.
- Do not change dashboards, authentication pages, backend code, database behavior, messaging, or unrelated public-page content.
- Use `20260728.7` as the shared public stylesheet release key on the three changed pages.
- Do not push Git or deploy to SFTP without explicit release authorization.

---

### Task 1: Lock the Desktop Alignment and Release Contract

**Files:**
- Modify: `backend/test/public-content-pages.test.js:1629-1660`

**Interfaces:**
- Consumes: `cssRuleBlocks(source)`, `cssProperty(rules, selector, property)`, and `read(file)` already defined by `backend/test/public-content-pages.test.js`.
- Produces: a regression contract for the right-aligned desktop cluster and the exact `20260728.7` stylesheet key.

- [ ] **Step 1: Add the failing desktop alignment test**

Insert after `public content pages receive the homepage desktop navbar styling`:

```js
test('public desktop navigation forms one right-aligned cluster', () => {
  const rules = cssRuleBlocks(read('css/style.css'));
  for (const selector of [
    '.landing-page .landing-page-links',
    '.public-content-page .landing-page-links',
  ]) {
    assert.equal(cssProperty(rules, selector, 'margin-left'), 'auto', selector);
  }
  for (const selector of [
    '.landing-page .landing-nav-actions',
    '.public-content-page .landing-nav-actions',
  ]) {
    assert.equal(cssProperty(rules, selector, 'margin-left'), '12px', selector);
  }
});
```

- [ ] **Step 2: Change the existing About and Contact cache assertions to fail on the old release**

In both page-specific stylesheet assertions, replace:

```js
['css/style.css?v=20260728.6']
```

with:

```js
['css/style.css?v=20260728.7']
```

Add this index assertion to the same cache-contract area:

```js
const indexDocument = parseHtml(read('index.html'));
const indexStylesheets = findAll(indexDocument, (node) => (
  node.tagName === 'link' && node.attributes.rel === 'stylesheet'
)).map((link) => link.attributes.href);
assert.deepEqual(indexStylesheets, ['css/style.css?v=20260728.7']);
```

- [ ] **Step 3: Run the focused test and verify the red state**

Run:

```bash
cd backend
node --test --test-name-pattern='public desktop navigation|About preserves|Contact preserves' \
  test/public-content-pages.test.js
```

Expected: FAIL because the link groups do not yet define `margin-left`, and all three pages still reference their previous stylesheet versions.

- [ ] **Step 4: Commit the failing regression contract**

```bash
git add backend/test/public-content-pages.test.js
git commit -m "test(public): require right-aligned navbar cluster"
```

---

### Task 2: Right-Align the Shared Desktop Navigation

**Files:**
- Modify: `css/style.css:595-601`
- Modify: `css/style.css:688-693`

**Interfaces:**
- Consumes: the existing `.landing-page-links` and `.landing-nav-actions` groups used by all three public pages.
- Produces: shared desktop alignment through `margin-left: auto` and the `12px` informational/authentication group boundary.

- [ ] **Step 1: Push the public links to the right of the flexible header space**

Change the shared link-group rule to:

```css
.landing-page .landing-page-links,
.public-content-page .landing-page-links {
  margin-left: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}
```

- [ ] **Step 2: Add the larger boundary before authentication actions**

Change the shared action-group rule to:

```css
.landing-page .landing-nav-actions,
.public-content-page .landing-nav-actions {
  margin-left: 12px;
  display: flex;
  align-items: center;
  gap: 10px;
}
```

- [ ] **Step 3: Run the alignment contract**

Run:

```bash
cd backend
node --test --test-name-pattern='public desktop navigation' \
  test/public-content-pages.test.js
```

Expected: PASS.

- [ ] **Step 4: Run the existing navbar and compact-menu contracts**

Run:

```bash
cd backend
node --test \
  test/frontend-flow-contract.test.js \
  test/public-content-pages.test.js
```

Expected: all tests pass; route order and compact-menu tests remain unchanged.

- [ ] **Step 5: Commit the CSS implementation**

```bash
git add css/style.css
git commit -m "fix(public): right-align desktop navbar links"
```

---

### Task 3: Publish the New Stylesheet Cache Key Locally

**Files:**
- Modify: `index.html:11`
- Modify: `about.html:8`
- Modify: `contact.html:8`

**Interfaces:**
- Consumes: the tested shared `css/style.css` alignment from Task 2.
- Produces: all three public pages requesting `css/style.css?v=20260728.7`.

- [ ] **Step 1: Update the three stylesheet URLs**

Use this exact URL in each page:

```html
<link rel="stylesheet" href="css/style.css?v=20260728.7">
```

Preserve each file's existing closing-slash formatting; only change the query value.

- [ ] **Step 2: Run the cache and navbar contracts**

Run:

```bash
cd backend
node --test --test-name-pattern='public desktop navigation|About preserves|Contact preserves|homepage exposes exact public journeys' \
  test/public-content-pages.test.js \
  test/frontend-flow-contract.test.js
```

Expected: PASS.

- [ ] **Step 3: Run the complete suite**

Run:

```bash
cd backend
npm test
```

Expected: 810 or more tests pass with zero failures.

- [ ] **Step 4: Verify exact scope and whitespace**

Run:

```bash
git diff --check
git status --short
git diff --stat
git diff -- index.html about.html contact.html css/style.css \
  backend/test/public-content-pages.test.js
```

Expected: only the five implementation/test paths are changed since the spec and plan commits; no unrelated runtime file is modified.

- [ ] **Step 5: Commit the cache release**

```bash
git add index.html about.html contact.html
git commit -m "chore(public): release right-aligned navbar styles"
```

---

### Task 4: Verify and Prepare the Scoped Release

**Files:**
- Verify: `index.html`
- Verify: `about.html`
- Verify: `contact.html`
- Verify: `css/style.css`
- Verify: `backend/test/public-content-pages.test.js`
- Deploy only after authorization: `index.html`, `about.html`, `contact.html`, `css/style.css`

**Interfaces:**
- Consumes: the three tested implementation commits and clean local `main`.
- Produces: a verified local commit ready for a fast-forward GitHub push and a hash-checked SFTP release.

- [ ] **Step 1: Re-run fresh final verification**

Run:

```bash
cd backend
npm test
cd ..
git diff --check
test -z "$(git status --porcelain)"
```

Expected: the full suite passes, whitespace check passes, and the working tree is clean.

- [ ] **Step 2: Confirm the exact runtime delta**

Run:

```bash
git diff --name-status 550d289..HEAD
```

Expected runtime changes:

```text
M	index.html
M	about.html
M	contact.html
M	css/style.css
```

Documentation and test paths may also appear; no other runtime path may appear.

- [ ] **Step 3: Stop for explicit release authorization**

Report the verified commit, full test count, and exact four-file SFTP allowlist. Do not push Git or connect to SFTP unless the user explicitly requests publication.

- [ ] **Step 4: After authorization, require a zero-behind Git state and push**

```bash
git fetch origin
git status -sb
git log --oneline --left-right --cherry-pick origin/main...main
git push origin main
```

Expected: local `main` is zero commits behind; the non-force push succeeds.

- [ ] **Step 5: Stage and verify the four SFTP files**

Set the release identifier from the verified commit:

```bash
release_short=$(git rev-parse --short=7 HEAD)
```

Upload each file to a same-directory `.release-${release_short}.tmp` path under `/var/www/html`, download each staged copy, and require byte-for-byte equality with `cmp` before replacing any live file.

Exact mapping:

```text
index.html       -> /var/www/html/index.html
about.html       -> /var/www/html/about.html
contact.html     -> /var/www/html/contact.html
css/style.css    -> /var/www/html/css/style.css
```

- [ ] **Step 6: Atomically replace, verify HTTP, and clean temporary files**

Keep one `.pre-${release_short}` rollback copy per live file until:

```bash
curl -fsS "http://35.212.144.149/index.html?release=${release_short}"
curl -fsS "http://35.212.144.149/about.html?release=${release_short}"
curl -fsS "http://35.212.144.149/contact.html?release=${release_short}"
curl -fsS 'http://35.212.144.149/css/style.css?v=20260728.7'
```

all return HTTP 200 and match the committed files byte-for-byte. Confirm the live CSS contains both `margin-left: auto` and the `12px` action-group boundary, then remove only the release's temporary and rollback files.
