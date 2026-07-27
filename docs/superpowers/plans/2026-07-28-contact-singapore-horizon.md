# Contact Singapore Horizon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Contact hero's generic orbit with the approved abstract Singapore Horizon visual.

**Architecture:** `contact.html` will contain one accessible `contact-horizon` figure made entirely from decorative spans. Contact-specific rules in the existing public-content CSS section will draw the glow, connection arcs, location marker, skyline, and reflections while preserving About's shared orbit. Existing parser and CSS-contract helpers will verify structure, scoping, responsive containment, and reduced-motion behavior.

**Tech Stack:** Semantic HTML5, CSS custom properties and pseudo-elements, Node.js built-in test runner, existing HTML/CSS contract helpers.

## Global Constraints

- Preserve the Contact hero background, left-side eyebrow, heading, and supporting sentence.
- Use the approved Singapore Horizon direction with navy, indigo, and green.
- Do not use a stock photograph, external image, canvas, JavaScript animation, new font, package, or dependency.
- Keep one concise accessible description on the figure; every internal shape is decorative and uses `aria-hidden="true"`.
- Keep all new component selectors scoped beneath `.public-content-page`.
- Do not change the About orbit, Contact form, map, footer, navigation, backend, API, database, or environment.
- Desktop is the primary acceptance target; narrow-screen work is limited to safe scaling and overflow prevention.
- Any new motion must stop under `prefers-reduced-motion: reduce`.
- Update only the Contact stylesheet cache key from `20260728.4` to `20260728.5`; Contact JavaScript keys remain unchanged.
- GitHub and SFTP release actions require explicit user authorization after local implementation.

---

### Task 1: Establish and build the accessible Singapore scene

**Files:**
- Modify: `backend/test/public-content-pages.test.js:1690-1705`
- Modify: `contact.html:62-69`

**Interfaces:**
- Consumes: existing `read`, `parseHtml`, `findOne`, `findAll`, `hasClass`, and `hasAttribute` test helpers.
- Produces: exactly one `figure.contact-horizon` whose accessible name identifies Lumi5 Labs and Singapore, with decorative glow, arcs, marker, skyline, buildings, landmark, and reflection elements.

- [ ] **Step 1: Write the failing scene-structure test**

Add this test immediately before `Contact preserves its details, map fallback and accessible form contract`:

```js
test('Contact hero presents one accessible Singapore Horizon scene', () => {
  const source = read('contact.html');
  const document = parseHtml(source);
  const horizons = findAll(document, (node) => (
    node.tagName === 'figure' && hasClass(node, 'contact-horizon')
  ));

  assert.equal(horizons.length, 1, 'Contact has one Singapore Horizon figure');
  const horizon = horizons[0];
  assert.match(
    horizon.attributes['aria-label'] || '',
    /Lumi5 Labs.*Singapore/i,
    'scene label identifies Lumi5 Labs and Singapore',
  );

  const requiredClasses = [
    'contact-horizon-scene',
    'contact-horizon-glow',
    'contact-horizon-arc--outer',
    'contact-horizon-arc--inner',
    'contact-horizon-pin',
    'contact-horizon-skyline',
    'contact-horizon-building',
    'contact-horizon-landmark',
    'contact-horizon-reflections',
  ];
  for (const className of requiredClasses) {
    assert.ok(
      findAll(horizon, (node) => hasClass(node, className)).length > 0,
      `${className}: decorative scene element`,
    );
  }

  const decorativeElements = findAll(horizon, (node) => (
    node !== horizon && node.tagName === 'span'
  ));
  assert.ok(decorativeElements.length >= 20, 'scene has enough detail to read as a skyline');
  for (const element of decorativeElements) {
    assert.equal(
      element.attributes['aria-hidden'],
      'true',
      `${element.attributes.class || element.tagName}: hidden decorative element`,
    );
  }

  assert.equal(
    findAll(horizon, (node) => hasClass(node, 'contact-horizon-building')).length,
    5,
    'scene has five supporting buildings',
  );
  assert.doesNotMatch(source, /\bcontact-orbit\b|\bnode-(?:visit|email|call)\b/);
});
```

- [ ] **Step 2: Run the focused test to verify RED**

Run:

```bash
node --test --test-name-pattern="Contact hero presents one accessible Singapore Horizon scene" backend/test/public-content-pages.test.js
```

Expected: FAIL with `Contact has one Singapore Horizon figure`, because the page still contains `story-orbit contact-orbit`.

- [ ] **Step 3: Replace only the Contact orbit markup**

Replace the existing `figure.story-orbit.contact-orbit` in `contact.html` with:

```html
<figure class="contact-horizon" aria-label="Lumi5 Labs in Singapore, connected across a growing business horizon.">
  <span class="contact-horizon-scene" aria-hidden="true">
    <span class="contact-horizon-glow" aria-hidden="true"></span>
    <span class="contact-horizon-arc contact-horizon-arc--outer" aria-hidden="true"></span>
    <span class="contact-horizon-arc contact-horizon-arc--inner" aria-hidden="true"></span>
    <span class="contact-horizon-pin" aria-hidden="true">
      <span class="contact-horizon-pin-core" aria-hidden="true"></span>
    </span>
    <span class="contact-horizon-label" aria-hidden="true">Singapore</span>
    <span class="contact-horizon-skyline" aria-hidden="true">
      <span class="contact-horizon-building contact-horizon-building--one" aria-hidden="true">
        <span class="contact-horizon-windows" aria-hidden="true"></span>
      </span>
      <span class="contact-horizon-building contact-horizon-building--two" aria-hidden="true">
        <span class="contact-horizon-windows" aria-hidden="true"></span>
      </span>
      <span class="contact-horizon-landmark" aria-hidden="true">
        <span class="contact-horizon-tower contact-horizon-tower--one" aria-hidden="true"></span>
        <span class="contact-horizon-tower contact-horizon-tower--two" aria-hidden="true"></span>
        <span class="contact-horizon-tower contact-horizon-tower--three" aria-hidden="true"></span>
        <span class="contact-horizon-skypark" aria-hidden="true"></span>
      </span>
      <span class="contact-horizon-building contact-horizon-building--three" aria-hidden="true">
        <span class="contact-horizon-windows" aria-hidden="true"></span>
      </span>
      <span class="contact-horizon-building contact-horizon-building--four" aria-hidden="true">
        <span class="contact-horizon-windows" aria-hidden="true"></span>
      </span>
      <span class="contact-horizon-building contact-horizon-building--five" aria-hidden="true">
        <span class="contact-horizon-windows" aria-hidden="true"></span>
      </span>
    </span>
    <span class="contact-horizon-reflections" aria-hidden="true">
      <span aria-hidden="true"></span>
      <span aria-hidden="true"></span>
      <span aria-hidden="true"></span>
      <span aria-hidden="true"></span>
      <span aria-hidden="true"></span>
    </span>
  </span>
</figure>
```

- [ ] **Step 4: Run the focused test to verify GREEN**

Run:

```bash
node --test --test-name-pattern="Contact hero presents one accessible Singapore Horizon scene" backend/test/public-content-pages.test.js
```

Expected: PASS.

- [ ] **Step 5: Run the full public-content test file**

Run:

```bash
node --test backend/test/public-content-pages.test.js
```

Expected: PASS; Contact details, form, map, navbar, footer, and About content remain unchanged.

- [ ] **Step 6: Commit the structural change**

```bash
git add contact.html backend/test/public-content-pages.test.js
git commit -m "feat(contact): add accessible Singapore horizon scene"
```

---

### Task 2: Draw the horizon and lock down its responsive contract

**Files:**
- Modify: `backend/test/public-content-pages.test.js:1080-1130, 1880-1930`
- Modify: `css/style.css:1735-1815, 2150-2250`

**Interfaces:**
- Consumes: the `contact-horizon` class contract from Task 1 and existing `publicContentCss`, `cssRuleBlocks`, `cssRule`, `cssProperty`, and `cssMediaRules` helpers.
- Produces: a contained 520px abstract scene with two connection arcs, a glowing Singapore marker, five supporting buildings, a three-tower landmark, water reflections, compact scaling at 979px, narrow scaling at 660px, and reduced-motion overrides.

- [ ] **Step 1: Write the failing base-style contract**

In `public content CSS is scoped, responsive, keyboard visible and motion safe`, add `.public-content-page .contact-horizon` to the required-selector list. Then add:

```js
  assert.equal(
    cssProperty(base, '.public-content-page .contact-horizon', 'overflow'),
    'hidden',
  );
  assert.equal(
    cssProperty(base, '.public-content-page .contact-horizon', 'isolation'),
    'isolate',
  );
  assert.match(
    cssProperty(base, '.public-content-page .contact-horizon', 'width'),
    /min\(100%,\s*520px\)/,
  );
  assert.equal(
    cssProperty(base, '.public-content-page .contact-horizon-scene', 'position'),
    'absolute',
  );
  assert.equal(
    cssProperty(base, '.public-content-page .contact-horizon-skyline', 'display'),
    'flex',
  );
  assert.equal(
    cssProperty(base, '.public-content-page .contact-horizon-reflections', 'overflow'),
    'hidden',
  );
```

- [ ] **Step 2: Extend the failing responsive and reduced-motion contracts**

At the end of `assertPublicResponsiveContract`, add:

```js
  assert.equal(
    cssProperty(compact, '.public-content-page .contact-horizon', 'width'),
    'min(76vw, 500px)',
    '979px safely scales the Contact horizon',
  );
  assert.equal(
    cssProperty(narrow, '.public-content-page .contact-horizon', 'width'),
    'min(92vw, 420px)',
    '660px safely scales the Contact horizon',
  );
```

In the reduced-motion assertions in `public content CSS is scoped, responsive, keyboard visible and motion safe`, add:

```js
  assert.equal(
    cssProperty(
      reducedMotion,
      '.public-content-page .contact-horizon-glow, .public-content-page .contact-horizon-pin',
      'animation',
    ),
    'none',
  );
```

- [ ] **Step 3: Run the CSS contract to verify RED**

Run:

```bash
node --test --test-name-pattern="public content CSS is scoped, responsive, keyboard visible and motion safe" backend/test/public-content-pages.test.js
```

Expected: FAIL with `missing CSS rule: .public-content-page .contact-horizon`.

- [ ] **Step 4: Add the base Singapore Horizon styles**

Add the following immediately after the existing `@keyframes publicOrbitFloat` block. Keep the shared `story-orbit` rules intact for About:

```css
.public-content-page .contact-horizon {
  position: relative;
  isolation: isolate;
  width: min(100%, 520px);
  aspect-ratio: 1.08;
  justify-self: center;
  overflow: hidden;
  margin: 0;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 36px;
  background:
    radial-gradient(circle at 68% 33%, rgba(99, 102, 241, 0.26), transparent 32%),
    linear-gradient(155deg, rgba(255, 255, 255, 0.08), rgba(8, 14, 38, 0.18));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.12),
    0 32px 70px rgba(4, 9, 30, 0.3);
}

.public-content-page .contact-horizon::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: -1;
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.035) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.035) 1px, transparent 1px);
  background-size: 36px 36px;
  mask-image: linear-gradient(to bottom, rgba(0, 0, 0, 0.72), transparent 78%);
}

.public-content-page .contact-horizon-scene {
  position: absolute;
  inset: 0;
}

.public-content-page .contact-horizon-glow {
  position: absolute;
  top: 10%;
  right: 8%;
  width: 58%;
  aspect-ratio: 1;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(83, 231, 166, 0.22), rgba(99, 102, 241, 0.12) 44%, transparent 72%);
  filter: blur(10px);
  animation: contactHorizonGlow 6s ease-in-out infinite;
}

.public-content-page .contact-horizon-arc {
  position: absolute;
  border: 1px solid rgba(196, 205, 255, 0.34);
  border-right-color: transparent;
  border-bottom-color: transparent;
  border-radius: 50%;
  transform: rotate(14deg);
}

.public-content-page .contact-horizon-arc--outer {
  top: 9%;
  left: 9%;
  width: 82%;
  height: 54%;
}

.public-content-page .contact-horizon-arc--inner {
  top: 18%;
  left: 20%;
  width: 61%;
  height: 38%;
  border-color: rgba(83, 231, 166, 0.34);
  border-right-color: transparent;
  border-bottom-color: transparent;
}

.public-content-page .contact-horizon-pin {
  position: absolute;
  top: 23%;
  left: 63%;
  width: 30px;
  height: 38px;
  border: 2px solid rgba(255, 255, 255, 0.76);
  border-radius: 50% 50% 50% 8px;
  background: var(--public-green);
  box-shadow:
    0 0 0 8px rgba(83, 231, 166, 0.09),
    0 12px 28px rgba(83, 231, 166, 0.3);
  transform: rotate(-45deg);
  animation: contactHorizonPin 4.8s ease-in-out infinite;
}

.public-content-page .contact-horizon-pin-core {
  position: absolute;
  inset: 8px;
  border-radius: 50%;
  background: #fff;
}

.public-content-page .contact-horizon-label {
  position: absolute;
  top: 33%;
  left: 52%;
  padding: 6px 10px;
  color: #f5f7ff;
  background: rgba(9, 15, 40, 0.7);
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.public-content-page .contact-horizon-skyline {
  position: absolute;
  right: 8%;
  bottom: 20%;
  left: 8%;
  height: 42%;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 2.2%;
  border-bottom: 1px solid rgba(255, 255, 255, 0.42);
}

.public-content-page .contact-horizon-building {
  position: relative;
  flex: 0 0 9%;
  min-width: 20px;
  border: 1px solid rgba(255, 255, 255, 0.22);
  border-bottom: 0;
  border-radius: 4px 4px 0 0;
  background: linear-gradient(180deg, rgba(104, 117, 194, 0.9), rgba(22, 30, 73, 0.94));
  box-shadow: inset 8px 0 18px rgba(255, 255, 255, 0.04);
}

.public-content-page .contact-horizon-building--one {
  height: 42%;
}

.public-content-page .contact-horizon-building--two {
  height: 63%;
  border-radius: 9px 9px 0 0;
}

.public-content-page .contact-horizon-building--three {
  height: 72%;
  clip-path: polygon(14% 0, 86% 0, 100% 100%, 0 100%);
}

.public-content-page .contact-horizon-building--four {
  height: 50%;
}

.public-content-page .contact-horizon-building--five {
  height: 36%;
  border-radius: 18px 18px 0 0;
}

.public-content-page .contact-horizon-windows {
  position: absolute;
  inset: 14% 22% 10%;
  opacity: 0.72;
  background-image:
    linear-gradient(90deg, rgba(191, 255, 226, 0.66) 2px, transparent 2px),
    linear-gradient(rgba(191, 255, 226, 0.54) 2px, transparent 2px);
  background-size: 9px 9px;
}

.public-content-page .contact-horizon-landmark {
  position: relative;
  flex: 0 0 30%;
  height: 88%;
}

.public-content-page .contact-horizon-tower {
  position: absolute;
  bottom: 0;
  width: 25%;
  border: 1px solid rgba(255, 255, 255, 0.28);
  border-bottom: 0;
  border-radius: 22px 22px 0 0;
  background: linear-gradient(180deg, rgba(109, 122, 208, 0.96), rgba(18, 26, 67, 0.98));
}

.public-content-page .contact-horizon-tower--one {
  left: 4%;
  height: 78%;
  transform: skewX(-2deg);
}

.public-content-page .contact-horizon-tower--two {
  left: 37.5%;
  height: 88%;
}

.public-content-page .contact-horizon-tower--three {
  right: 4%;
  height: 72%;
  transform: skewX(2deg);
}

.public-content-page .contact-horizon-skypark {
  position: absolute;
  top: 4%;
  left: 0;
  width: 100%;
  height: 13%;
  border: 1px solid rgba(255, 255, 255, 0.34);
  border-radius: 60% 28% 46% 38% / 70% 54% 46% 44%;
  background: linear-gradient(90deg, rgba(83, 231, 166, 0.88), rgba(119, 123, 228, 0.94));
  box-shadow: 0 8px 22px rgba(4, 9, 30, 0.36);
  transform: rotate(-2deg);
}

.public-content-page .contact-horizon-reflections {
  position: absolute;
  right: 9%;
  bottom: 6%;
  left: 9%;
  height: 12%;
  display: flex;
  justify-content: space-around;
  overflow: hidden;
  opacity: 0.52;
  mask-image: linear-gradient(to bottom, #000, transparent);
}

.public-content-page .contact-horizon-reflections > span {
  width: 10%;
  height: 100%;
  background: linear-gradient(to bottom, rgba(132, 151, 240, 0.58), transparent);
  clip-path: polygon(18% 0, 82% 0, 100% 100%, 0 100%);
}

@keyframes contactHorizonGlow {
  0%, 100% {
    opacity: 0.72;
    transform: scale(0.96);
  }
  50% {
    opacity: 1;
    transform: scale(1.04);
  }
}

@keyframes contactHorizonPin {
  0%, 100% {
    transform: rotate(-45deg) translate(0, 0);
  }
  50% {
    transform: rotate(-45deg) translate(3px, -3px);
  }
}
```

- [ ] **Step 5: Add compact, narrow, and reduced-motion rules**

In `@media (max-width: 979px)`, after the existing `.story-orbit` width rule, add:

```css
  .public-content-page .contact-horizon {
    width: min(76vw, 500px);
  }
```

In `@media (max-width: 660px)`, after the existing `.story-orbit` width rule, add:

```css
  .public-content-page .contact-horizon {
    width: min(92vw, 420px);
    border-radius: 26px;
  }

  .public-content-page .contact-horizon-label {
    font-size: 0.64rem;
  }
```

In `@media (prefers-reduced-motion: reduce)`, before the existing universal public-content override, add:

```css
  .public-content-page .contact-horizon-glow,
  .public-content-page .contact-horizon-pin {
    animation: none;
  }
```

- [ ] **Step 6: Run the focused CSS test to verify GREEN**

Run:

```bash
node --test --test-name-pattern="public content CSS is scoped, responsive, keyboard visible and motion safe" backend/test/public-content-pages.test.js
```

Expected: PASS.

- [ ] **Step 7: Run all public-content regression tests**

Run:

```bash
node --test backend/test/public-content-pages.test.js
```

Expected: PASS, including selector-scoping mutation tests and the unchanged About orbit contract.

- [ ] **Step 8: Commit the visual styling**

```bash
git add css/style.css backend/test/public-content-pages.test.js
git commit -m "feat(contact): style Singapore horizon visual"
```

---

### Task 3: Invalidate the Contact stylesheet cache and verify the complete site

**Files:**
- Modify: `backend/test/public-content-pages.test.js:1690-1710`
- Modify: `contact.html:8`

**Interfaces:**
- Consumes: the completed Contact HTML/CSS visual from Tasks 1 and 2.
- Produces: Contact loading `css/style.css?v=20260728.5` while retaining `js/api.js?v=20260728.4` and `js/contact.js?v=20260728.4`.

- [ ] **Step 1: Write the failing Contact asset-version assertion**

In `Contact preserves its details, map fallback and accessible form contract`, after parsing the document, add:

```js
  const stylesheets = findAll(document, (node) => (
    node.tagName === 'link' && node.attributes.rel === 'stylesheet'
  )).map((link) => link.attributes.href);
  assert.deepEqual(
    stylesheets,
    ['css/style.css?v=20260728.5'],
    'Contact loads the Singapore Horizon stylesheet release',
  );
```

- [ ] **Step 2: Run the Contact contract to verify RED**

Run:

```bash
node --test --test-name-pattern="Contact preserves its details" backend/test/public-content-pages.test.js
```

Expected: FAIL because the page still loads `css/style.css?v=20260728.4`.

- [ ] **Step 3: Bump only the Contact stylesheet URL**

Change the stylesheet link at the top of `contact.html` to:

```html
<link rel="stylesheet" href="css/style.css?v=20260728.5">
```

Do not change the two Contact script URLs.

- [ ] **Step 4: Run the Contact contract to verify GREEN**

Run:

```bash
node --test --test-name-pattern="Contact preserves its details" backend/test/public-content-pages.test.js
```

Expected: PASS.

- [ ] **Step 5: Run formatting and scope checks**

Run:

```bash
git diff --check
rg -n "contact-orbit|node-visit|node-email|node-call" contact.html
rg -n "contact-horizon" about.html
```

Expected:

- `git diff --check` exits successfully with no output.
- The two `rg` commands exit with status 1 and no matches, proving the old Contact orbit is gone and About markup was not coupled to the new component.

- [ ] **Step 6: Run the complete automated suite**

Run:

```bash
npm test
```

Working directory: `backend`

Expected: all tests PASS with zero failures.

- [ ] **Step 7: Perform desktop visual verification**

Serve the repository root and inspect `contact.html` at a desktop viewport:

```bash
python3 -m http.server 4173
```

Verify:

- the left Contact copy is unchanged;
- the right visual is recognizably the approved indigo/green Singapore Horizon;
- the location marker and Singapore label are visible;
- the skyline is contained with no clipping of its outer frame;
- the Contact form, map, navbar, and footer still render normally;
- About still shows its original orbit;
- the browser console has no warnings or errors.

Stop the local server after inspection.

- [ ] **Step 8: Commit the verified release key**

```bash
git add contact.html backend/test/public-content-pages.test.js
git commit -m "chore(contact): bump horizon stylesheet release"
```

- [ ] **Step 9: Confirm the local handoff state**

Run:

```bash
git status --short
git log -4 --oneline
```

Expected: a clean worktree and the spec plus three implementation commits at the top of `main`. Do not push to GitHub or SFTP without a new explicit release request.
