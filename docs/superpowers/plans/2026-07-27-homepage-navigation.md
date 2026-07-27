# Homepage About and Contact Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add direct About and Contact navigation to the homepage header while preserving a compact, accessible 320px experience.

**Architecture:** Replace the homepage header's single all-purpose `nav` wrapper with a neutral flex container containing one desktop navigation landmark, one native compact `details` menu with its own navigation landmark, and the existing authentication action group. Keep all styling under `.landing-page`, use CSS-only responsive switching at 719px, and leave every non-homepage header unchanged.

**Tech Stack:** Semantic HTML5, scoped CSS, Node.js built-in test runner, repository HTML/CSS contract tests, in-app browser acceptance.

## Global Constraints

- Modify only `index.html`, homepage-scoped rules in `css/style.css`, and their focused tests.
- The desktop link set is exactly `About` → `about.html` and `Contact` → `contact.html`.
- The compact link set is exactly `About` → `about.html`, `Contact` → `contact.html`, and `Sign in` → `signin.html`.
- Keep `Sign up` visible in both desktop and compact layouts.
- Do not add Portfolio, Blog, FAQ, or administrative-role links.
- Use ordinary same-origin anchors; add no navigation JavaScript.
- Preserve 44px interactive targets, visible focus indicators, keyboard access, and a viewport-contained menu at 320px.
- Do not change the About or Contact page headers, authentication behaviour, APIs, database data, deployment state, or Git integration state.

---

### Task 1: Homepage desktop and compact navigation

**Files:**
- Modify: `backend/test/frontend-flow-contract.test.js:321-453`
- Modify: `index.html:12-45`
- Modify: `css/style.css:557-618`
- Modify: `css/style.css:1118-1205`

**Interfaces:**
- Consumes: Existing same-origin pages `about.html`, `contact.html`, `signin.html`, and `signup.html`; existing `.landing-page` visual tokens and focus treatment.
- Produces: A desktop `nav.landing-page-links[aria-label="Primary navigation"]`; a native `details.landing-menu` containing `nav[aria-label="Compact primary navigation"]`; unchanged authentication destinations.

- [ ] **Step 1: Add a test helper and failing homepage navigation contract**

Add this helper beside `visibleText()` in `backend/test/frontend-flow-contract.test.js`:

```js
function anchorRoutes(markup) {
  return [...markup.matchAll(
    /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
  )].map((match) => [visibleText(match[2]), match[1]]);
}
```

Replace the broad navigation assertions in
`homepage exposes only the two public audience journeys` with exact shell
contracts:

```js
  const desktopNav = html.match(
    /<nav\b[^>]*class=["'][^"']*\blanding-page-links\b[^"']*["'][^>]*aria-label=["']Primary navigation["'][^>]*>[\s\S]*?<\/nav>/i,
  )?.[0];
  const compactMenu = html.match(
    /<details\b[^>]*class=["'][^"']*\blanding-menu\b[^"']*["'][^>]*>[\s\S]*?<\/details>/i,
  )?.[0];
  const compactNav = compactMenu?.match(
    /<nav\b[^>]*aria-label=["']Compact primary navigation["'][^>]*>[\s\S]*?<\/nav>/i,
  )?.[0];
  const authActions = html.match(
    /<div\b[^>]*class=["'][^"']*\blanding-nav-actions\b[^"']*["'][^>]*>[\s\S]*?<\/div>/i,
  )?.[0];

  assert.ok(desktopNav, 'missing homepage desktop navigation');
  assert.ok(compactMenu, 'missing homepage compact menu');
  assert.match(compactMenu, /<summary>\s*Menu\s*<\/summary>/i);
  assert.ok(compactNav, 'missing homepage compact navigation');
  assert.ok(authActions, 'missing homepage authentication actions');
  assert.deepEqual(anchorRoutes(desktopNav), [
    ['About', 'about.html'],
    ['Contact', 'contact.html'],
  ]);
  assert.deepEqual(anchorRoutes(compactNav), [
    ['About', 'about.html'],
    ['Contact', 'contact.html'],
    ['Sign in', 'signin.html'],
  ]);
  assert.deepEqual(anchorRoutes(authActions), [
    ['Sign in', 'signin.html'],
    ['Sign up', 'signup.html'],
  ]);
```

Extend `homepage styles are scoped and follow the approved breakpoints`:

```js
  assert.match(
    css,
    /\.landing-page \.landing-menu\s*\{[^}]*display:\s*none/s,
  );
  assert.match(
    css,
    /@media \(max-width:\s*719px\)[\s\S]*?\.landing-page \.landing-page-links\s*\{[^}]*display:\s*none/,
  );
  assert.match(
    css,
    /@media \(max-width:\s*719px\)[\s\S]*?\.landing-page \.landing-menu\s*\{[^}]*display:\s*block/,
  );
  assert.match(
    css,
    /@media \(max-width:\s*719px\)[\s\S]*?\.landing-page \.landing-nav-signin\s*\{[^}]*display:\s*none/,
  );
```

Extend `homepage accessibility styles preserve contrast and touch targets`:

```js
  for (const selector of [
    '\\.landing-page-links a',
    '\\.landing-menu summary',
    '\\.landing-menu nav a',
  ]) {
    assert.match(
      css,
      new RegExp(`\\.landing-page ${selector}\\s*\\{[^}]*min-height:\\s*44px`, 's'),
    );
  }
  assert.match(
    css,
    /@media \(max-width:\s*719px\)[\s\S]*?\.landing-page \.landing-menu nav\s*\{[^}]*left:\s*32px;[^}]*right:\s*32px;/,
  );
  assert.match(
    css,
    /@media \(max-width:\s*599px\)[\s\S]*?\.landing-page \.landing-menu nav\s*\{[^}]*left:\s*16px;[^}]*right:\s*16px;/,
  );
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test backend/test/frontend-flow-contract.test.js
```

Expected: FAIL at `missing homepage desktop navigation` because
`index.html` does not yet contain `.landing-page-links`.

- [ ] **Step 3: Implement the semantic homepage header**

In `index.html`, change the element with class `landing-nav` from `nav` to
`div`, retain the brand first, and insert:

```html
      <nav class="landing-page-links" aria-label="Primary navigation">
        <a href="about.html">About</a>
        <a href="contact.html">Contact</a>
      </nav>
      <details class="landing-menu">
        <summary>Menu</summary>
        <nav aria-label="Compact primary navigation">
          <a href="about.html">About</a>
          <a href="contact.html">Contact</a>
          <a href="signin.html">Sign in</a>
        </nav>
      </details>
```

Keep the authentication group last, add `landing-nav-signin` to its existing
Sign in anchor, and close the neutral `div` instead of `nav`. Change the
stylesheet query to `css/style.css?v=20260727.3`.

- [ ] **Step 4: Add minimal scoped desktop and compact styling**

In the existing landing-page section of `css/style.css`:

```css
.landing-page .landing-page-links {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}

.landing-page .landing-page-links a,
.landing-page .landing-menu summary,
.landing-page .landing-menu nav a {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #4F586D;
  font-size: 14px;
  font-weight: 700;
  text-decoration: none;
}

.landing-page .landing-page-links a {
  min-height: 44px;
  padding: 0 15px;
  border-radius: 10px;
}

.landing-page .landing-menu {
  display: none;
  position: static;
}

.landing-page .landing-menu summary {
  min-height: 44px;
  padding: 0 12px;
  border-radius: 10px;
  cursor: pointer;
  list-style: none;
}

.landing-page .landing-menu summary::-webkit-details-marker {
  display: none;
}

.landing-page .landing-menu summary::after {
  content: "＋";
  margin-left: 7px;
  color: #5558DE;
}

.landing-page .landing-menu[open] summary::after {
  content: "−";
}

.landing-page .landing-menu nav {
  position: absolute;
  top: calc(100% + 8px);
  z-index: 40;
  display: grid;
  padding: 8px;
  border: 1px solid #E0E3EC;
  border-radius: 14px;
  background: #FFFFFF;
  box-shadow: 0 18px 44px rgba(18, 25, 43, 0.16);
}

.landing-page .landing-menu nav a {
  min-height: 44px;
  justify-content: flex-start;
  padding: 0 14px;
  border-radius: 8px;
}

.landing-page .landing-page-links a:hover,
.landing-page .landing-menu summary:hover,
.landing-page .landing-menu nav a:hover {
  color: #3437A8;
  background: #F0F0FF;
}
```

Add `.landing-page .landing-page-links a`,
`.landing-page .landing-menu summary`, and
`.landing-page .landing-menu nav a` to the existing landing focus-selector
group.

Before the existing 599px media query, add:

```css
@media (max-width: 719px) {
  .landing-page .landing-page-links,
  .landing-page .landing-nav-signin {
    display: none;
  }

  .landing-page .landing-menu {
    display: block;
  }

  .landing-page .landing-menu nav {
    left: 32px;
    right: 32px;
  }
}
```

Inside the existing 599px media query, add:

```css
  .landing-page .landing-menu nav {
    left: 16px;
    right: 16px;
  }
```

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```bash
node --test backend/test/frontend-flow-contract.test.js
node --test backend/test/public-content-pages.test.js
```

Expected: both commands PASS. The second command proves the About and Contact
headers and their responsive CSS contracts remain unchanged.

- [ ] **Step 6: Run full verification**

Run:

```bash
npm --prefix backend test
git diff --check
```

Expected: 0 failed tests and no diff-check output.

- [ ] **Step 7: Perform browser acceptance**

Open `index.html` through a local HTTP server and verify:

- At 1440px, About and Contact appear between the brand and auth actions.
- At 719px and below, the desktop page links and duplicate Sign in link are
  hidden; Menu and Sign up remain visible.
- At 320px, opening Menu exposes About, Contact, and Sign in within the
  viewport, and `document.documentElement.scrollWidth === window.innerWidth`.
- Tab and Enter/Space operate the native summary and each link has a visible
  focus indicator.
- The browser console contains no errors or warnings.

- [ ] **Step 8: Commit**

```bash
git add backend/test/frontend-flow-contract.test.js index.html css/style.css
git commit -m "feat(home): add about and contact navigation"
```
