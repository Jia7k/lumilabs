# Homepage About and Contact Navigation Design

## Goal

Make the new About and Contact pages discoverable from the top navigation of
`index.html` without changing the headers on any other page.

## Desktop and tablet navigation

- Keep the existing Lumi5 Labs brand link on the left.
- Add a semantic navigation group containing `About` → `about.html` and
  `Contact` → `contact.html` between the brand and authentication actions.
- Keep the existing `Sign in` and `Sign up` actions on the right.
- Use the homepage's existing typography, spacing, focus treatment, and
  purple accent rather than importing the public-content header styling.

## Compact navigation

- At a width where the inline links no longer fit comfortably, replace the
  inline navigation and `Sign in` link with a native `details` menu labelled
  `Menu`.
- Put `About`, `Contact`, and `Sign in` inside that compact menu.
- Keep `Sign up` visible as the primary action.
- The compact menu must stay within the viewport at 320px and remain usable
  with keyboard and touch input.

## Accessibility and behaviour

- Label the desktop and compact navigation landmarks distinctly.
- Preserve minimum 44px interactive targets and visible focus indicators.
- Use ordinary same-origin links; no JavaScript is required for navigation.
- Do not add Portfolio, Blog, FAQ, or administrative-role links.

## Verification

- Add a failing contract test for the homepage desktop and compact link sets
  before changing production markup or CSS.
- Verify the focused public-page tests and then the complete backend suite.
- Inspect the homepage at desktop, compact, and 320px widths for link
  visibility, menu containment, keyboard operation, and horizontal overflow.

## Out of scope

- Changes to About or Contact page headers.
- Changes to page content, authentication behaviour, APIs, or database data.
- Deployment, merging, or pushing.
