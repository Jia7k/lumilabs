# Frontend User-Flow Reliability Design

## Objective

Repair the confirmed browser/runtime defects found during the whole-site user-
flow audit without changing the database schema, backend routes, or established
visual design. The repaired frontend must preserve valid sessions during
temporary failures, never present stale state as current or allow mutations
from stale state, and keep server data authoritative after mutations.

The completed work will be committed and pushed to `main`, then the exact
committed frontend files will be deployed to the live SFTP server at
`35.212.144.149`.

## Verified Baseline

Before this design was written:

- The complete local suite passed: 140 tests, 0 failures.
- The public `/api/health` and `/api/ready` endpoints returned HTTP 200.
- Every frontend file in `backend/deploy/runtime-manifest.txt` returned HTTP 200
  and matched the local SHA-256 hash.
- Every deployed backend runtime file matched its local SHA-256 hash.
- The self-cleaning live four-role flow passed on the API host: owner portfolio
  creation and submission, administrator approval, investor interest,
  relationship-manager room creation, three-party messaging, read cursors,
  archive/reopen, investor withdrawal, and cleanup.
- The live smoke restored all affected table counts and the upload-directory
  listing exactly. Its temporary backup was removed after verification.
- An interactive browser was unavailable in the current environment, so no
  visual click-through result is claimed.

The passing baseline does not cover the defects below. Most current frontend
tests are source contracts or isolated client tests rather than browser E2E
tests.

## Confirmed Defects and Root Causes

### Session and role handling

`js/api.js` clears the session for any failure inside `requirePageRole`, which
conflates a confirmed 401, a valid user on the wrong role page, an HTTP 5xx, and
a network failure. After initial authorization, `apiFetch` clears storage on a
401 but leaves protected pages displayed because it does not redirect.
`js/messages.js` duplicates this logic and signs the user out for every failure
from `/messages/me`.

### Managed-message selection

`js/messages.js` falls back to the first conversation when an explicit
`conversationId` is absent from the inbox. During refresh, if the previously
selected room disappears, `selectConversation` returns without clearing the
old thread or disabling the composer. A stale or unauthorized room can
therefore remain visible and appear writable.

### Portfolio numeric values

`js/createportfolio.js` uses truthiness while populating fields and building
payloads. Valid zeroes render as blank and optional numeric zeroes become
`null`. This changes stored information and can change readiness scoring,
particularly for `burn_rate=0`.

### Browse interest state

`js/browse.js` mutates only the interested-ID set after an interest request.
The displayed `interest_count` and managed-chat state remain stale. The
interest endpoints do not return authoritative counts, so local arithmetic is
not safe in all cases, including an idempotent express-interest response.

### Page recovery states

`js/investordashboard.js` uses `Promise.allSettled` but does not render rejected
branches. Failed sections can appear blank, quick actions disappear when
recommendations fail, and an unknown interest count is presented as zero.
`js/my-interests.js` initializes the role menu only after its data request, so a
failed initial load removes access to the visible sign-out interaction.

### Relationship-manager controls

`js/relationshipmanagerdashboard.js` renders Reopen for every archived room,
even when the backend will reject it. It also swallows dashboard-refresh
failures: a successful mutation can be followed by a failed refresh and then a
misleading success message over stale, actionable cards.

### Broken external stylesheet

`browse.html`, `investordashboard.html`, and `my-interests.html` request
`@tabler/icons-webfont@3.0.0/tabler-icons.min.css`, which returns HTTP 404. The
correct pinned path,
`@tabler/icons-webfont@3.0.0/dist/tabler-icons.min.css`, returns HTTP 200.

## Scope

Expected production changes are limited to:

- `js/api.js`
- `messages.html` and `js/messages.js`
- `js/createportfolio.js`
- `js/browse.js`
- `js/investordashboard.js`
- `js/my-interests.js`
- `js/relationshipmanagerdashboard.js`
- `browse.html`, `investordashboard.html`, and `my-interests.html`
- `css/style.css` only if a small accessible disabled/retry state cannot reuse
  an existing class
- focused files under `backend/test/`

Do not change the schema, live database records, backend routes, API payloads,
role permissions, or overall site layout.

## Shared Authentication and Error Contract

### Structured request errors

`js/api.js` will be the shared request/session boundary for every protected
page, including `messages.html`. It will expose structured request failures
that retain:

- the user-safe message;
- the HTTP status when a response exists;
- whether the request failed before receiving a response.

A failed JSON parse keeps the status-based fallback message. Error payloads
continue to prefer the backend's `error` or first validator message.

### Session transitions

- A confirmed HTTP 401 clears all Lumi5 Labs session keys and redirects to
  `signin.html`.
- An HTTP 403 never clears a valid session.
- Network failures and HTTP 5xx responses never clear a valid session.
- Post-load 401 responses use the same clear-and-redirect behavior as the
  initial role check.
- Repeated 401 handling must not create redirect loops or multiple redirects.

### Role transitions

`requirePageRole` will use a shared role-to-dashboard map.

- Correct role: return the authenticated user.
- Valid but incorrect role: keep the session and redirect to that user's own
  dashboard.
- Confirmed 401: use the shared sign-in transition.
- Network/5xx failure: keep the session, render an accessible recoverable
  notice with a Retry action, and return no user to the page initializer.

The recovery notice will be injected by a small shared helper so every
protected page receives safe behavior without duplicating bespoke error UI.
Its Retry action performs a full page reload, so it cannot bind a second copy
of existing handlers. It does not clear credentials.

### Messages integration

`messages.html` will load `js/api.js` before `js/messages.js`.
`js/messages.js` will remove its duplicate base-URL, session-clearing, and
request-classification implementation and use the shared helpers. A temporary
`/messages/me` failure renders the messages-unavailable state with Retry rather
than signing the user out. A confirmed 401 still redirects through the shared
contract.

## Managed-Message State Machine

### Initial selection

- If the URL has no valid positive `conversationId`, select the first available
  room, preserving the existing normal inbox behavior.
- If the URL has an explicit valid ID and that room exists, select it.
- If the URL has an explicit valid ID and that room is not in the accessible
  inbox, do not select another room. Clear active thread state, disable the
  composer, and render `Conversation unavailable` while leaving the inbox
  usable.

### Refresh and membership removal

After the inbox refreshes:

- If the active room still exists, reload that room.
- If the active room disappeared, invalidate in-flight selection work, clear
  `activeConversationId` and `activeThread`, render the unavailable state, and
  disable the composer.
- Never retain old messages, participants, archive state, or send capability
  after the corresponding summary disappears.

The existing selection-version mechanism remains the race guard. The new
unavailable transition must advance/invalidate it so an older thread response
cannot restore cleared content.

Selecting another visible inbox item exits the unavailable state normally.

## Portfolio Numeric Data

Introduce explicit helpers with these semantics:

- Display helper: return an empty string only for `null` or `undefined`; retain
  numeric zero.
- Optional integer/decimal parser: return `null` for blank or invalid input;
  otherwise return the parsed number, including zero.

Use them for `funding_goal`, `team_size`, `founded_year`, `monthly_revenue`,
`user_count`, `growth_rate`, `burn_rate`, and `runway_months`. Required
funding-goal validation remains unchanged except that a valid numeric zero is
not confused with an empty value.

## Authoritative Interest Refresh

After `expressInterest` or `removeInterest` succeeds, `js/browse.js` will
re-fetch both:

- the approved portfolio collection; and
- the current investor's interests.

Both refreshed requests must succeed before either `allPortfolios` or
`interestedIds` is replaced. They are committed together, after which the
current search, sector, score filter, and sort mode are reapplied. This refresh
supplies the authoritative interest count and managed-chat state.

If the mutation succeeds but refresh fails, do not claim the old count is
current. Keep the last coherent rendered data, visibly mark it stale, show a
clear `change saved, refresh failed` warning, and offer Retry. Retry repeats
only the two reads; it never resends the successful mutation. Disable every
interest toggle while a mutation or authoritative refresh is in flight so
overlapping card actions cannot race or apply responses out of order.

## Recoverable Investor Pages

### Investor dashboard

Dashboard and recommendation requests remain independent.

- Fulfilled sections render normally.
- Each rejected section renders an accessible error state with Retry.
- Quick actions render independently of recommendation success.
- If the dashboard request fails, omit the interests badge instead of showing
  an invented zero.
- A partial success never clears content from another successful section.

### My Interests

Initialize the role menu immediately after successful role authorization and
before loading interests. A data-load error renders in the interests region
with a Retry action, but the user menu and sign-out remain functional. This
section-level Retry repeats only the interests request and does not rebind the
role-menu handlers.

## Relationship-Manager Recovery

### Reopen eligibility

For an archived room, enable Reopen only when all frontend-observable
requirements are met:

- `portfolio_id` is present;
- the archive reason is neither `portfolio_unapproved` nor
  `portfolio_deleted`; and
- at least one active investor is present in `room.investors`.

Otherwise keep the Reopen button visible but disabled and display a reason:

- deleted portfolio: history is permanent and cannot reopen;
- unapproved portfolio: approval is required first;
- no active investor with eligible interests: add an eligible investor first;
- no active or eligible investor: an investor must express interest first;
- unknown state: the room cannot reopen from its current state.

The backend remains the final authorization boundary and may still reject a
race; its safe message will be shown without corrupting client state.

### Mutation refresh

`loadDashboard` will report success/failure rather than swallowing an error.
After a mutation:

- mutation and refresh succeed: show the success message and current data;
- mutation fails: show the backend-safe error and retain the previous coherent
  state;
- mutation succeeds but refresh fails: state that the change was saved but the
  dashboard could not refresh, mark the dashboard stale, and disable further
  create/add/archive/reopen mutations until Retry succeeds.

Opening an existing chat remains available while dashboard data is stale.

## External Icon Asset

Change only the three broken URLs to the verified pinned URL:

`https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.0.0/dist/tabler-icons.min.css`

Do not modify pages whose current icon stylesheet already returns HTTP 200.

## Testing Strategy

Every production behavior change follows red-green-refactor:

1. Add the smallest regression test and run it to observe the expected failure.
2. Implement the minimum production change.
3. Run the focused test to green.
4. Run the complete suite before moving to release verification.

Focused coverage must prove:

- 401 clears and redirects, while 403/network/5xx preserve the session;
- wrong-role users go to their mapped dashboard;
- authorization service failures render Retry without signing out;
- an unavailable explicit chat ID never selects an unrelated room;
- refresh removal clears thread/composer state and invalidates stale responses;
- zero-valued portfolio fields render and serialize as zero;
- successful interest mutations atomically use refreshed counts and
  membership/chat state without racing overlapping card actions;
- mutation-success/refresh-failure is reported accurately;
- investor dashboard partial failures preserve successful sections, render
  Retry, and never invent a zero count;
- My Interests sign-out initializes before data loading and its data error can
  retry without rebinding menu handlers;
- manager Reopen is enabled and disabled according to the approved rules;
- manager mutations cannot present stale data as successfully refreshed;
- the three Tabler stylesheet URLs contain `/dist/` and use the verified pinned
  version;
- `messages.html` loads the shared API helper before the message client;
- all browser JavaScript passes syntax checking.

The release gate is the complete existing suite plus new tests with zero
failures. Network access is not required by the local suite; the CDN HTTP check
belongs to deployment verification.

## Git and Live Deployment

1. Commit the approved specification separately from implementation. After
   that commit, require a clean `main` working tree and preserve the already
   committed demo-data design document.
2. Fetch `origin/main`. If it advanced, rebase local `main` onto it. Abort and
   inspect any conflict rather than choosing a side automatically; never
   force-push.
3. Commit the verified frontend/tests change and push `main` normally.
4. Resolve the exact changed runtime frontend files from the committed diff.
5. Immediately before deployment, hash every corresponding file under the
   live web root `/var/www/html`. Require each preimage to match the expected
   pre-deployment Git version; stop without overwriting anything if live drift
   is found.
6. Over SSH, create a mode-`0700` temporary backup directory on the same host
   and copy only the live files that will be replaced, preserving their paths.
7. Upload only the committed changed frontend files to same-filesystem
   temporary names beside their targets. Do not upload tests, documentation,
   backend files, schema files, or environment files.
8. Verify each staged file's SHA-256 against the committed local file, then
   rename each staged file over its target atomically in dependency-safe order.
   Never stream a partial file directly into a live path.
9. Verify each deployed file's SHA-256 against the committed local file.
10. Run the complete non-browser regression suite against the committed code.
    Verify every public runtime frontend path returns HTTP 200, the corrected
    pinned Tabler URL returns HTTP 200, and public API health/readiness remain
    HTTP 200. Do not claim a visual click-through while no browser is
    available.
11. On failure, restore only the backed-up frontend files through staged
    same-filesystem names and atomic renames, then repeat the same hash and
    HTTP verification.
12. On success, verify the temporary directory contains only the expected
    backup files, delete those exact files, remove the empty directory, and
    confirm it no longer exists. The pre-deployment Git revision remains the
    durable rollback source after the temporary copy is removed.

## Out of Scope

This repair does not implement:

- a fresh-install administrator bootstrap mechanism;
- immutable or paginated audit history;
- backend endpoint coverage expansion unrelated to these regressions;
- conversation-title synchronization after portfolio renaming;
- new owner interest-list, investor notification, portfolio-detail, or document
  browsing features;
- schema, seed, role, permission, or live data changes;
- a visual redesign or new frontend framework;
- a claim of interactive browser verification when no browser is available.

These are separate product or architecture projects and must not be bundled
into this focused reliability fix.

## Acceptance Criteria

- All selected behavior decisions above are represented by regression tests.
- The complete local test suite passes with zero failures.
- No backend or schema production file changes.
- No live database rows are created, modified, or deleted by deployment.
- Live preimage hashes match the expected pre-deployment Git revision before
  any file is replaced.
- Git `main`, the local checkout, and the deployed frontend contain the same
  committed changed files.
- All public frontend assets, the corrected CDN URL, health, and readiness
  checks return HTTP 200.
- Invalid/departed chats cannot expose stale content or an enabled composer.
- Zero numeric values survive edit and save.
- Valid sessions survive non-401 failures and wrong-role navigation.
- Relationship-manager stale/reopen states are truthful and recoverable.
- The SFTP temporary backup is removed only after successful verification.
