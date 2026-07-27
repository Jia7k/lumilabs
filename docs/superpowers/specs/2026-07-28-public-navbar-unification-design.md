# Public Navbar Unification Design

Date: 2026-07-28  
Status: Approved  
Scope: `index.html`, `about.html`, `contact.html`, shared public CSS, and their
frontend contract tests

## Goal

Make the desktop navigation on About and Contact match the homepage navigation.
Remove Portfolio, Blog, and FAQ from the public navigation and from the About
and Contact footer navigation.

## Approved direction

Use the homepage navbar structure on all three public pages. About and Contact
will no longer maintain a separate dark `public-header` desktop component.

The shared navbar contains, in order:

1. Lumi5 Labs brand linking to `index.html`
2. About
3. Contact
4. Sign in
5. Sign up

The brand is the Home affordance, so the navbar does not include a separate
Home text link. About and Contact may retain `aria-current="page"` on their own
link for accessibility without changing the homepage visual treatment.

## Markup and styling

- Copy the semantic homepage header and navbar structure into `about.html` and
  `contact.html`.
- Reuse the existing `landing-header`, `landing-nav`, `landing-brand`,
  `landing-page-links`, `landing-menu`, and `landing-nav-actions` component
  classes.
- Extend only the existing landing-header CSS selectors so the same component
  styles apply when the header is inside `.public-content-page`.
- Preserve the rest of the About and Contact layouts and their
  `.public-content-page` styling.
- Remove the obsolete About/Contact `public-header`, `public-brand`,
  `public-nav`, `public-auth-actions`, and `public-menu` markup.
- Do not introduce a JavaScript-injected header or another runtime dependency.

This change does not include a dedicated mobile redesign. The copied navbar may
continue to use the homepage component's existing compact menu behavior, but
mobile-specific visual refinement is outside this task.

## Link removal

Remove Portfolio, Blog, and FAQ from:

- the About desktop and compact navigation;
- the Contact desktop and compact navigation;
- the About footer `Navigate` section; and
- the Contact footer `Navigate` section.

The footer keeps Home, About, and Contact. Leadership personal-site and social
links are unrelated and remain unchanged.

## Cache and deployment behavior

Because the shared stylesheet and public markup change together, advance the
coherent frontend release key for all runtime HTML asset references and the
Messages API fallback. This prevents cached CSS from rendering the new header
with old selectors.

## Verification

Add or update frontend contracts to prove:

- Index, About, and Contact expose the same desktop navbar destinations and
  authentication actions.
- The brand on all three pages links to `index.html`.
- About and Contact no longer contain the obsolete public-header component.
- Portfolio, Blog, and FAQ do not appear in the public navbars or footer
  navigation.
- The release key remains coherent across runtime pages.
- Existing About content, Contact form behavior, accessibility contracts, and
  the full backend/frontend test suite remain green.

Perform a desktop visual check at the deployed public URLs. Mobile visual QA is
explicitly deferred.

## Out of scope

- Reworking protected role dashboards
- Changing Contact submission behavior
- Changing About or Contact body content
- Redesigning the public footer
- Dedicated mobile layout or visual adjustments
