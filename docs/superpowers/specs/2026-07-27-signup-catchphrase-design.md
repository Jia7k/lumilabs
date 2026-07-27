# Signup Catchphrase Design

**Date:** 2026-07-27
**Status:** Approved

## Context

The Connected Horizon sign-in and sign-up pages currently use the same story
copy:

- Eyebrow: “Private markets, made human”
- Headline: “Where ambition meets opportunity.”

The two pages should retain the same visual system while using distinct
messages. The sign-in copy must remain unchanged.

## Approved Change

Change only the story copy on `signup.html`:

- Eyebrow: “Your next move awaits”
- Headline: “Keep opportunity moving forward.”

## Scope

- Preserve all sign-in wording exactly.
- Preserve the sign-up layout, styling, artwork, form fields, role selection,
  validation, accessibility structure, and authentication behavior.
- Do not change JavaScript, APIs, backend code, database behavior, or other
  pages.
- Keep the existing heading IDs and semantic elements so accessible naming is
  unchanged.

## Verification

- Add or update the frontend content contract to assert the exact approved
  sign-up copy.
- Assert that the sign-in page retains its existing story copy.
- Assert that sign-in and sign-up story messages remain distinct.
- Run the focused frontend contract test and the complete automated suite.

## Success Criteria

The sign-up story presents the approved momentum-focused wording, the sign-in
story remains unchanged, and all existing authentication behavior and tests
continue to pass.
