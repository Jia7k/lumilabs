# Four-Role Responsive and Routing Fixes Design

**Date:** 2026-07-23

## Goal

Fix every defect confirmed by the latest four-role website walkthrough while
preserving the existing Lumi5 visual language, database schema, managed-chat
membership rules, and desktop workflows.

## Scope

1. Remove horizontal page overflow at a 390-pixel viewport from the protected
   business-owner, investor, and administrator pages.
2. Keep the complete mobile message thread, right-aligned messages, composer,
   and Send button inside the visible thread panel.
3. Enable Send only when an active writable room contains a non-whitespace
   draft.
4. Reject malformed portfolio edit identifiers instead of interpreting their
   numeric prefix.
5. Make the Browse account menu and sign-out action available as soon as the
   investor is authenticated, even while workspace data is pending.
6. Make the messaging sign-out control use its existing degraded-load fallback.
7. Restrict managed messaging to business owners, investors, and relationship
   managers. Administrators who open the page directly return to the
   administrator dashboard, and administrator message API requests receive
   HTTP 403 before database access.

Git push, SFTP deployment, production database mutation, schema changes, and
redesigning the site's visual identity are outside this change.

## Current Causes

- Shared owner and administrator navigation has a fixed height and no mobile
  wrapping rule. Their statistics, content, and portfolio-form grids also retain
  desktop columns on narrow screens.
- Investor pages contain standalone CSS with no responsive breakpoints, so
  navigation and multi-column content establish desktop minimum widths.
- The message shell becomes one column on mobile, but the thread grid retains
  an implicit intrinsic-width column. The composer uses `1fr auto`, and the
  textarea has no shrink guard.
- Composer availability currently represents only room writability. It does
  not represent whether the current draft can be submitted.
- `parseInt` accepts a numeric prefix from malformed portfolio edit URLs.
- Browse binds its account-menu listeners only after its portfolio and interest
  snapshot settles.
- The HTML sign-out button calls the shared `signOut` function directly even
  though `signOutMessages` already supplies a fallback when the shared asset
  cannot load.
- Message routes authenticate users but do not enforce the three supported
  conversation roles.

## Design

### Responsive protected pages

The shared stylesheet will gain a protected-page mobile contract based on the
already working relationship-manager layout:

- navigation becomes auto-height, wraps, and places the link row on its own
  horizontally scrollable line;
- account text can hide while the avatar and menu remain available;
- page padding is reduced without changing desktop spacing;
- four-column statistics become two columns at an intermediate width and one
  column on narrow phones;
- owner content/sidebar and portfolio-form rows collapse to one column;
- page headings and action groups stack when necessary; and
- administrator queue and audit tables sit inside labeled horizontal scroll
  containers rather than widening the whole document.

The three standalone investor pages will receive equivalent scoped media rules
for navigation, statistics, content grids, filters, cards, and actions. The
current colors, typography, card hierarchy, and link labels remain unchanged.

At 390 pixels, the document itself must not scroll horizontally. Wide data
tables may scroll only inside their table container.

### Mobile messaging containment

The message thread will explicitly use `minmax(0, 1fr)` for its only column.
The composer will use `minmax(0, 1fr) auto`, and its input plus thread children
will receive `min-width: 0` shrink guards. Long unbroken message content will
wrap inside its bubble.

The existing message alignment contract remains unchanged:

- the signed-in user's messages stay on the right;
- every other participant's messages stay on the left; and
- the composer remains visible after sending.

### Composer state

One composer-state function will derive both controls from:

- an active conversation exists;
- the conversation is active and allows sending;
- no send is currently in progress; and
- `messageInput.value.trim()` is non-empty.

For an active writable room, the textarea stays enabled while an empty Send
button stays disabled. The input event updates Send immediately. A successful
send clears the textarea and disables Send again. A failed send restores the
exact draft and re-enables Send when the restored draft is non-empty.

The existing server-side trimmed non-empty and 2,000-character validation
remains defense in depth.

### Strict portfolio identifiers

A portfolio edit ID is valid only when the complete query value is a canonical
positive safe integer. A missing `id` means create mode. A present but invalid
`id` means an invalid edit link: after owner authentication, the page will show
the existing error mechanism and redirect to My Businesses without requesting
or creating a portfolio.

Portfolio API path identifiers used by owner detail and mutation routes will
receive the same positive-integer validation before database or service access.
Existing ownership checks remain authoritative.

### Browse account controls

After `requirePageRole("investor")` succeeds and identity is rendered, Browse
will bind its account-menu listeners exactly once before starting or awaiting
portfolio, interest, or recommendation requests. A pending or failed workspace
request will therefore never disable account access or sign-out.

### Messaging fallback and role policy

The messaging sign-out button will call `signOutMessages`. When the shared API
client is present, this delegates to the normal shared sign-out flow. When it is
missing, the fallback clears the same three session keys and redirects to the
sign-in page.

The messaging identity request remains the first client request. If it returns
an administrator identity, the client redirects to
`moderatordashboard.html` without requesting a conversation list or clearing
the administrator session.

Conversation-list, thread, read-cursor, and send routes will require one of:

- `business_owner`;
- `investor`; or
- `relationship_manager`.

An administrator receives HTTP 403 before any conversation database query or
transaction is started. Existing active-membership authorization continues to
govern supported roles.

## Test Strategy

Every behavior change will follow a red-green cycle.

Regression coverage will include:

- shared and investor-page mobile breakpoint contracts;
- administrator table-scroll wrappers;
- constrained message grid, composer, input, thread-child, and long-token rules;
- empty, whitespace, non-empty, successful-send, failed-send, and archived-room
  composer states;
- actual degraded-load sign-out button wiring and fallback behavior;
- administrator client redirect before the conversation-list request;
- administrator API rejection before database access;
- canonical, missing, malformed, and out-of-range portfolio edit IDs;
- malformed portfolio API IDs rejected before database or service access; and
- Browse menu binding before a deferred workspace request settles.

After focused tests pass:

1. Run every browser JavaScript syntax check.
2. Run the complete backend test suite.
3. Perform signed-in desktop and 390-pixel browser checks for all four roles.
4. Confirm no page-level horizontal overflow, no console errors, correct
   left/right message alignment, and a fully visible composer.
5. Review the complete diff for unrelated changes.

## Risk Controls

- Do not change database tables, columns, seed data, credentials, or live rows.
- Do not send messages, express or remove interests, create portfolios, or
  approve/reject portfolios during browser verification.
- Do not change managed-room creation, membership, archive, or persistence
  semantics.
- Keep desktop dimensions and the existing visual identity intact.
- Keep table overflow local to table containers.
- Do not grant administrators conversation access.
- Do not push or deploy until the user asks separately.
