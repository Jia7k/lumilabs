# Site-Wide Lumi5 Logo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build production assets for the approved Balanced `{;}` mark and replace the legacy brand glyph on all 17 Lumi5 pages, browser favicons, and the Apple home-screen icon.

**Architecture:** A transparent, deterministic SVG is the canonical mark. Every page references that one SVG from its existing brand link, while generated PNG/ICO derivatives cover raster and platform-icon use; an exact deployment manifest and a dedicated branding contract keep the integration complete.

**Tech Stack:** Static HTML5, CSS, SVG, Python 3 with Pillow for deterministic raster derivatives, Node.js `node:test`, existing deployment-manifest tooling, in-app browser

## Global Constraints

- Use exact solid brand purple `#6B4EE6`.
- Preserve one mirrored pair of braces, one true circular semicolon dot, and one filled Bézier semicolon tail.
- Do not use fonts, filters, gradients, masks, embedded rasters, scripts, external URLs, animation, or white-matted preview pixels in the canonical SVG.
- Preserve every visible `Lumi5 Labs` wordmark, current brand-link destination, accessible name, wrapper dimension, focus indicator, and surrounding navigation layout.
- Replace branding on exactly the 17 root HTML pages.
- Preserve the non-brand `ti-trending-up` readiness-stat icon in `businessownerdashboard.html`.
- Public and protected light headers show the purple mark directly; sign-in and sign-up keep their existing white tile on the dark story panel.
- Add `images/lumi5-mark.svg`, `images/lumi5-mark-1024.png`, `favicon.svg`, `favicon-32x32.png`, `favicon.ico`, and `apple-touch-icon.png`.
- Do not add a web manifest or Open Graph image.
- Use frontend release key `20260728.8` for every local CSS and JavaScript reference after shared logo CSS changes.
- Do not push Git or deploy through SFTP without a separate explicit request.

---

### Task 1: Production Asset Contract and Generated Files

**Files:**
- Create: `backend/test/logo-branding.test.js`
- Create: `images/lumi5-mark.svg`
- Create: `images/lumi5-mark-1024.png`
- Create: `favicon.svg`
- Create: `favicon-32x32.png`
- Create: `favicon.ico`
- Create: `apple-touch-icon.png`
- Modify: `backend/deploy/runtime-manifest.txt`
- Modify: `backend/test/messages-deployment-files.test.js`

**Interfaces:**
- Consumes: Approved Balanced geometry and `#6B4EE6`.
- Produces: `images/lumi5-mark.svg` as the canonical public mark; five deterministic derivatives; manifest entries consumed by page integration and deployment checks.

- [ ] **Step 1: Write failing production-asset tests**

Create `backend/test/logo-branding.test.js` with repository-relative readers,
PNG/ICO header parsers, and these exact contracts:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = (relative) => fs.readFileSync(path.join(root, relative));

function pngMetadata(relative) {
  const source = read(relative);
  assert.deepEqual([...source.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(source.toString('ascii', 12, 16), 'IHDR');
  return {
    width: source.readUInt32BE(16),
    height: source.readUInt32BE(20),
    bitDepth: source[24],
    colorType: source[25],
  };
}

function icoSizes(relative) {
  const source = read(relative);
  assert.equal(source.readUInt16LE(0), 0);
  assert.equal(source.readUInt16LE(2), 1);
  const count = source.readUInt16LE(4);
  return Array.from({ length: count }, (_, index) => {
    const offset = 6 + (index * 16);
    const width = source[offset] || 256;
    const height = source[offset + 1] || 256;
    return `${width}x${height}`;
  }).sort();
}

test('canonical Lumi5 mark is a safe flat-purple vector', () => {
  const source = read('images/lumi5-mark.svg').toString('utf8');
  assert.match(source, /<svg[^>]*viewBox="0 0 100 100"/);
  assert.equal((source.match(/fill="#6B4EE6"/g) || []).length, 4);
  assert.equal((source.match(/<(?:path|circle)\b/g) || []).length, 4);
  assert.doesNotMatch(
    source,
    /<(?:script|image|foreignObject|linearGradient|radialGradient|filter|mask)\b|(?:href|xlink:href)=|<style\b|\bstroke=/i,
  );
});

test('Lumi5 raster and platform icons have exact production formats', () => {
  assert.deepEqual(
    pngMetadata('images/lumi5-mark-1024.png'),
    { width: 1024, height: 1024, bitDepth: 8, colorType: 6 },
  );
  assert.deepEqual(
    pngMetadata('favicon-32x32.png'),
    { width: 32, height: 32, bitDepth: 8, colorType: 2 },
  );
  assert.deepEqual(
    pngMetadata('apple-touch-icon.png'),
    { width: 180, height: 180, bitDepth: 8, colorType: 2 },
  );
  assert.deepEqual(icoSizes('favicon.ico'), ['16x16', '32x32', '48x48']);

  const favicon = read('favicon.svg').toString('utf8');
  assert.match(favicon, /<svg[^>]*viewBox="10 10 80 80"/);
  assert.match(favicon, /fill="#FFFFFF"/);
  assert.match(favicon, /fill="#6B4EE6"/);
  assert.doesNotMatch(favicon, /<(?:script|image|foreignObject|filter)\b|https?:\/\//i);
});
```

- [ ] **Step 2: Run the asset tests to verify they fail**

Run:

```bash
cd backend
node --test test/logo-branding.test.js
```

Expected: FAIL with `ENOENT` for `images/lumi5-mark.svg`.

- [ ] **Step 3: Generate the canonical geometry and derivatives**

Use one local Python/Pillow generation pass. The geometry is exact and shared by
SVG and raster output:

```python
PURPLE = "#6B4EE6"
CANVAS = (0.0, 0.0, 100.0, 100.0)
FAVICON_VIEWPORT = (10.0, 10.0, 90.0, 90.0)
BRACE_RADIUS = 5.4
BRACE_CENTERLINE = [
    ((39, 18), (31, 18), (26, 22), (26, 34)),
    ((26, 34), (26, 42), (23, 47), (21, 50)),
    ((21, 50), (23, 53), (26, 58), (26, 66)),
    ((26, 66), (26, 78), (31, 82), (39, 82)),
]
DOT = (50, 41, 6.2)
COMMA_SVG = (
    "M50 52 "
    "C54.4 52 57 55 57 59 "
    "C57 65 53.5 70.5 46 74.5 "
    "L43.5 70.5 "
    "C47.6 68.1 49.8 65.8 50.8 63 "
    "C50.5 63.1 50.2 63.1 50 63.1 "
    "C46.6 63.1 43.8 60.6 43.8 57.6 "
    "C43.8 54.5 46.5 52 50 52 Z"
)
```

Implementation details:

1. Sample each brace cubic at 24 equal `t` intervals.
2. Compute centred finite-difference tangents, their unit normals, and the two
   `5.4`-unit offsets.
3. Join the offsets with 16-point semicircular end caps and serialize the
   resulting polygon as one filled SVG path.
4. Mirror every left-brace polygon point using `x = 100 - x`.
5. Emit `images/lumi5-mark.svg` with exactly two brace paths, the dot circle,
   and the comma path, each with `fill="#6B4EE6"`.
6. Emit `favicon.svg` with `viewBox="10 10 80 80"`, one white rounded background
   rectangle, and the same four purple components.
7. Render SVG-equivalent sampled polygons with Pillow at four times the target
   resolution and downsample with `Image.Resampling.LANCZOS`.
8. Save `images/lumi5-mark-1024.png` as transparent `RGBA`.
9. Save 32- and 180-pixel favicon canvases as opaque white `RGB`.
10. Save `favicon.ico` from a 256-pixel opaque-white source with only
    `sizes=[(16, 16), (32, 32), (48, 48)]`.

The comma raster polygon must sample the same cubic segments in `COMMA_SVG`;
do not substitute a font glyph or reuse the generated preview PNG.

- [ ] **Step 4: Add every production asset to the exact runtime allowlist**

Insert these entries after the existing portrait images in both
`backend/deploy/runtime-manifest.txt` and `expectedRuntimeFiles` in
`backend/test/messages-deployment-files.test.js`:

```text
images/lumi5-mark.svg
images/lumi5-mark-1024.png
favicon.svg
favicon-32x32.png
favicon.ico
apple-touch-icon.png
```

- [ ] **Step 5: Run focused asset and manifest tests**

Run:

```bash
cd backend
node --test test/logo-branding.test.js test/messages-deployment-files.test.js
```

Expected: PASS with zero failures.

- [ ] **Step 6: Commit the production assets**

```bash
git add \
  backend/test/logo-branding.test.js \
  backend/test/messages-deployment-files.test.js \
  backend/deploy/runtime-manifest.txt \
  images/lumi5-mark.svg \
  images/lumi5-mark-1024.png \
  favicon.svg \
  favicon-32x32.png \
  favicon.ico \
  apple-touch-icon.png
git commit -m "feat(brand): add production Lumi5 logo assets"
```

### Task 2: Site-Wide Markup, Styling, and Cache Contract

**Files:**
- Modify: `index.html`
- Modify: `about.html`
- Modify: `contact.html`
- Modify: `signin.html`
- Modify: `signup.html`
- Modify: `assignments.html`
- Modify: `audit-logs.html`
- Modify: `browse.html`
- Modify: `businessownerdashboard.html`
- Modify: `createportfolio.html`
- Modify: `investordashboard.html`
- Modify: `messages.html`
- Modify: `moderatordashboard.html`
- Modify: `my-interests.html`
- Modify: `mybusinesses.html`
- Modify: `relationshipmanagerdashboard.html`
- Modify: `superadmindashboard.html`
- Modify: `css/style.css`
- Modify: `js/messages.js`
- Modify: `backend/test/logo-branding.test.js`
- Modify: `backend/test/frontend-flow-contract.test.js`
- Modify: `backend/test/public-content-pages.test.js`
- Modify: `backend/test/assignments-client.test.js`
- Modify: `backend/test/superadmin-client.test.js`
- Modify: `backend/test/messages-deployment-files.test.js`

**Interfaces:**
- Consumes: `images/lumi5-mark.svg` and the six manifest entries from Task 1.
- Produces: One accessible shared logo instance and four platform-icon links per page; release-key `20260728.8`; no legacy brand arrow.

- [ ] **Step 1: Add the failing 17-page branding contract**

Append a test that fixes the complete page set and preserved destinations:

```js
const PAGE_BRAND_HREFS = new Map([
  ['about.html', 'index.html'],
  ['assignments.html', 'index.html'],
  ['audit-logs.html', 'index.html'],
  ['browse.html', 'investordashboard.html'],
  ['businessownerdashboard.html', 'index.html'],
  ['contact.html', 'index.html'],
  ['createportfolio.html', 'index.html'],
  ['index.html', 'index.html'],
  ['investordashboard.html', 'investordashboard.html'],
  ['messages.html', 'index.html'],
  ['moderatordashboard.html', 'index.html'],
  ['my-interests.html', 'investordashboard.html'],
  ['mybusinesses.html', 'index.html'],
  ['relationshipmanagerdashboard.html', 'index.html'],
  ['signin.html', 'index.html'],
  ['signup.html', 'index.html'],
  ['superadmindashboard.html', 'index.html'],
]);

function attribute(tag, name) {
  return tag.match(new RegExp(`\\b${name}=["']([^"']*)["']`, 'i'))?.[1];
}

function brandAnchors(source) {
  return [...source.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)]
    .filter((match) => {
      const classes = attribute(match[1], 'class')?.split(/\s+/) || [];
      return classes.some((name) => ['landing-brand', 'auth-brand', 'nav-logo'].includes(name));
    });
}

test('all 17 pages use the approved accessible Lumi5 mark and platform icons', () => {
  assert.deepEqual(
    [...PAGE_BRAND_HREFS.keys()],
    fs.readdirSync(root).filter((name) => name.endsWith('.html')).sort(),
  );

  for (const [page, expectedHref] of PAGE_BRAND_HREFS) {
    const source = fs.readFileSync(path.join(root, page), 'utf8');
    const anchors = brandAnchors(source);
    assert.equal(anchors.length, 1, `${page}: one brand link`);
    assert.equal(attribute(anchors[0][1], 'href'), expectedHref, `${page}: preserved destination`);
    assert.match(anchors[0][2].replace(/<[^>]+>/g, ' '), /\bLumi5 Labs\b/);

    const images = [...anchors[0][2].matchAll(/<img\b[^>]*>/gi)].map((match) => match[0]);
    assert.equal(images.length, 1, `${page}: one mark image`);
    assert.equal(attribute(images[0], 'src'), 'images/lumi5-mark.svg');
    assert.equal(attribute(images[0], 'alt'), '');
    assert.equal(attribute(images[0], 'width'), '24');
    assert.equal(attribute(images[0], 'height'), '24');
    assert.doesNotMatch(anchors[0][2], /<svg\b|ti-trending-up/);

    for (const expected of [
      /<link\b[^>]*rel=["']icon["'][^>]*href=["']favicon\.ico["'][^>]*>/i,
      /<link\b[^>]*rel=["']icon["'][^>]*href=["']favicon\.svg["'][^>]*type=["']image\/svg\+xml["'][^>]*>/i,
      /<link\b[^>]*rel=["']icon["'][^>]*href=["']favicon-32x32\.png["'][^>]*sizes=["']32x32["'][^>]*>/i,
      /<link\b[^>]*rel=["']apple-touch-icon["'][^>]*href=["']apple-touch-icon\.png["'][^>]*>/i,
    ]) {
      assert.match(source, expected, `${page}: platform icon`);
    }
  }

  const business = fs.readFileSync(path.join(root, 'businessownerdashboard.html'), 'utf8');
  assert.equal((business.match(/ti ti-trending-up/g) || []).length, 1);
});
```

Also add a deployment test that validates local dependencies for every HTML
entry in the manifest, rather than only About and Contact:

```js
test('every deployed HTML page has all local dependencies in the manifest', () => {
  const manifest = new Set(readManifest());
  for (const page of [...manifest].filter((entry) => entry.endsWith('.html'))) {
    for (const dependency of localPageReferences(page)) {
      assert.ok(manifest.has(dependency), `${page}: missing ${dependency}`);
      const absolute = path.join(repositoryDir, ...dependency.split('/'));
      assert.equal(fs.existsSync(absolute) && fs.statSync(absolute).isFile(), true);
    }
  }
});
```

- [ ] **Step 2: Run the page contract to verify it fails**

Run:

```bash
cd backend
node --test test/logo-branding.test.js test/messages-deployment-files.test.js
```

Expected: FAIL because the pages still contain legacy inline/Tabler brand
glyphs and lack favicon links.

- [ ] **Step 3: Replace the brand child on all 17 pages**

Preserve each current anchor and wrapper class. Replace only the inner legacy
brand glyph with this exact decorative image:

```html
<img
  class="lumi5-logo-mark"
  src="images/lumi5-mark.svg"
  alt=""
  width="24"
  height="24"
/>
```

Keep the image inside the existing `aria-hidden="true"` wrapper. Add these four
links once in every page head, immediately after the `<title>`:

```html
<link rel="icon" href="favicon.ico" sizes="any" />
<link rel="icon" href="favicon.svg" type="image/svg+xml" />
<link rel="icon" href="favicon-32x32.png" type="image/png" sizes="32x32" />
<link rel="apple-touch-icon" href="apple-touch-icon.png" />
```

Do not replace the readiness-stat icon in `businessownerdashboard.html`.

- [ ] **Step 4: Normalize shared and local logo styles**

In `css/style.css`:

```css
.logo-icon {
  width: 30px;
  height: 30px;
  border-radius: 0;
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
}

.lumi5-logo-mark {
  width: 24px;
  height: 24px;
  display: block;
  flex: 0 0 auto;
}
```

Remove the public mark's purple gradient and shadow while retaining its
36-by-36 grid wrapper:

```css
.landing-page .landing-brand-mark,
.public-content-page .landing-brand-mark {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}
```

Keep `.auth-brand-mark` at 38-by-38 with its existing white background and
12-pixel radius. Ensure `.lumi5-logo-mark` remains 24-by-24 inside it.

Apply the same transparent 30-pixel logo-wrapper and 24-pixel image rules to
the local styles in:

- `browse.html`;
- `investordashboard.html`;
- `messages.html`; and
- `my-interests.html`.

- [ ] **Step 5: Move every local frontend asset reference to release `20260728.8`**

Update all HTML `css/` and `js/` query strings and
`MESSAGES_API_SCRIPT_SRC` in `js/messages.js` to `20260728.8`.

Update exact release-key expectations in:

- `backend/test/frontend-flow-contract.test.js`;
- `backend/test/public-content-pages.test.js`;
- `backend/test/assignments-client.test.js`; and
- `backend/test/superadmin-client.test.js`.

The coherent-release test must cover all local CSS and JavaScript references
without retaining `.4` or `.7` exceptions.

- [ ] **Step 6: Run the focused branding and frontend tests**

Run:

```bash
cd backend
node --test \
  test/logo-branding.test.js \
  test/frontend-flow-contract.test.js \
  test/public-content-pages.test.js \
  test/messages-deployment-files.test.js \
  test/assignments-client.test.js \
  test/superadmin-client.test.js
```

Expected: PASS with zero failures.

- [ ] **Step 7: Commit the site-wide integration**

```bash
git add \
  *.html \
  css/style.css \
  js/messages.js \
  backend/test/logo-branding.test.js \
  backend/test/frontend-flow-contract.test.js \
  backend/test/public-content-pages.test.js \
  backend/test/messages-deployment-files.test.js \
  backend/test/assignments-client.test.js \
  backend/test/superadmin-client.test.js
git commit -m "feat(brand): apply Lumi5 logo site-wide"
```

### Task 3: Full Regression and Visual Verification

**Files:**
- Verify: All files created or modified by Tasks 1 and 2
- Do not create: committed screenshots or temporary browser artifacts

**Interfaces:**
- Consumes: Production assets, 17 integrated pages, cache release `20260728.8`.
- Produces: Fresh automated and visual evidence that the replacement is complete and does not disturb page flow.

- [ ] **Step 1: Run static integrity gates**

Run:

```bash
git diff --check HEAD~2..HEAD
! rg -n '^(<<<<<<<|=======|>>>>>>>)' .
! rg -n '20260728\.[47]' --glob '*.html' --glob 'js/*.js' .
```

Expected: all commands exit zero and print no defect.

- [ ] **Step 2: Prove no legacy brand glyph remains**

Run a brand-scoped inspection through `backend/test/logo-branding.test.js`,
then use:

```bash
rg -n 'ti ti-trending-up|points="2,14 7,9 11,12 18,5"' --glob '*.html'
```

Expected: exactly one `ti ti-trending-up` remains, the readiness statistic in
`businessownerdashboard.html`; the old inline arrow path has zero matches.

- [ ] **Step 3: Run the complete automated suite**

Run:

```bash
cd backend
npm test
```

Expected: every test passes with zero failures, cancellations, or skips.

- [ ] **Step 4: Perform desktop visual smoke checks**

Serve the repository locally without JavaScript redirects affecting the
protected-page header, then inspect at 1440-by-900:

1. `index.html`: purple mark directly on the white public header.
2. `signin.html`: purple mark centred inside the existing white tile.
3. `businessownerdashboard.html`: purple mark directly on the white protected
   header and the separate readiness trend icon still visible.
4. Browser tab: the favicon is present and not the generic document icon.

For each page verify:

- the braces and semicolon remain distinct;
- the image is not stretched or clipped;
- `Lumi5 Labs` alignment is unchanged;
- there is no broken-image indicator;
- focus remains visible on the brand link; and
- the browser console has no asset errors.

- [ ] **Step 5: Record the final repository state**

Run:

```bash
git status --short --branch
git log -5 --oneline --decorate
```

Expected: a clean working tree on the implementation branch. Do not push or
deploy until the user explicitly requests publication.
