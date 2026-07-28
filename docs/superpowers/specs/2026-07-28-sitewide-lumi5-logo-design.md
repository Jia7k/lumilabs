# Site-Wide Lumi5 Logo Integration Design

## Goal

Turn the approved option 1 Balanced `{;}` mark into production assets and
replace the legacy growth-arrow brand glyph consistently across the complete
Lumi5 website.

## Scope

The integration covers:

- the single brand link on each of the 17 root HTML pages;
- the browser-tab favicon;
- the 32-pixel fallback favicon;
- the multi-resolution ICO favicon;
- the Apple home-screen icon; and
- a transparent high-resolution PNG for non-vector use.

The visible `Lumi5 Labs` wordmark, home-link destinations, accessible names,
wrapper dimensions, and surrounding navigation layouts remain unchanged.
The `ti-trending-up` icon used by the business-owner readiness statistic is
not a brand mark and must remain unchanged.

## Canonical Mark

Create `images/lumi5-mark.svg` as the single canonical source:

- transparent SVG with a square view box;
- exact solid brand purple `#6B4EE6`;
- one curated brace mirrored horizontally for optical symmetry;
- one true circular semicolon dot;
- one dedicated filled Bézier semicolon tail;
- four filled components with no strokes, fonts, filters, gradients, masks,
  embedded rasters, scripts, external URLs, or animation; and
- enough internal padding to preserve the approved Balanced proportions while
  remaining readable at a 30-pixel navbar size.

Do not ship or colour-key the generated preview PNG. It is white-matted and
would create edge halos on transparent backgrounds.

Derive the following raster and favicon assets from the canonical vector:

- `images/lumi5-mark-1024.png`: 1024-by-1024 transparent RGBA;
- `favicon.svg`: favicon-specific tighter view box with the same geometry;
- `favicon-32x32.png`: 32-by-32 opaque white icon treatment;
- `favicon.ico`: 16-, 32-, and 48-pixel icon sizes; and
- `apple-touch-icon.png`: 180-by-180 opaque white icon treatment.

No web manifest or Open Graph image is required.

## Page Integration

Every page keeps its existing brand anchor and visible `Lumi5 Labs` text. The
legacy inline growth-arrow SVG or brand-only Tabler icon is replaced with a
decorative external image using:

- `src="images/lumi5-mark.svg"`;
- an empty `alt` attribute;
- explicit intrinsic width and height; and
- the existing `aria-hidden="true"` mark wrapper.

Public and authenticated light headers show the purple mark directly on their
white or transparent surface. Their existing 30- and 36-pixel wrapper boxes
remain, but purple backgrounds, gradients, and mark shadows are removed.

The sign-in and sign-up story panels retain their 38-pixel white rounded tile
because purple does not have sufficient contrast directly against the dark
indigo panel. The purple mark sits inside that tile.

The four pages with local navigation CSS—`browse.html`,
`investordashboard.html`, `messages.html`, and `my-interests.html`—receive the
same visual contract without introducing a new stylesheet.

Every HTML head includes the SVG favicon, ICO fallback, 32-pixel PNG, and Apple
touch icon links.

## Caching and Deployment

Because shared logo-wrapper CSS changes, all pages that load `css/style.css`
must use one new coherent stylesheet release key. Existing tests and direct
asset assertions must be updated to the same key.

Every new runtime asset must be added, in stable order, to:

- `backend/deploy/runtime-manifest.txt`; and
- the mirrored `expectedRuntimeFiles` array in
  `backend/test/messages-deployment-files.test.js`.

The implementation changes local repository files only. Git publication and
SFTP deployment require a separate explicit request.

## Accessibility

- The existing brand link remains the only interactive logo surface.
- Its accessible name remains `Lumi5 Labs` through the visible wordmark or
  existing `aria-label`.
- The image is decorative (`alt=""`) and remains inside an
  `aria-hidden="true"` wrapper.
- Explicit image dimensions prevent layout shifts.
- Existing focus indicators and 44-pixel link targets remain unchanged.

## Verification

Add a site-wide logo contract covering all 17 pages. It must prove:

- exactly one expected brand link exists per page;
- the link contains the shared `images/lumi5-mark.svg`;
- the image is decorative and has explicit dimensions;
- the visible `Lumi5 Labs` wordmark and existing home link remain;
- no legacy inline growth-arrow SVG or brand-only `ti-trending-up` remains
  inside the brand link; and
- the non-brand readiness trend icon still exists.

Add asset checks proving:

- the canonical SVG has the approved square view box and exact `#6B4EE6`;
- it contains no unsafe or disallowed SVG features;
- PNG files have the expected dimensions and colour modes;
- the ICO contains the expected icon sizes; and
- all local logo and favicon dependencies are included in the exact runtime
  manifest.

Run the focused logo, frontend, public-page, and deployment-manifest tests,
then run the complete backend test suite. Perform a desktop browser smoke on
the public, authentication, and protected header variants before any release.
