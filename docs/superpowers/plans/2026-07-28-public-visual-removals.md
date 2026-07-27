# Public Visual Removals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the About “Let’s Innovate Together” section and the Contact Singapore Horizon, leaving the Contact hero’s right desktop column empty.

**Architecture:** The two retired HTML components will be deleted rather than hidden. Their positive regression contracts will become explicit absence contracts, all component-only CSS will be removed, and About and Contact will receive one shared cache key so browsers immediately load the cleaned stylesheet.

**Tech Stack:** Semantic HTML5, scoped CSS, Node.js built-in test runner, existing HTML/CSS contract helpers.

## Global Constraints

- Keep the Contact hero’s left copy and existing two-column desktop grid unchanged.
- Leave the Contact hero’s right column blank; do not add a placeholder or restore the old orbit.
- Preserve the About hero, journey, vision, leadership, navbar, and footer.
- Preserve the Contact details, map, form, navbar, footer, and JavaScript URLs.
- Delete all `contact-horizon` and `about-connect` markup and component-only CSS.
- Update only About and Contact stylesheet URLs to `css/style.css?v=20260728.6`.
- Do not change the homepage, JavaScript behavior, backend, API, database, schema, environment, deployment configuration, or credentials.
- GitHub and SFTP publication require explicit authorization after local implementation.

---

### Task 1: Remove the two retired HTML components

**Files:**
- Modify: `backend/test/public-content-pages.test.js:1650-1752`
- Modify: `about.html:154-159`
- Modify: `contact.html:62-103`

**Interfaces:**
- Consumes: existing `read`, `parseHtml`, `visibleBodyText`, `visibleTextContent`, `findOne`, `findAll`, and `hasClass` helpers.
- Produces: About content without `section.about-connect` and a Contact hero containing only `div.public-hero-copy`.

- [ ] **Step 1: Change the About content contract to require the CTA’s absence**

Rename the existing About test to:

```js
test('About preserves its complete story, vision and leadership without the retired CTA', () => {
```

Remove these two values from its `required` array:

```js
"Let's Innovate Together",
'Connect with us to explore how we can make your vision a reality. Join us in shaping the future.',
```

After the loop that checks `required`, add:

```js
  assert.doesNotMatch(
    source,
    /\babout-connect\b|Let's Innovate Together|Join us in shaping the future|>Get Started</,
    'About excludes the retired connect CTA',
  );
```

- [ ] **Step 2: Replace the positive Horizon test with an empty-column contract**

Replace `Contact hero presents one accessible Singapore Horizon scene` in full with:

```js
test('Contact hero intentionally leaves its visual column empty', () => {
  const source = read('contact.html');
  const document = parseHtml(source);
  const hero = findOne(document, (node) => (
    node.tagName === 'section'
    && hasClass(node, 'public-hero')
    && hasClass(node, 'contact-hero')
  ), 'Contact hero');
  const copy = findOne(hero, (node) => (
    node.tagName === 'div' && hasClass(node, 'public-hero-copy')
  ), 'Contact hero copy');

  assert.equal(
    visibleTextContent(copy),
    '01 · Connect Contact Us Here is how you can contact us for any questions or concerns.',
    'Contact hero copy remains unchanged',
  );
  assert.equal(
    findAll(hero, (node) => node.tagName === 'figure').length,
    0,
    'Contact hero has no visual figure',
  );
  assert.equal(
    findAll(hero, (node) => node !== hero && node.tagName === 'div').length,
    1,
    'Contact hero contains only its copy column',
  );
  assert.doesNotMatch(
    source,
    /\bcontact-horizon\b|\bcontact-orbit\b|\bnode-(?:visit|email|call)\b/,
    'Contact excludes every retired visual',
  );
});
```

- [ ] **Step 3: Run the two contracts to verify RED**

Run:

```bash
node --test --test-name-pattern="About preserves|Contact hero intentionally" backend/test/public-content-pages.test.js
```

Expected: both tests FAIL because About still contains `about-connect` and Contact still contains the Horizon figure.

- [ ] **Step 4: Delete the complete About CTA section**

Delete this exact block from `about.html`:

```html
    <section class="public-section about-connect" aria-labelledby="connect-title">
      <p class="section-eyebrow">05 · Connect</p>
      <h2 id="connect-title">Let's Innovate Together</h2>
      <p>Connect with us to explore how we can make your vision a reality. Join us in shaping the future.</p>
      <a class="btn btn-primary" href="contact.html">Get Started</a>
    </section>
```

The final boundary must be:

```html
    </section>
  </main>

  <footer class="public-footer">
```

- [ ] **Step 5: Delete the complete Contact Horizon figure**

Delete `figure.contact-horizon` and every nested span from `contact.html`. The final Contact hero must be:

```html
    <section class="public-hero contact-hero" aria-labelledby="contact-title">
      <div class="public-hero-copy">
        <p class="section-eyebrow">01 · Connect</p>
        <h1 id="contact-title">Contact Us</h1>
        <p>Here is how you can contact us for any questions or concerns.</p>
      </div>
    </section>
```

- [ ] **Step 6: Run the focused contracts to verify GREEN**

Run:

```bash
node --test --test-name-pattern="About preserves|Contact hero intentionally" backend/test/public-content-pages.test.js
```

Expected: 2 tests PASS.

- [ ] **Step 7: Run the public-content regression file**

Run:

```bash
node --test backend/test/public-content-pages.test.js
```

Expected: PASS; all remaining About and Contact content contracts stay green.

- [ ] **Step 8: Commit the markup removal**

```bash
git add about.html contact.html backend/test/public-content-pages.test.js
git commit -m "fix(public): remove retired visual sections"
```

---

### Task 2: Delete all component-only CSS

**Files:**
- Modify: `backend/test/public-content-pages.test.js:1080-1130, 1950-2030, 2435-2460`
- Modify: `css/style.css:1685-1691, 1829-2074, 2215-2232, 2358-2364, 2414-2416, 2475-2482, 2509-2512`

**Interfaces:**
- Consumes: the removed markup contract from Task 1 and existing `publicContentCss`, `cssRuleBlocks`, `cssProperty`, and selector-scoping helpers.
- Produces: no `contact-horizon`, `contactHorizonGlow`, `contactHorizonPin`, or `about-connect` token anywhere in the production stylesheet.

- [ ] **Step 1: Write the failing orphaned-style contract**

Add immediately after the Contact empty-column test:

```js
test('retired public visual selectors are absent from the stylesheet', () => {
  const css = read('css/style.css');
  assert.doesNotMatch(css, /contact-horizon/);
  assert.doesNotMatch(css, /contactHorizon(?:Glow|Pin)/);
  assert.doesNotMatch(css, /about-connect/);
});
```

- [ ] **Step 2: Remove obsolete positive CSS assertions**

In `assertPublicResponsiveContract`, delete the compact and narrow
`.contact-horizon` width assertions.

In `public content CSS is scoped, responsive, keyboard visible and motion safe`:

- remove `.public-content-page .contact-horizon` from the required selector list;
- delete the six assertions for `.contact-horizon`, `.contact-horizon-scene`,
  `.contact-horizon-skyline`, and `.contact-horizon-reflections`;
- delete the reduced-motion loop for `.contact-horizon-glow` and
  `.contact-horizon-pin`.

In `public content eyebrow text meets AA contrast on light and dark surfaces`,
delete:

```js
  const connectEyebrow = cssResolvedColor(
    css,
    base,
    '.public-content-page .about-connect .section-eyebrow',
  );
```

and:

```js
  assert.ok(contrastRatio(connectEyebrow, '#0b1024') >= 4.5, 'eyebrow on connect navy');
```

- [ ] **Step 3: Run the orphaned-style test to verify RED**

Run:

```bash
node --test --test-name-pattern="retired public visual selectors are absent" backend/test/public-content-pages.test.js
```

Expected: FAIL because `css/style.css` still contains both retired components.

- [ ] **Step 4: Remove every Horizon base style and animation**

Delete the complete CSS region beginning with:

```css
.public-content-page .contact-horizon {
```

and ending with the closing brace of:

```css
@keyframes contactHorizonPin {
  0%, 100% {
    transform: rotate(-45deg) translate(0, 0);
  }
  50% {
    transform: rotate(-45deg) translate(3px, -3px);
  }
}
```

The final boundary must be:

```css
@keyframes publicOrbitFloat {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-8px); }
}

.public-content-page .public-section {
```

- [ ] **Step 5: Remove every About CTA style**

Delete:

```css
.public-content-page .about-connect .section-eyebrow {
  color: #58d598;
}
```

Delete the complete `.about-connect`, `.about-connect h2`, and
`.about-connect p` blocks. The final boundary there must be:

```css
.public-content-page .leader-links a,
.public-content-page .public-socials a {
  color: var(--public-indigo-deep);
  font-weight: 750;
}

.public-content-page .contact-layout {
```

Change the button selector group to:

```css
.public-content-page .contact-form .btn,
.public-content-page .public-auth-actions .btn {
  min-height: 44px;
}
```

- [ ] **Step 6: Remove Horizon responsive and reduced-motion styles**

At 979px, retain only the About orbit rule:

```css
  .public-content-page .story-orbit {
    width: min(76vw, 500px);
  }
```

At 660px, retain only:

```css
  .public-content-page .story-orbit {
    width: min(92vw, 420px);
  }
```

The reduced-motion block must begin:

```css
@media (prefers-reduced-motion: reduce) {
  .public-content-page .story-orbit-node {
    animation: none;
  }

  .public-content-page *,
```

- [ ] **Step 7: Run the orphaned-style test to verify GREEN**

Run:

```bash
node --test --test-name-pattern="retired public visual selectors are absent" backend/test/public-content-pages.test.js
```

Expected: PASS.

- [ ] **Step 8: Run all public-content CSS contracts**

Run:

```bash
node --test backend/test/public-content-pages.test.js
```

Expected: PASS, including selector scoping, responsive layout, contrast, focus,
form, footer, and About orbit contracts.

- [ ] **Step 9: Commit the CSS cleanup**

```bash
git add css/style.css backend/test/public-content-pages.test.js
git commit -m "refactor(public): remove retired visual styles"
```

---

### Task 3: Invalidate both page caches and verify the complete site

**Files:**
- Modify: `backend/test/public-content-pages.test.js:1650-1770`
- Modify: `about.html:8`
- Modify: `contact.html:8`

**Interfaces:**
- Consumes: the clean markup and stylesheet from Tasks 1 and 2.
- Produces: both pages loading `css/style.css?v=20260728.6` while Contact keeps `js/api.js?v=20260728.4` and `js/contact.js?v=20260728.4`.

- [ ] **Step 1: Add the failing About stylesheet assertion**

At the beginning of the About content test, after parsing `source`, add:

```js
  const document = parseHtml(source);
  const stylesheets = findAll(document, (node) => (
    node.tagName === 'link' && node.attributes.rel === 'stylesheet'
  )).map((link) => link.attributes.href);
  assert.deepEqual(
    stylesheets,
    ['css/style.css?v=20260728.6'],
    'About loads the visual-removal stylesheet release',
  );
```

Reuse `document` for `visibleBodyText`:

```js
  const text = visibleBodyText(document);
```

- [ ] **Step 2: Change the Contact stylesheet expectation**

In `Contact preserves its details, map fallback and accessible form contract`,
change:

```js
    ['css/style.css?v=20260728.5'],
    'Contact loads the Singapore Horizon stylesheet release',
```

to:

```js
    ['css/style.css?v=20260728.6'],
    'Contact loads the visual-removal stylesheet release',
```

- [ ] **Step 3: Run the page contracts to verify RED**

Run:

```bash
node --test --test-name-pattern="About preserves|Contact preserves" backend/test/public-content-pages.test.js
```

Expected: both tests FAIL because About still loads `.4` and Contact still
loads `.5`.

- [ ] **Step 4: Update only the two stylesheet URLs**

In `about.html` and `contact.html`, use:

```html
<link rel="stylesheet" href="css/style.css?v=20260728.6">
```

Do not change any script URL.

- [ ] **Step 5: Run the page contracts to verify GREEN**

Run:

```bash
node --test --test-name-pattern="About preserves|Contact preserves" backend/test/public-content-pages.test.js
```

Expected: both tests PASS.

- [ ] **Step 6: Run exact scope and formatting checks**

Run:

```bash
git diff --check
if rg -n "about-connect|Let's Innovate Together|Join us in shaping the future|>Get Started<" about.html; then exit 1; fi
if rg -n "contact-horizon|contact-orbit|node-visit|node-email|node-call" contact.html; then exit 1; fi
if rg -n "about-connect|contact-horizon|contactHorizonGlow|contactHorizonPin" css/style.css; then exit 1; fi
```

Expected: all commands exit successfully with no matches.

- [ ] **Step 7: Run the complete automated suite**

Run:

```bash
npm test
```

Working directory: `backend`

Expected: all tests PASS with zero failures.

- [ ] **Step 8: Perform desktop verification when a browser is available**

Verify:

- About ends after leadership and proceeds directly to the shared footer;
- Contact retains its original left hero copy;
- the Contact hero’s right desktop column is blank;
- Contact details, map, form, navbar, and footer remain unchanged;
- no horizontal overflow or browser-console error appears.

If no browser instance is available, report that limitation explicitly and
use automated structural checks instead of claiming visual verification.

- [ ] **Step 9: Commit the cache-key release**

```bash
git add about.html contact.html backend/test/public-content-pages.test.js
git commit -m "chore(public): bump visual-removal stylesheet release"
```

- [ ] **Step 10: Confirm the local handoff**

Run:

```bash
git status --short
git log -5 --oneline
```

Expected: a clean worktree with the specification, plan, and three
implementation commits at the top of `main`. Do not push to GitHub or SFTP
without a new explicit release request.
