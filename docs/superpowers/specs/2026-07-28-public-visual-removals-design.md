# Public Visual Removals Design

## Goal

Remove the complete “Let’s Innovate Together” section from About and remove
the Singapore Horizon illustration beside the Contact heading. The Contact
hero’s right desktop column remains intentionally empty for a future visual.

## Approved Direction

Use full removal rather than CSS hiding:

- delete the About call-to-action markup;
- delete the Contact Horizon markup;
- delete all CSS used only by those removed elements;
- replace tests that require the removed content with absence contracts.

No dormant markup or unused component styling will remain.

## About Page

Delete the complete `section.about-connect`, including its eyebrow, heading,
supporting paragraph, and Get Started link. The preceding About content and
the shared footer become adjacent in the document.

Delete the About-only `about-connect` CSS rules. Shared button, eyebrow, hero,
footer, and public-page styles remain unchanged.

## Contact Page

Delete the complete `figure.contact-horizon` and all of its decorative
children. Keep the existing `section.public-hero.contact-hero` and its left
copy unchanged.

The desktop hero retains its existing two-column grid. With no second child,
the right column is blank by design. Existing narrow-screen behavior may
collapse the grid normally.

Delete every `contact-horizon` style, animation, responsive override, and
reduced-motion override. Do not restore the older Contact orbit.

## Testing

Regression tests will prove:

- About no longer contains `about-connect`, “Let’s Innovate Together,” its
  supporting sentence, or the Get Started link;
- Contact contains no figure, `contact-horizon`, `contact-orbit`, or old
  Visit/Email/Call orbit nodes;
- the Contact hero copy remains unchanged;
- the About story, leadership content, Contact details, map, form, navigation,
  and footer contracts still pass;
- no removed selector remains in the public-content stylesheet;
- About and Contact load the new stylesheet cache key;
- the full automated suite remains green.

## Cache Invalidation

Update the About and Contact stylesheet URLs to
`css/style.css?v=20260728.6`. Their JavaScript URLs remain unchanged.

## Scope Boundaries

Do not change:

- the Contact hero copy or its desktop grid;
- the About hero, journey, vision, or leadership sections;
- navigation or footer content;
- the Contact form or map;
- the homepage;
- JavaScript behavior;
- backend, API, database, schema, environment, deployment configuration, or
  credentials.

GitHub and SFTP publication require explicit authorization after local
implementation and verification.
