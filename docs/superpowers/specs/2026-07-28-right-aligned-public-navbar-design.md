# Right-Aligned Public Navbar Design

Date: 2026-07-28
Status: Approved concept; awaiting written-spec review

## Goal

Remove the visually isolated middle navigation group from the public desktop
header. Keep the Lumi5 Labs brand anchored on the left and present all public
navigation and authentication actions as one coherent right-aligned cluster.

## Pages in Scope

- `index.html`
- `about.html`
- `contact.html`
- the shared public-header rules in `css/style.css`

No dashboard, authentication-page, backend, database, or messaging behavior is
part of this change.

## Approved Desktop Layout

The visible order remains:

```text
Lumi5 Labs                                  About  Contact   Sign in  [Sign up]
```

- The brand stays at the left edge of the existing `1180px` navigation frame.
- `About` and `Contact` move from the visual center to the right side.
- `Sign in` and the primary `Sign up` button remain to their right.
- A deliberate spacing boundary separates `Contact` from `Sign in`, preserving
  the distinction between informational navigation and account actions.
- Existing typography, colors, hover states, focus states, button treatment,
  link targets, and active-page indicators remain unchanged.

## Implementation Direction

Keep the current semantic HTML groups:

- `.landing-page-links` continues to contain `About` and `Contact`.
- `.landing-nav-actions` continues to contain `Sign in` and `Sign up`.

Use shared CSS to push `.landing-page-links` to the right with automatic inline
space after the brand, then apply the larger inter-group gap before
`.landing-nav-actions`. This avoids duplicating links, preserves the current
accessibility labels, and keeps the same markup on all three public pages.

## Responsive Behavior

This is a desktop alignment change. Existing compact-menu behavior and
breakpoints remain unchanged:

- the desktop `About` and `Contact` group still disappears at the established
  narrow breakpoint;
- the native compact menu still contains `About`, `Contact`, and `Sign in`;
- the visible `Sign up` action remains available as it is today.

## Testing

Automated checks will confirm:

- all three public pages retain identical navigation order and destinations;
- the shared desktop rule right-aligns the public links beside the auth actions;
- a distinct inter-group gap remains before `Sign in`;
- existing compact navigation behavior is unchanged;
- no removed Portfolio, FAQ, or Blog links return;
- the complete test suite passes.

## Release Scope

After verification and explicit release authorization, publish the tested commit
to GitHub `main` and deploy only the changed public HTML/CSS runtime files to
SFTP. Use cache-version updates if `css/style.css` changes so returning browsers
receive the new alignment.
