# Contact Singapore Horizon Design

## Goal

Replace the orbit illustration beside the Contact page heading with a visual
that better matches Lumi5 Labs: an abstract Singapore horizon grounded in the
existing navy, indigo, and green design system.

## Approved Direction

The user reviewed three visual directions:

1. Connection Constellation;
2. Contact Signals;
3. Singapore Horizon.

The approved direction is **Singapore Horizon**.

## Visual Composition

The right side of the Contact hero will contain:

- a soft indigo-and-green atmospheric glow;
- two thin geographic arcs that suggest reach and connection;
- a green location marker identifying Singapore;
- a restrained abstract skyline made from varied vertical forms;
- subtle window and reflection details that add depth without becoming a
  literal city illustration.

The composition remains abstract. It must not use a stock photograph, external
image, canvas, or JavaScript animation.

The hero's existing navy-to-indigo background, left-side heading, eyebrow, and
supporting sentence remain unchanged. The new visual occupies the same grid
area and maintains the current page rhythm.

## Markup and Accessibility

Replace the current `contact-orbit` figure contents with a dedicated
`contact-horizon` component. The figure keeps one concise `aria-label`
describing the complete illustration. Every internal decorative element uses
`aria-hidden="true"` so screen readers receive one useful description instead
of a list of meaningless shapes.

The component will use semantic class names for the scene, glow, arcs, pin,
skyline, buildings, and reflections. It contains no focusable controls.

## Responsive Behavior

Desktop is the primary acceptance target. The composition remains centered in
the existing right hero column and must not overflow its figure.

At existing narrow breakpoints, the skyline scales with the figure, the
location marker remains visible, and nonessential atmospheric detail may be
reduced. This is a compatibility treatment, not a Contact page layout
redesign.

## Motion

The visual should feel calm and architectural. A very subtle atmospheric glow
or pin pulse may be used only if it fits the current page and is disabled by
the existing `prefers-reduced-motion` contract. The skyline itself remains
stationary.

## Scope

In scope:

- the Contact hero figure markup;
- Contact-specific CSS for the Singapore Horizon;
- regression tests for structure, accessibility, styling, and removal of the
  old Contact orbit nodes;
- the frontend release-key update needed to invalidate cached CSS.

Out of scope:

- Contact copy, form, map, footer, or navigation changes;
- About page orbit changes;
- backend, API, database, environment, or deployment-service changes;
- new images, fonts, packages, or JavaScript.

## Testing

Tests must prove:

- the Contact hero contains exactly one `contact-horizon` figure;
- its accessible label identifies Singapore and Lumi5 Labs;
- decorative children are hidden from assistive technology;
- the scene contains the expected arcs, location marker, skyline, and building
  elements;
- old Contact-only `node-visit`, `node-email`, and `node-call` elements are
  absent;
- Contact-specific CSS is scoped to `.public-content-page`;
- the component stays within its figure and has a narrow-screen contract;
- reduced-motion behavior covers any new motion;
- all existing public-page, accessibility, and complete backend tests remain
  green.

## Release

Implementation will be committed locally after verification. GitHub and SFTP
release actions require explicit user authorization. A release must back up
affected live files and verify deployed hashes and public HTTP responses.
