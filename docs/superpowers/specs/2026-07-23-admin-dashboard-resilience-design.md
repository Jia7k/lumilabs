# Administrator Dashboard Resilience Design

**Date:** 2026-07-23

## Goal

Make Victor's moderation dashboard reliable as a complete page, with particular
focus on the reported failure where selecting **Review** for a newly submitted
portfolio appears to do nothing.

The dashboard must load useful sections independently, give visible feedback for
every review and mutation state, recover without a full sign-out, and load a
coherent set of frontend assets after a release.

## Verified Baseline

The investigation established the following facts before this design was
written:

- Victor can authenticate as an administrator and `/api/auth/me` returns the
  expected role.
- The production administrator stats, moderation queue, relationship-manager
  directory, dashboard, audit-log, and user endpoints return HTTP 200.
- The live moderation queue contains four portfolio IDs represented as integer
  JSON numbers.
- `GET /api/portfolios/:id` returns HTTP 200 for every currently queued
  portfolio, and every response includes a `documents` array.
- The current `js/moderatordashboard.js` renders all four live detail payloads
  and opens the review overlay in a deterministic DOM harness without throwing.
- The production copies of `moderatordashboard.html`, `css/style.css`,
  `js/api.js`, and `js/moderatordashboard.js` match the current local files.
- The administrator page references its CSS, shared API client, and page client
  with unversioned URLs. Apache provides validators but no explicit
  `Cache-Control` policy for those responses.
- The current Review action is a generated inline handler. Its portfolio lookup
  uses strict ID equality and silently returns when no exact match is found.
- Existing tests check administrator source structure but do not execute the
  Review interaction.

The current production code and live data therefore do not support a database,
authorization, detail-route, or current-template defect. Browser-local asset
skew is the strongest explanation for the reported session-specific behavior.
The silent ID-miss behavior is a separate confirmed weakness that produces the
same "nothing happens" experience when ID representations differ.

An interactive browser session was unavailable during diagnosis, so browser
console and cache state were not directly observed. The design treats cache
skew as the evidence-ranked cause, not as an unqualified certainty.

## Scope

Expected implementation changes are limited to:

- `moderatordashboard.html`;
- `js/moderatordashboard.js`;
- `css/style.css` only for narrowly scoped administrator loading, error, retry,
  or mutation states that cannot reuse existing styles;
- focused administrator client tests under `backend/test/`; and
- the existing frontend asset-contract test.

`js/api.js` remains the shared request implementation unless a failing
test proves that the administrator flow needs a shared-client correction. The
administrator page will still receive a new versioned URL for that file so its
API surface cannot be mixed with a newer dashboard client.

Do not change:

- database schema or production records;
- backend route behavior or role permissions without a newly proven backend
  defect;
- audit-log behavior;
- business-owner, investor, relationship-manager, or messaging pages;
- portfolio readiness calculations; or
- the site's established visual language.

Git push and SFTP deployment are separate release actions and require explicit
authorization after implementation and verification.

## Dashboard Architecture

### Authorization and shell

The page will continue to call `requirePageRole("admin")` before loading
protected data. After authorization succeeds, the user identity, page shell,
navigation, and relationship-manager form bindings are initialized once.

Section retries must call section loaders only. They must not re-run page
initialization or attach duplicate event listeners.

### Independent sections

The dashboard will have two independently recoverable data sections:

1. **Moderation:** stats plus the pending portfolio queue.
2. **Relationship managers:** active manager-account directory.

The current all-or-nothing `Promise.all` coupling will be removed. A manager
directory failure must not erase working stats or block the moderation queue.
A moderation failure must not disable an already loaded manager directory or
its account-creation form.

Each section will expose explicit states:

- `loading`: show a concise loading status and disable only controls belonging
  to that section;
- `ready`: render authoritative data and hide retry feedback;
- `empty`: retain valid summary information and render an intentional empty
  list state rather than a blank region; and
- `error`: retain any last coherent data as non-current, show a clear message,
  and expose a section-specific Retry action.

The stable status controls will be:

- `moderation-status` and `moderation-retry-btn`; and
- `manager-directory-status` and `manager-directory-retry-btn`.

On a first moderation-load failure, numeric stats show a dash and the queue
shows an error row because there is no authoritative prior snapshot. On a later
refresh failure, the last coherent stats and rows remain visible, are marked as
out of date in `moderation-status`, and every Review action is disabled until a
refresh succeeds.

An empty moderation queue still displays valid stats and an explicit
`No portfolios are waiting for review` row. An empty manager directory displays
its existing empty row. Directory loading, emptiness, or failure does not
disable the independent account-creation form; only an account submission
disables that form's submit control.

The moderation stats and queue are one coherent section because their counts
and rows describe the same workflow. They will be fetched together and
committed to the UI only after both requests succeed. A failed refresh must not
pair new stats with an old queue or the reverse.

Each section loader will use a monotonically increasing request version. A new
initial load, Retry, post-mutation refresh, or post-creation directory refresh
supersedes older reads for that section. Only the latest request may commit
data or an error state. A section Retry button is disabled while its request is
in flight, so identical retries are also single-flight from the user's
perspective.

### Relationship-manager account creation

The existing validation rules and backend contract remain unchanged.

While account creation is in flight:

- disable the submit button;
- preserve the entered name and email;
- prevent duplicate submissions; and
- show an in-progress label.

After a successful creation, refresh only the manager directory. If the account
was created but the follow-up directory refresh fails, say that creation
succeeded but the list could not be refreshed. Retry performs only the
directory read and never resubmits the account creation. The success-with-stale-
directory message lives outside the directory rows so rerendering cannot erase
it prematurely.

## Moderation Queue Interaction

### Review binding

Queue rows will render a semantic button with:

- `type="button"`; and
- a `data-portfolio-id` attribute containing the escaped portfolio ID.

One delegated click listener on the stable queue container will handle Review
actions. Inline JavaScript handlers will be removed from generated queue rows.
The event boundary will convert the attribute to a finite positive integer
before use.

The queue lookup will compare normalized numeric IDs. If the ID is invalid or
the row is no longer present, the client will not silently return. It will show
a recoverable moderation message and offer to refresh the queue.

### Review modal state machine

Selecting Review will:

1. normalize and validate the portfolio ID;
2. record that ID as the active review;
3. open the overlay immediately with a loading state; and
4. request the full portfolio detail.

On success, the modal renders the existing company, documents, team, traction,
market, financial, Approve, and Reject content. Database-derived strings remain
escaped, null numeric values retain the existing dash fallback, and document
downloads keep using the authenticated shared API helper.

On failure, the overlay stays open and renders:

- a user-safe error message;
- **Try again**, which repeats only the detail read for the same portfolio; and
- **Close**.

A failed detail request, malformed detail payload, or synchronous rendering
exception must never leave an empty card, an indefinite loading message, or a
browser-only alert as the sole feedback. All three enter the same recoverable
modal error state.

While Try again is loading, its control is disabled and duplicate retry clicks
are ignored.

Closing the modal invalidates the active review request. A late response from a
closed or superseded review must not reopen or overwrite the current modal.
This will be implemented with a small monotonically increasing request version
or equivalent identity guard.

Opening the modal records the initiating Review button and moves focus to the
focusable modal container. Closing restores focus to that button when it still
exists and remains enabled.

## Approve and Reject Mutations

### Shared mutation rules

Approve and Reject remain authorized server mutations through the existing API
methods.

While either mutation is in flight:

- disable both decision buttons;
- keep the modal visible;
- show which action is being saved; and
- ignore duplicate clicks.

### Approval

After approval succeeds:

1. close the review modal;
2. refresh the coherent moderation section; and
3. show a concise success status.

If the mutation succeeds but the moderation refresh fails, report that the
decision was saved but the dashboard could not refresh. Retry performs only
the stats-and-queue reads; it never repeats the approval. The last queue is
visibly marked out of date and all of its Review buttons stay disabled, so the
decided portfolio cannot be submitted again from a stale row.

If the approval mutation fails, keep the review modal and its details open,
restore the buttons, and show the failure inside the modal.

### Rejection

The rejection-reason overlay and required non-blank reason remain.

While rejection is being saved, disable the reason controls and both review
decision buttons. On mutation failure, retain the entered reason, restore the
controls, and show an inline error. On success, close both overlays and apply
the same authoritative moderation refresh behavior as approval.

Closing overlays while a mutation is in flight will be prevented so the user
cannot lose track of an unresolved decision.

## Asset Coherence

`moderatordashboard.html` will reference all three page dependencies with the
same new release key:

- `css/style.css`;
- `js/api.js`; and
- `js/moderatordashboard.js`.

Using one synchronized key prevents a newly deployed page client from being
combined with an older shared API client or modal stylesheet in the browser
cache after the new HTML document has been fetched.

This change does not rename physical files or change public routes.

The query key cannot evict an already cached copy of
`moderatordashboard.html`. For an authorized deployment, publish the compatible
CSS and page client before the HTML document, then verify the three keyed public
responses. The new client must tolerate the previous HTML during this short
staging window. The affected browser must perform one hard refresh (or open the
dashboard with a one-time document query) to fetch the new HTML; subsequent
asset requests will use the synchronized key. This limitation will be stated
in the release handoff instead of claiming that an SFTP upload can remotely
purge a browser's document cache.

## Accessibility and Presentation

- Loading and error messages use appropriate `role="status"` or `role="alert"`
  semantics and live regions.
- Retry and decision controls remain keyboard accessible.
- The review overlay preserves focus visibility and the existing Escape and
  outside-click behavior when no mutation is active.
- Opening the review overlay moves focus into the dialog, and closing it
  restores focus to the initiating Review button when possible.
- Decision progress is communicated in text, not only through disabled styling.
- Existing Lumi5 typography, spacing, colors, cards, tables, and modal layout
  remain the visual baseline.

## Testing Strategy

Tests will be written before implementation and observed failing for the
missing behavior.

### Executable administrator client tests

A deterministic DOM/VM harness will execute the actual administrator page
client and cover:

- moderation and manager sections loading independently;
- both sections' initial loading, first-load error, empty, ready, and stale-
  refresh states;
- either section failing without blanking the other;
- section Retry issuing only the intended reads and not rebinding handlers;
- deferred section responses proving that an older request cannot overwrite a
  newer request;
- the manager form remaining available during directory loading, emptiness, and
  failure;
- manager creation progress, duplicate-submit suppression, and input
  preservation;
- successful manager creation followed by a failed directory refresh, with
  Retry issuing GET only and never repeating the POST;
- delegated Review click with numeric and string-represented queue IDs;
- immediate loading-overlay presentation;
- successful detail rendering;
- missing or invalid portfolio IDs producing visible feedback;
- detail failure with working Try again and Close actions;
- malformed detail or rendering failure entering the recoverable error state;
- duplicate Try again clicks issuing one detail read;
- stale detail responses not overwriting a newer or closed modal;
- review focus entering the modal and returning to the initiating button;
- blank rejection reasons never calling the API;
- duplicate approval and rejection clicks being ignored while both decision
  controls show disabled progress;
- Escape, outside-click, Close, and Cancel paths being blocked during a
  mutation;
- mutation failures retaining modal/reason context and restoring controls;
- successful decisions triggering one authoritative moderation refresh whose
  rerender does not erase the decision status; and
- successful mutation plus failed refresh visibly disabling stale Review
  actions and never resubmitting the mutation.

### Source and asset contracts

The frontend flow contract will assert that the administrator page:

- references CSS, shared API JavaScript, and administrator JavaScript with one
  exact synchronized release key;
- exposes the stable IDs needed for independent section status and Retry
  controls; and
- no longer generates inline Review handlers.

### Verification

After implementation:

1. run the new administrator client tests;
2. run the frontend flow and shared API client tests;
3. run browser JavaScript syntax checks;
4. run the complete backend test suite;
5. run a read-only production API smoke for administrator auth, stats, queue,
   manager directory, and each queued portfolio detail; and
6. perform a signed-in browser walkthrough when a controllable browser session
   is available.

No approve, reject, account creation, database mutation, Git push, or SFTP
deployment is part of verification unless separately authorized.

## Success Criteria

The change is complete when:

- once the new HTML is fetched, Victor's page requests one coherent,
  synchronized administrator asset set, with the initial hard-refresh
  limitation documented at release;
- Review always opens immediate visible feedback for a valid queue row;
- invalid, stale, or failed review requests never appear inert;
- moderation and relationship-manager sections recover independently;
- Approve and Reject cannot be accidentally submitted twice;
- successful decisions reconcile stats and queue from the server without
  repeating the mutation;
- existing admin authorization and API contracts remain unchanged;
- focused and full automated tests pass; and
- no unrelated runtime files are modified.
