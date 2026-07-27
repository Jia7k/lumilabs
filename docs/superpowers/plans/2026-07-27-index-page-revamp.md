# Public Index Page Revamp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the five-role prototype selector with the approved public Dual Journey + Connection Orbit homepage for business owners and investors.

**Architecture:** Keep the homepage static and semantic in `index.html`, with no API or database dependency. Replace the existing landing-only rules inside `css/style.css` with selectors scoped beneath `body.landing-page`, preserve the current sign-in/signup JavaScript unchanged, and lock the public copy, routes, accessibility contract, and responsive breakpoints with Node tests.

**Tech Stack:** HTML5, CSS3, vanilla browser JavaScript already present in the repository, Node.js built-in test runner

## Global Constraints

- The index page must not contain any visible or accessibility-text mention of Relationship Manager, Administrator, or Superadmin.
- Navigation contains only the Lumi5 Labs brand, `Sign in`, and `Sign up`; it does not contain a top-level `How it works` link.
- `Sign in` links to `signin.html`.
- Generic `Sign up` links to `signup.html`.
- Business-owner actions link to `signup.html?role=business_owner`.
- Investor actions link to `signup.html?role=investor`.
- The approved direction is Dual Journey + Connection Orbit with a light neutral, indigo, and green palette.
- The orbit is labeled for assistive technology as `Lumi5 Labs connects businesses and investors around shared sector, stage, geography, and capital priorities.`
- The page remains static and must not fetch API or database data.
- Leave `js/script.js` unchanged.
- Scope all new landing styles beneath `body.landing-page` or `.landing-page`.
- At 900 pixels and above, use the two-column hero and desktop grids.
- From 600 through 899 pixels, use a single-column hero and audience cards while trust items and explanatory steps remain three columns.
- Below 600 pixels, stack the hero, trust items, audience cards, and explanatory steps in one column.
- Production changes are limited to `index.html` and the landing-page block in `css/style.css`.
- Test changes are limited to `backend/test/frontend-flow-contract.test.js`.
- Do not change authentication, authorization, role routing, dashboards, messaging, backend routes, database schema, or SFTP structure.
- Retain the shared frontend asset version `20260727.1`.

---

## File Structure

- `index.html`: owns all public homepage semantics, approved copy, calls to action, Connection Orbit markup, and accessibility labels.
- `css/style.css`: owns the isolated landing-page presentation and responsive rules inside the existing `/* LANDING PAGE */` section.
- `backend/test/frontend-flow-contract.test.js`: owns the static public homepage contract, route checks, forbidden-role checks, and responsive CSS contract.
- `js/script.js`: remains unchanged and continues to own the existing sign-in and signup form behavior.

---

### Task 1: Public homepage semantics, copy, and routes

**Files:**
- Modify: `backend/test/frontend-flow-contract.test.js:305-329`
- Modify: `index.html:9-164`

**Interfaces:**
- Consumes: existing pages `signin.html` and `signup.html`, plus the existing signup query values `business_owner` and `investor`.
- Produces: semantic landing markup and stable class hooks beginning with `landing-` for Task 2.

- [ ] **Step 1: Replace the five-role homepage tests with the public-page contract**

Replace the tests named `homepage offers all five roles without public staff signup` and `homepage role grid has explicit five, two, and one-column breakpoints` with:

```js
test('homepage exposes only the two public audience journeys', () => {
  const html = read('index.html');
  const nav = html.match(/<nav\b[\s\S]*?<\/nav>/i)?.[0];

  assert.ok(nav, 'missing homepage navigation');
  assert.doesNotMatch(
    html,
    /Relationship Manager|Administrator|Superadmin/i,
  );
  assert.doesNotMatch(
    html,
    /signin\.html\?role=(?:relationship_manager|admin|superadmin)/i,
  );
  assert.doesNotMatch(nav, /How it works/i);

  assert.match(nav, /href=["']signin\.html["'][^>]*>\s*Sign in\s*</i);
  assert.match(nav, /href=["']signup\.html["'][^>]*>\s*Sign up\s*</i);
  assert.match(
    html,
    /href=["']signup\.html\?role=business_owner["'][^>]*>\s*Raise capital/i,
  );
  assert.match(
    html,
    /href=["']signup\.html\?role=business_owner["'][^>]*>\s*Start raising/i,
  );
  assert.match(
    html,
    /href=["']signup\.html\?role=investor["'][^>]*>\s*Explore opportunities/i,
  );
  assert.match(
    html,
    /href=["']signup\.html\?role=investor["'][^>]*>\s*Start exploring/i,
  );
});

test('homepage contains the approved semantic content and orbit description', () => {
  const html = read('index.html');

  assert.match(html, /<body class=["']landing-page["']/i);
  assert.equal([...html.matchAll(/<h1\b/gi)].length, 1);
  assert.match(html, /<main\b[^>]*>/i);
  assert.match(html, /<footer\b[^>]*>/i);
  assert.match(html, /Funding,\s*found[\s\S]*with focus\./i);
  assert.match(html, /One platform,\s*two ambitions/i);
  assert.match(html, /A clearer path to the right connection/i);
  assert.match(html, /Find your next meaningful connection\./i);
  assert.match(
    html,
    /role=["']img["'][^>]*aria-label=["']Lumi5 Labs connects businesses and investors around shared sector, stage, geography, and capital priorities\.["']/i,
  );
  assert.match(html, /<script src=["']js\/script\.js\?v=20260727\.1["']/i);
});
```

- [ ] **Step 2: Run the focused contract test and verify RED**

Run:

```bash
node --test backend/test/frontend-flow-contract.test.js
```

Expected: FAIL because the existing index still names all three internal roles, contains five role cards, lacks `body.landing-page`, and does not contain the approved copy or orbit label.

- [ ] **Step 3: Replace `index.html` with the approved semantic structure**

Replace the current body content while retaining the existing document metadata and asset release key. The complete result should be:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta
    name="description"
    content="Lumi5 Labs connects promising businesses with investors through focused discovery and meaningful conversations."
  />
  <title>Lumi5 Labs – Focused Investment Connections</title>
  <link rel="stylesheet" href="css/style.css?v=20260727.1" />
</head>
<body class="landing-page">
  <header class="landing-header">
    <nav class="landing-nav" aria-label="Primary navigation">
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
      <div class="landing-nav-actions">
        <a class="landing-nav-link" href="signin.html">Sign in</a>
        <a class="landing-nav-link landing-nav-link--primary" href="signup.html">
          Sign up
        </a>
      </div>
    </nav>
  </header>

  <main>
    <section class="landing-hero" aria-labelledby="landing-title">
      <div class="landing-hero-copy">
        <p class="landing-eyebrow">Focused investment connections</p>
        <h1 id="landing-title" class="landing-title">
          Funding, found <span>with focus.</span>
        </h1>
        <p class="landing-summary">
          Connect promising businesses with investors who understand their
          potential—through clearer discovery and meaningful conversations.
        </p>
        <div class="landing-actions" aria-label="Choose how to begin">
          <a
            class="landing-cta landing-cta--primary"
            href="signup.html?role=business_owner"
          >
            Raise capital <span aria-hidden="true">→</span>
          </a>
          <a
            class="landing-cta landing-cta--secondary"
            href="signup.html?role=investor"
          >
            Explore opportunities
          </a>
        </div>
        <p class="landing-support">
          <span class="landing-support-avatars" aria-hidden="true">
            <span>B</span><span>I</span><span>✦</span>
          </span>
          Built for ambitious businesses and thoughtful investors
        </p>
      </div>

      <div
        class="landing-orbit-card"
        role="img"
        aria-label="Lumi5 Labs connects businesses and investors around shared sector, stage, geography, and capital priorities."
      >
        <div class="landing-orbit-heading" aria-hidden="true">
          <span>Focused connections</span>
          <span class="landing-orbit-status">Aligned</span>
        </div>
        <div class="landing-orbit-art" aria-hidden="true">
          <div class="landing-orbit-ring">
            <span class="landing-orbit-core">✦</span>
            <span class="landing-orbit-chip landing-orbit-chip--sector">
              HealthTech
            </span>
            <span class="landing-orbit-chip landing-orbit-chip--stage">
              Series A
            </span>
            <span class="landing-orbit-chip landing-orbit-chip--capital">
              Strategic capital
            </span>
            <span class="landing-orbit-chip landing-orbit-chip--market">
              Southeast Asia
            </span>
            <span class="landing-orbit-dot landing-orbit-dot--one"></span>
            <span class="landing-orbit-dot landing-orbit-dot--two"></span>
            <span class="landing-orbit-dot landing-orbit-dot--three"></span>
          </div>
        </div>
      </div>
    </section>

    <section class="landing-trust" aria-label="Platform qualities">
      <ul class="landing-trust-grid">
        <li><span aria-hidden="true">✓</span> Reviewed opportunities</li>
        <li><span aria-hidden="true">↗</span> Relevant introductions</li>
        <li><span aria-hidden="true">◌</span> Focused conversations</li>
      </ul>
    </section>

    <section class="landing-audiences" aria-labelledby="audience-title">
      <div class="landing-section-heading">
        <p class="landing-section-kicker">Choose your path</p>
        <h2 id="audience-title">One platform, two ambitions</h2>
        <p>
          Whether you are building what comes next or investing in it,
          Lumi5 Labs helps you reach the right people.
        </p>
      </div>
      <div class="landing-audience-grid">
        <article class="landing-audience-card landing-audience-card--business">
          <span class="landing-audience-icon" aria-hidden="true">↗</span>
          <h3>For business owners</h3>
          <p>
            Showcase your company, present your opportunity clearly and connect
            with investors aligned to your ambitions.
          </p>
          <a href="signup.html?role=business_owner">
            Start raising <span aria-hidden="true">→</span>
          </a>
        </article>
        <article class="landing-audience-card landing-audience-card--investor">
          <span class="landing-audience-icon" aria-hidden="true">◎</span>
          <h3>For investors</h3>
          <p>
            Discover reviewed businesses, evaluate relevant opportunities and
            express interest with confidence.
          </p>
          <a href="signup.html?role=investor">
            Start exploring <span aria-hidden="true">→</span>
          </a>
        </article>
      </div>
    </section>

    <section class="landing-process" aria-labelledby="process-title">
      <div class="landing-section-heading">
        <p class="landing-section-kicker">A focused journey</p>
        <h2 id="process-title">A clearer path to the right connection</h2>
      </div>
      <ol class="landing-steps-grid">
        <li>
          <span class="landing-step-number">01</span>
          <h3>Build or browse</h3>
          <p>
            Present your business or explore opportunities matched to your
            interests.
          </p>
        </li>
        <li>
          <span class="landing-step-number">02</span>
          <h3>Signal interest</h3>
          <p>
            Move promising opportunities forward with a clear expression of
            interest.
          </p>
        </li>
        <li>
          <span class="landing-step-number">03</span>
          <h3>Start a conversation</h3>
          <p>
            Connect in one focused space and build the relationship from there.
          </p>
        </li>
      </ol>
    </section>

    <section class="landing-final-cta" aria-labelledby="final-cta-title">
      <h2 id="final-cta-title">Find your next meaningful connection.</h2>
      <p>Join Lumi5 Labs and take the next step with greater focus.</p>
      <a class="landing-cta landing-cta--light" href="signup.html">
        Sign up <span aria-hidden="true">→</span>
      </a>
    </section>
  </main>

  <footer class="landing-footer">
    <span>Lumi5 Labs</span>
    <span>Focused investment connections</span>
  </footer>

  <script src="js/script.js?v=20260727.1"></script>
</body>
</html>
```

- [ ] **Step 4: Run the focused contract test and verify GREEN**

Run:

```bash
node --test backend/test/frontend-flow-contract.test.js
```

Expected: PASS. The static homepage contract sees only the two public journeys, the approved copy, the exact routes, one `h1`, semantic main/footer elements, and the orbit accessibility label.

- [ ] **Step 5: Review and commit the semantic homepage**

Run:

```bash
git diff --check
git diff -- index.html backend/test/frontend-flow-contract.test.js
git status --short
```

Expected: no whitespace errors; only `index.html` and `backend/test/frontend-flow-contract.test.js` are modified beyond the committed spec and plan.

Commit:

```bash
git add index.html backend/test/frontend-flow-contract.test.js
git commit -m "feat(index): replace internal role selector with public journeys"
```

---

### Task 2: Scoped visual system, responsive layout, and final acceptance

**Files:**
- Modify: `backend/test/frontend-flow-contract.test.js`
- Modify: `css/style.css:540-800`

**Interfaces:**
- Consumes: the `landing-*` class hooks and `body.landing-page` scope produced by Task 1.
- Produces: the approved light Dual Journey + Connection Orbit presentation at desktop, tablet, and mobile breakpoints.

- [ ] **Step 1: Add the failing landing layout contract**

Add after the Task 1 homepage tests:

```js
test('homepage styles are scoped and follow the approved breakpoints', () => {
  const css = read('css/style.css');

  assert.match(
    css,
    /body\.landing-page\s*\{[^}]*overflow-x:\s*hidden/s,
  );
  assert.match(
    css,
    /\.landing-page \.landing-hero\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1\.05fr\)\s+minmax\(280px,\s*0\.95fr\)/s,
  );
  assert.match(
    css,
    /\.landing-page \.landing-orbit-card\s*\{[^}]*overflow:\s*hidden/s,
  );
  assert.match(
    css,
    /@media \(max-width:\s*899px\)[\s\S]*?\.landing-page \.landing-hero\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
  );
  assert.match(
    css,
    /@media \(max-width:\s*899px\)[\s\S]*?\.landing-page \.landing-audience-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
  );
  assert.match(
    css,
    /@media \(max-width:\s*599px\)[\s\S]*?\.landing-page \.landing-trust-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
  );
  assert.match(
    css,
    /@media \(max-width:\s*599px\)[\s\S]*?\.landing-page \.landing-steps-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
  );
  assert.match(
    css,
    /\.landing-page [^{]*:focus-visible\s*\{[^}]*outline:/s,
  );
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)/);
});
```

- [ ] **Step 2: Run the focused contract test and verify RED**

Run:

```bash
node --test backend/test/frontend-flow-contract.test.js
```

Expected: FAIL because the old `.hero`, `.roles-grid`, and `.role-card` rules still exist and the new scoped landing selectors and approved breakpoints do not.

- [ ] **Step 3: Replace the old landing-page CSS block**

Replace everything from `/* LANDING PAGE */` through the final `.role-btn--navy` rule immediately before `/* ADMIN PAGES */` with:

```css
/* LANDING PAGE */
body.landing-page {
  overflow-x: hidden;
  background: #FFFFFF;
  color: #12192B;
}

.landing-page .landing-header {
  position: sticky;
  top: 0;
  z-index: 30;
  background: rgba(255, 255, 255, 0.96);
  border-bottom: 1px solid rgba(18, 25, 43, 0.08);
  backdrop-filter: blur(14px);
}

.landing-page .landing-nav {
  width: min(1180px, 100%);
  min-height: 72px;
  margin: 0 auto;
  padding: 0 32px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
}

.landing-page .landing-brand {
  display: inline-flex;
  align-items: center;
  gap: 11px;
  color: #12192B;
  font-size: 17px;
  font-weight: 800;
  letter-spacing: -0.02em;
  text-decoration: none;
}

.landing-page .landing-brand-mark {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border-radius: 11px;
  color: #FFFFFF;
  background: linear-gradient(135deg, #5558DE, #806DE9);
  box-shadow: 0 9px 20px rgba(84, 87, 221, 0.24);
}

.landing-page .landing-nav-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.landing-page .landing-nav-link {
  min-height: 44px;
  padding: 0 15px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  color: #4F586D;
  font-size: 14px;
  font-weight: 700;
  text-decoration: none;
}

.landing-page .landing-nav-link--primary {
  color: #FFFFFF;
  background: #5558DE;
  box-shadow: 0 8px 18px rgba(84, 87, 221, 0.18);
}

.landing-page .landing-hero {
  min-height: 540px;
  padding: 72px max(32px, calc((100vw - 1120px) / 2)) 66px;
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(280px, 0.95fr);
  align-items: center;
  gap: clamp(36px, 6vw, 76px);
  background:
    radial-gradient(circle at 88% 9%, rgba(113, 102, 232, 0.17), transparent 34%),
    linear-gradient(180deg, #FBFBFE 0%, #F4F5FA 100%);
}

.landing-page .landing-hero-copy {
  min-width: 0;
}

.landing-page .landing-eyebrow,
.landing-page .landing-section-kicker {
  color: #5557D8;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}

.landing-page .landing-eyebrow {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-bottom: 20px;
}

.landing-page .landing-eyebrow::before {
  content: "";
  width: 26px;
  height: 2px;
  background: currentColor;
}

.landing-page .landing-title {
  max-width: 650px;
  color: #12192B;
  font-size: clamp(3rem, 6vw, 5rem);
  font-weight: 850;
  line-height: 0.98;
  letter-spacing: -0.06em;
}

.landing-page .landing-title span {
  display: block;
  color: #5759DD;
}

.landing-page .landing-summary {
  max-width: 570px;
  margin-top: 24px;
  color: #636C7E;
  font-size: 17px;
  line-height: 1.72;
}

.landing-page .landing-actions {
  margin-top: 30px;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.landing-page .landing-cta {
  min-height: 48px;
  padding: 0 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  border: 1px solid transparent;
  border-radius: 11px;
  font-size: 14px;
  font-weight: 800;
  text-decoration: none;
  transition: transform 160ms ease, box-shadow 160ms ease, background 160ms ease;
}

.landing-page .landing-cta--primary {
  color: #FFFFFF;
  background: #5558DE;
  box-shadow: 0 11px 24px rgba(84, 87, 221, 0.21);
}

.landing-page .landing-cta--secondary {
  color: #273048;
  background: #FFFFFF;
  border-color: #DBDFE8;
}

.landing-page .landing-cta--light {
  color: #4E50D0;
  background: #FFFFFF;
}

.landing-page .landing-support {
  margin-top: 24px;
  display: flex;
  align-items: center;
  gap: 13px;
  color: #737B8D;
  font-size: 12px;
  font-weight: 650;
}

.landing-page .landing-support-avatars {
  display: flex;
  padding-left: 7px;
}

.landing-page .landing-support-avatars span {
  width: 27px;
  height: 27px;
  margin-left: -7px;
  display: grid;
  place-items: center;
  border: 2px solid #F5F6FA;
  border-radius: 50%;
  color: #FFFFFF;
  background: #5685D9;
  font-size: 8px;
  font-weight: 900;
}

.landing-page .landing-support-avatars span:nth-child(2) {
  background: #48A576;
}

.landing-page .landing-support-avatars span:nth-child(3) {
  background: #806EE1;
}

.landing-page .landing-orbit-card {
  min-width: 0;
  min-height: 390px;
  position: relative;
  overflow: hidden;
  border: 1px solid rgba(212, 214, 232, 0.88);
  border-radius: 28px;
  background:
    radial-gradient(circle at 50% 52%, rgba(96, 91, 221, 0.16), transparent 35%),
    rgba(255, 255, 255, 0.76);
  box-shadow: 0 26px 58px rgba(29, 34, 72, 0.12);
}

.landing-page .landing-orbit-heading {
  position: absolute;
  top: 22px;
  left: 24px;
  right: 24px;
  z-index: 4;
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: #596277;
  font-size: 12px;
  font-weight: 800;
}

.landing-page .landing-orbit-status {
  padding: 7px 10px;
  border-radius: 999px;
  color: #267D58;
  background: #EAF8F1;
  font-size: 9px;
  letter-spacing: 0.07em;
  text-transform: uppercase;
}

.landing-page .landing-orbit-art {
  min-height: 390px;
  display: grid;
  place-items: center;
  padding-top: 32px;
}

.landing-page .landing-orbit-ring {
  width: min(280px, calc(100% - 84px));
  aspect-ratio: 1;
  position: relative;
  border: 1px solid rgba(91, 91, 218, 0.24);
  border-radius: 50%;
}

.landing-page .landing-orbit-ring::before {
  content: "";
  position: absolute;
  inset: 44px;
  border: 1px dashed rgba(91, 91, 218, 0.30);
  border-radius: 50%;
}

.landing-page .landing-orbit-core {
  position: absolute;
  left: 50%;
  top: 50%;
  z-index: 2;
  width: 82px;
  height: 82px;
  display: grid;
  place-items: center;
  transform: translate(-50%, -50%);
  border-radius: 26px;
  color: #FFFFFF;
  background: linear-gradient(135deg, #5558DD, #846EE6);
  box-shadow: 0 19px 38px rgba(81, 83, 209, 0.30);
  font-size: 30px;
}

.landing-page .landing-orbit-chip {
  position: absolute;
  z-index: 3;
  padding: 9px 12px;
  border: 1px solid #DFE1EB;
  border-radius: 11px;
  color: #424B60;
  background: rgba(255, 255, 255, 0.97);
  box-shadow: 0 10px 22px rgba(37, 42, 75, 0.10);
  font-size: 10px;
  font-weight: 800;
  white-space: nowrap;
}

.landing-page .landing-orbit-chip--sector {
  left: -18px;
  top: 45px;
}

.landing-page .landing-orbit-chip--stage {
  right: -18px;
  top: 52px;
}

.landing-page .landing-orbit-chip--capital {
  right: -24px;
  bottom: 43px;
}

.landing-page .landing-orbit-chip--market {
  left: -25px;
  bottom: 39px;
}

.landing-page .landing-orbit-dot {
  position: absolute;
  width: 13px;
  height: 13px;
  border: 3px solid #FFFFFF;
  border-radius: 50%;
  background: #51AA7D;
  box-shadow: 0 4px 9px rgba(27, 83, 57, 0.25);
  animation: landing-orbit-pulse 3.6s ease-in-out infinite;
}

.landing-page .landing-orbit-dot--one {
  top: 12px;
  left: calc(50% - 6px);
}

.landing-page .landing-orbit-dot--two {
  right: 10px;
  top: calc(50% - 6px);
  background: #6E72E5;
  animation-delay: 600ms;
}

.landing-page .landing-orbit-dot--three {
  bottom: 13px;
  left: calc(50% - 6px);
  background: #4D8DE0;
  animation-delay: 1200ms;
}

@keyframes landing-orbit-pulse {
  0%,
  100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.18);
  }
}

.landing-page .landing-trust {
  background: #FFFFFF;
  border-top: 1px solid #E7E9F0;
  border-bottom: 1px solid #E7E9F0;
}

.landing-page .landing-trust-grid {
  width: min(1040px, 100%);
  margin: 0 auto;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  list-style: none;
}

.landing-page .landing-trust-grid li {
  min-height: 76px;
  padding: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: #5F6779;
  font-size: 13px;
  font-weight: 750;
  text-align: center;
}

.landing-page .landing-trust-grid li + li {
  border-left: 1px solid #E7E9F0;
}

.landing-page .landing-trust-grid li span {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  border-radius: 9px;
  color: #347F5D;
  background: #ECF8F2;
}

.landing-page .landing-audiences,
.landing-page .landing-process {
  padding: 84px 32px;
}

.landing-page .landing-audiences {
  background: #FFFFFF;
}

.landing-page .landing-process {
  background: #F5F6FA;
}

.landing-page .landing-section-heading {
  max-width: 620px;
  margin: 0 auto 38px;
  text-align: center;
}

.landing-page .landing-section-heading h2 {
  margin-top: 10px;
  color: #151B2D;
  font-size: clamp(2rem, 4vw, 2.75rem);
  letter-spacing: -0.045em;
}

.landing-page .landing-section-heading > p:last-child {
  margin-top: 12px;
  color: #70798B;
  font-size: 15px;
  line-height: 1.65;
}

.landing-page .landing-audience-grid,
.landing-page .landing-steps-grid {
  width: min(980px, 100%);
  margin: 0 auto;
  display: grid;
  gap: 22px;
}

.landing-page .landing-audience-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.landing-page .landing-audience-card {
  min-width: 0;
  min-height: 230px;
  padding: 32px;
  border: 1px solid #E0E3EC;
  border-radius: 20px;
}

.landing-page .landing-audience-card--business {
  background: linear-gradient(140deg, #F8FAFF, #EEF4FF);
}

.landing-page .landing-audience-card--investor {
  background: linear-gradient(140deg, #F7FCF9, #EDF8F2);
}

.landing-page .landing-audience-icon {
  width: 43px;
  height: 43px;
  margin-bottom: 24px;
  display: grid;
  place-items: center;
  border-radius: 12px;
  color: #FFFFFF;
  background: #5283DE;
  box-shadow: 0 9px 19px rgba(62, 106, 190, 0.20);
  font-size: 17px;
}

.landing-page .landing-audience-card--investor .landing-audience-icon {
  background: #45A172;
  box-shadow: 0 9px 19px rgba(45, 129, 88, 0.19);
}

.landing-page .landing-audience-card h3,
.landing-page .landing-steps-grid h3 {
  color: #1A2134;
  font-size: 20px;
}

.landing-page .landing-audience-card p {
  margin-top: 10px;
  color: #697286;
  font-size: 14px;
  line-height: 1.65;
}

.landing-page .landing-audience-card a {
  margin-top: 20px;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: #4E51D1;
  font-size: 14px;
  font-weight: 800;
  text-decoration: none;
}

.landing-page .landing-audience-card--investor a {
  color: #287E58;
}

.landing-page .landing-steps-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  list-style: none;
}

.landing-page .landing-steps-grid li {
  min-width: 0;
  padding: 29px;
  border: 1px solid #E0E3EB;
  border-radius: 18px;
  background: #FFFFFF;
}

.landing-page .landing-step-number {
  color: #5A5CDC;
  font-size: 12px;
  font-weight: 900;
}

.landing-page .landing-steps-grid h3 {
  margin-top: 18px;
}

.landing-page .landing-steps-grid p {
  margin-top: 9px;
  color: #70798A;
  font-size: 13px;
  line-height: 1.6;
}

.landing-page .landing-final-cta {
  width: min(1060px, calc(100% - 64px));
  margin: 76px auto;
  padding: 60px 32px;
  border-radius: 26px;
  color: #FFFFFF;
  text-align: center;
  background:
    radial-gradient(circle at 82% 10%, rgba(255, 255, 255, 0.15), transparent 33%),
    linear-gradient(135deg, #5052CE, #6B5DD7);
}

.landing-page .landing-final-cta h2 {
  font-size: clamp(2rem, 4vw, 2.8rem);
  letter-spacing: -0.045em;
}

.landing-page .landing-final-cta p {
  margin: 12px auto 24px;
  color: rgba(255, 255, 255, 0.78);
  font-size: 15px;
}

.landing-page .landing-footer {
  min-height: 74px;
  padding: 0 max(32px, calc((100vw - 1120px) / 2));
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  border-top: 1px solid #E7E9EF;
  color: #747D8E;
  background: #FFFFFF;
  font-size: 12px;
}

.landing-page .landing-nav-link:hover,
.landing-page .landing-cta:hover {
  transform: translateY(-2px);
}

.landing-page .landing-audience-card a:hover {
  text-decoration: underline;
}

.landing-page .landing-brand:focus-visible,
.landing-page .landing-nav-link:focus-visible,
.landing-page .landing-cta:focus-visible,
.landing-page .landing-audience-card a:focus-visible {
  outline: 3px solid rgba(67, 97, 238, 0.38);
  outline-offset: 3px;
}

@media (max-width: 899px) {
  .landing-page .landing-hero {
    padding: 58px 32px;
    grid-template-columns: minmax(0, 1fr);
  }

  .landing-page .landing-hero-copy {
    max-width: 680px;
  }

  .landing-page .landing-orbit-card {
    width: min(560px, 100%);
  }

  .landing-page .landing-audience-grid {
    grid-template-columns: minmax(0, 1fr);
    max-width: 680px;
  }
}

@media (max-width: 599px) {
  .landing-page .landing-nav {
    min-height: 66px;
    padding: 0 16px;
    gap: 12px;
  }

  .landing-page .landing-brand {
    gap: 8px;
    font-size: 15px;
  }

  .landing-page .landing-brand-mark {
    width: 32px;
    height: 32px;
  }

  .landing-page .landing-nav-actions {
    gap: 4px;
  }

  .landing-page .landing-nav-link {
    padding: 0 10px;
    font-size: 13px;
  }

  .landing-page .landing-hero {
    padding: 46px 18px;
  }

  .landing-page .landing-title {
    font-size: clamp(2.65rem, 14vw, 3.8rem);
  }

  .landing-page .landing-summary {
    font-size: 15px;
  }

  .landing-page .landing-actions {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
  }

  .landing-page .landing-cta {
    width: 100%;
  }

  .landing-page .landing-support {
    align-items: flex-start;
    line-height: 1.45;
  }

  .landing-page .landing-orbit-card,
  .landing-page .landing-orbit-art {
    min-height: 330px;
  }

  .landing-page .landing-orbit-heading {
    top: 18px;
    left: 18px;
    right: 18px;
  }

  .landing-page .landing-orbit-ring {
    width: min(235px, calc(100% - 68px));
  }

  .landing-page .landing-orbit-ring::before {
    inset: 36px;
  }

  .landing-page .landing-orbit-core {
    width: 68px;
    height: 68px;
    border-radius: 22px;
    font-size: 25px;
  }

  .landing-page .landing-orbit-chip {
    padding: 7px 8px;
    font-size: 8px;
  }

  .landing-page .landing-orbit-chip--sector {
    left: -16px;
  }

  .landing-page .landing-orbit-chip--stage {
    right: -14px;
  }

  .landing-page .landing-orbit-chip--capital {
    right: -19px;
  }

  .landing-page .landing-orbit-chip--market {
    left: -19px;
  }

  .landing-page .landing-trust-grid,
  .landing-page .landing-steps-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .landing-page .landing-trust-grid li + li {
    border-top: 1px solid #E7E9F0;
    border-left: 0;
  }

  .landing-page .landing-audiences,
  .landing-page .landing-process {
    padding: 62px 18px;
  }

  .landing-page .landing-audience-card,
  .landing-page .landing-steps-grid li {
    padding: 25px;
  }

  .landing-page .landing-final-cta {
    width: calc(100% - 36px);
    margin: 52px auto;
    padding: 44px 22px;
  }

  .landing-page .landing-footer {
    min-height: 92px;
    padding: 22px 18px;
    flex-direction: column;
    align-items: flex-start;
    justify-content: center;
    gap: 6px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .landing-page *,
  .landing-page *::before,
  .landing-page *::after {
    scroll-behavior: auto !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

- [ ] **Step 4: Run focused and full automated verification**

Run:

```bash
node --test backend/test/frontend-flow-contract.test.js
npm --prefix backend test
git diff --check
```

Expected: the focused contract passes, the complete backend suite passes, and `git diff --check` emits no output.

- [ ] **Step 5: Perform the signed-out visual browser walkthrough**

Serve the repository root locally:

```bash
python3 -m http.server 4173
```

Open `http://127.0.0.1:4173/index.html` and verify:

- At 1440 by 900 pixels, the hero is two columns and the orbit labels do not overlap or clip.
- At 768 pixels wide, the hero and audience cards are one column while trust items and explanatory steps remain three columns.
- At 390 by 844 pixels, the complete page has no horizontal overflow:

```js
document.documentElement.scrollWidth === document.documentElement.clientWidth
```

- `document.body.innerText` contains no internal staff-role name.
- Tab order is logo, Sign in, Sign up, Raise capital, Explore opportunities, Start raising, Start exploring, and final Sign up.
- Every focused link has a visible focus ring.
- Each call to action has the exact destination required by the global constraints.
- Reduced-motion emulation stops the orbit-dot pulse.
- The browser console contains no warnings or errors introduced by the page.

- [ ] **Step 6: Review the complete scoped diff**

Run:

```bash
git diff -- index.html css/style.css backend/test/frontend-flow-contract.test.js
git status --short
```

Expected: only the two index-page production files and the focused contract test are modified beyond the committed design and plan documents. `js/script.js`, dashboards, messaging, backend routes, and database files are unchanged.

- [ ] **Step 7: Commit the completed homepage**

```bash
git add index.html css/style.css backend/test/frontend-flow-contract.test.js
git commit -m "style(index): launch public investment homepage"
```

- [ ] **Step 8: Re-run post-commit verification**

Run:

```bash
npm --prefix backend test
git diff HEAD^ --check
git status --short --branch
```

Expected: the complete test suite passes, the committed diff has no whitespace errors, and the working tree is clean.
