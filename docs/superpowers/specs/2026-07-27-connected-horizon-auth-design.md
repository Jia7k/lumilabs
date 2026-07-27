# Connected Horizon Authentication Design

## Goal

Refresh the Lumi5 Labs sign-in and sign-up pages so they form one visual system
that continues the new public homepage. Preserve all existing authentication,
registration, public role-selection, and dashboard-routing behavior.

## Approved Direction

The selected direction is **Connected Horizon** (Option A).

Both pages use a matched split layout:

- A branded indigo story panel introduces Lumi5's connection theme.
- A clean white panel contains the relevant existing form.
- A restrained orbit graphic represents people and opportunities connecting,
  without naming any internal or staff role.

The pair should feel confident, welcoming, and polished rather than like an
administrative portal. Sign-in remains the shorter, focused experience. Sign-up
uses the same shell with a slightly wider form panel and natural page scrolling
to accommodate its longer form.

## Page Structure

The Connected Horizon shell replaces the existing shared top navigation on
both `signin.html` and `signup.html`. The story-panel logo and the form-panel
`Back to home` link provide the two homepage routes; there must not be a second
logo or a duplicate authentication action above the shell.

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

### Sign-up panel

- A `Back to home` link remains available.
- Heading: `Create your account`.
- Supporting copy invites users to join Lumi5 without internal-role language.
- The existing Business Owner and Investor selector remains the first form
  control. Its current icons, labels, descriptions, active state, and query
  parameter preselection behavior remain intact.
- Existing name, email, password, and confirm-password fields retain their
  current IDs, validation hooks, autocomplete values, and length constraints.
- Preserve `signup-form` with `novalidate`, `role-input`, every current
  field/error ID, `role-hint`, and the current dynamic submit-button labels.
- Existing message, role hint, validation, registration request, and
  post-registration routing behavior remain available to `js/script.js`.
- The sign-in link remains visible below the form.

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

- At widths of 900 pixels and above, sign-in uses a 46/54 story-to-form grid
  and sign-up uses a 40/60 grid so its longer form has enough room.
- On short desktop viewports, the document scrolls naturally; neither form is
  placed inside a nested scrolling panel. Both panels scroll with the document.
- Below 900 pixels the form appears first, followed by a compact branded story
  section so authentication remains the primary task.
- The page must not introduce horizontal scrolling.
- Touch targets remain at least 44 pixels high.

## Accessibility

- Preserve one clear `h1` and correctly associated form labels.
- Give `signin-message` an appropriate polite live region so asynchronous
  authentication feedback is announced.
- Give `signup-message` the same polite live-region treatment.
- Connect every field on both pages to its existing error element with
  `aria-describedby`.
- Preserve real `button` elements and meaningful pressed/selected semantics for
  the signup role selector. `js/script.js` synchronizes `aria-pressed` whenever
  the existing visual active state changes.
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
- Do not change authentication, signup, or role-selection behavior.
- Keep all IDs and DOM relationships relied on by `js/script.js`.
- Add explicit authentication-page and page-specific body classes. Scope the
  new shell rules to the authentication pages and page-specific differences to
  their sign-in or sign-up classes. Unrelated `.form-*`, navigation, dashboard,
  and portfolio styles must not change their behavior.
- Shared Connected Horizon markup patterns should use the same class names on
  both pages rather than duplicating equivalent CSS.
- Update only `signin.html`, `signup.html`, authentication-scoped CSS in
  `css/style.css`, and the role-selector accessibility-state synchronization in
  `js/script.js`. No request, validation, storage, or navigation logic changes.
- Retain the existing `20260727.1` shared stylesheet and script release keys;
  a site-wide cache-busting version change is outside this task.

## Verification

- Run the authentication client and frontend contract tests.
- Confirm both pages load without console errors.
- Verify invalid email and empty-password messages still render.
- Verify a valid account still signs in and redirects by its stored role.
- Verify both public signup roles still preselect, update their hint and submit
  label, register through the existing API, and redirect correctly.
- Check the layout at desktop and narrow viewport widths.
- Check keyboard focus order and reduced-motion behavior.
