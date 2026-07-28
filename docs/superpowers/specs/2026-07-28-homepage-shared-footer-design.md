# Homepage Shared Footer Design

## Goal

Replace the homepage's minimal two-line footer with the complete footer already
used by `about.html` and `contact.html`. All three public pages must present the
same footer content and desktop layout.

## Scope

The homepage footer will include:

- the Lumi5 Labs description;
- Home, About, and Contact navigation;
- the office address, email address, and telephone number;
- LinkedIn, Instagram, Bluesky, and Facebook links;
- the copyright notice and release version.

The work is limited to the homepage footer markup, shared footer styling, and
the tests that enforce this public-page contract. Page content, navigation
headers, backend behavior, database behavior, and mobile-specific redesign are
out of scope.

## Implementation Approach

Copy the existing `public-footer` markup from `about.html` into `index.html`.
The copied markup remains the canonical footer structure already shared by the
About and Contact pages.

Extend the existing `.public-content-page .public-footer...` CSS selectors so
that the same declarations also apply on `.landing-page`. This reuses one
visual contract instead of duplicating the declarations under homepage-only
class names.

Once the new footer is covered by the shared selectors, remove the obsolete
homepage-only `.landing-footer` rules. No other landing-page section styles are
changed.

## Testing

Add a structural regression test that parses `index.html`, `about.html`, and
`contact.html` and requires each footer to expose the same:

- navigation links;
- contact links;
- social links;
- descriptive copy;
- copyright and version text.

The test must fail against the current minimal homepage footer before
production markup changes are made. Existing footer CSS, homepage layout,
accessibility, asset-release, and complete backend test suites must remain
green.

## Release

If deployment is authorized after implementation:

1. bump the shared frontend cache key so the revised CSS is fetched;
2. push the verified commit to GitHub `main`;
3. back up the affected live frontend files;
4. deploy only runtime files in the manifest;
5. verify deployed hashes, public HTTP responses, and the shared footer
   contract.

No backend service, environment file, upload, or database change is required.
