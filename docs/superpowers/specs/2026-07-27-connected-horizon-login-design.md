# Connected Horizon Login Design

## Goal

Refresh the Lumi5 Labs sign-in page so it visually continues the new public
homepage while preserving the existing authentication behavior and five-role
redirect logic.

## Approved Direction

The selected direction is **Connected Horizon** (Option A).

The page uses a balanced split layout:

- A branded indigo story panel introduces Lumi5's connection theme.
- A clean white panel contains the existing sign-in form.
- A restrained orbit graphic represents people and opportunities connecting,
  without naming any internal or staff role.

The experience should feel confident, welcoming, and polished rather than like
an administrative portal.

## Page Structure

The Connected Horizon shell replaces the existing shared top navigation on
`signin.html`. The story-panel logo and the form-panel `Back to home` link
provide the two homepage routes; there must not be a second logo or duplicate
sign-up action above the shell.

### Branded story panel

- Lumi5 Labs logo links back to the homepage.
- Eyebrow: `Private markets, made human`.
- Headline: `Where ambition meets opportunity.`
- Supporting copy reinforces trusted connections between people and
  opportunities.
- A decorative orbit diagram uses three nodes and thin rings. It is purely
  presentational and hidden from assistive technology.

### Sign-in panel

- A `Back to home` link remains available.
- Heading: `Welcome back`.
- Supporting copy: `Sign in to continue your Lumi5 journey.`
- Existing email and password fields retain their current IDs, validation
  hooks, autocomplete values, and required constraints.
- Existing message and role-context elements remain available to the current
  JavaScript.
- Preserve `signin-form` with `novalidate`, every current field/error ID,
  `signin-role-context` initially hidden, and the button's initial `Sign In`
  text.
- The primary action remains `Sign In`.
- The sign-up link remains visible below the form.

No administrator, superadmin, relationship-manager, business-owner, or investor
language is added to the default page. If the existing `?role=` query parameter
is present, the existing contextual hint may still appear because it is part of
the current login behavior.

## Visual System

- **Primary gradient:** deep indigo through Lumi5 violet.
- **Base surfaces:** white form panel and a very light lavender page surround.
- **Text:** dark navy for headings, muted slate for supporting copy.
- **Accent:** a small warm amber orbit node to echo the homepage's supporting
  accent color.
- **Corners:** generous but controlled rounding on the outer shell, inputs, and
  button.
- **Depth:** one soft shell shadow and a subtle button glow; no heavy glass or
  excessive effects.
- **Typography:** continue the project's existing sans-serif stack and use
  weight, spacing, and scale for distinction rather than adding another font
  dependency.

## Responsive Behavior

- Desktop and tablet use the two-panel composition.
- On narrow screens the form appears first, followed by a compact branded
  story section so authentication remains the primary task.
- The page must not introduce horizontal scrolling.
- Touch targets remain at least 44 pixels high.

## Accessibility

- Preserve one clear `h1` and correctly associated form labels.
- Give `signin-message` an appropriate polite live region so asynchronous
  authentication feedback is announced.
- Connect each field to its existing error element with `aria-describedby`.
- Maintain visible keyboard focus states on links, fields, and the submit
  button.
- Decorative orbit elements are ignored by assistive technologies.
- Text and controls must meet WCAG AA contrast.
- Respect `prefers-reduced-motion`; any decorative motion becomes static.
- Preserve existing error and success messaging behavior.

## Functional Boundaries

This change is visual only:

- Do not change the authentication endpoint, request body, session storage, or
  dashboard routing.
- Do not change signup behavior or other pages.
- Keep all IDs and DOM relationships relied on by `js/script.js`.
- Add a sign-in-only class to the page body and scope every new or overridden
  rule under it. Shared `.auth-*`, `.form-*`, navigation, and signup styles must
  not change their behavior.
- Update only `signin.html` and sign-in-scoped CSS in `css/style.css`.
- Retain the existing `20260727.1` shared stylesheet and script release keys;
  a site-wide cache-busting version change is outside this task.

## Verification

- Run the authentication client and frontend contract tests.
- Confirm `signin.html` loads without console errors.
- Verify invalid email and empty-password messages still render.
- Verify a valid account still signs in and redirects by its stored role.
- Check the layout at desktop and narrow viewport widths.
- Check keyboard focus order and reduced-motion behavior.
