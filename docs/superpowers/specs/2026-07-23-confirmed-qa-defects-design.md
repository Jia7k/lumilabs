# Confirmed QA Defects Design

**Date:** 2026-07-23

## Goal

Fix the four defects confirmed during the signed-in four-role walkthrough without changing unrelated portfolio, interest, conversation, authentication, or messaging behavior.

## Scope

1. Make the business-owner portfolio total reconcile with its status breakdown by including rejected portfolios.
2. Show managed-chat guidance only when it matches the portfolio and current user's interest state.
3. Hide the relationship-manager Retry button except for a retryable load or refresh failure.
4. Distinguish a room with no currently interested investors from one where every interested investor is already a participant.

Deployment, SFTP cleanup, database mutation, and Git push are outside this change.

## Current Causes

- The business-owner dashboard query and response omit the rejected count, and the page renders only approved, pending, and draft counts.
- `managedChatAction` uses “Awaiting Relationship Manager” as its unconditional fallback on both My Businesses and Browse.
- `.btn { display: inline-flex; }` overrides the Retry button's native `hidden` presentation.
- The managed-room empty-eligibility branch does not inspect whether the room has any investor participants.

## Design

### Business-owner statistics

The business-owner dashboard query will calculate `rejected` alongside `approved`, `pending`, and `draft`. The API response will expose all four values.

The dashboard will:

- include rejected in the text breakdown beneath Total Portfolios;
- add a Rejected count box beside the existing status boxes; and
- keep the existing `total` value as the authoritative portfolio count.

The count grid will use four equal columns on desktop and retain the project's existing responsive behavior.

### Managed-chat state on My Businesses

The existing `/api/portfolios/my` payload already provides `status`, `interest_count`, `conversation_id`, and `chat_state`, so no new portfolio-list API field is needed.

Display precedence:

| Condition | Display |
| --- | --- |
| Active-member conversation with `chat_state = open` | Open Managed Chat |
| Active-member conversation with `chat_state = archived` | View Archived Chat |
| Approved, no conversation, and `interest_count > 0` | Awaiting Relationship Manager |
| Approved, no conversation, and `interest_count = 0` | Waiting for investor interest |
| Draft, pending, or rejected without an accessible conversation | No managed-chat status |

Conversation links remain governed by the server-provided membership-aware chat state.

### Managed-chat state on Investor Browse

Browse already reconciles approved portfolios with the current investor's interest IDs. It will continue to prioritize accessible open or archived conversations.

When no accessible conversation exists:

| Current investor state | Display |
| --- | --- |
| Has expressed interest | Awaiting Relationship Manager |
| Has not expressed interest | No managed-chat status |

This avoids implying that a relationship manager is blocking progress before the investor acts.

### Relationship-manager Retry visibility

A targeted CSS rule for `.rm-retry[hidden]` will force the button to remain absent while its `hidden` attribute is set. Existing JavaScript remains responsible for showing it only when `setStatus` receives `retryable = true`.

The rule will be scoped to this button so unrelated shared-button behavior is unchanged.

### Relationship-manager zero-investor copy

When `eligible_interests` is empty:

- if the room has one or more current investor participants, show “All currently interested investors are already in this room.”;
- if the room has no investor participants, show “No investors are currently interested.”

Archive and reopen eligibility behavior remains unchanged.

## Verification

Regression tests will be added before implementation and observed failing for:

- rejected count presence in the business-owner query, response, breakdown, and count grid;
- every My Businesses managed-chat display state;
- Browse hiding the waiting label before interest and showing it after interest;
- Retry remaining hidden under the shared button styles and appearing only for retryable errors; and
- the two distinct managed-room empty-eligibility messages.

After implementation:

1. Run the focused regression tests.
2. Run JavaScript syntax checks.
3. Run the complete backend test suite.
4. Perform a signed-in browser verification of the affected owner, investor, and relationship-manager states without creating or deleting unrelated records.

## Risk Controls

- Do not change messaging persistence, alignment, membership, archive, or reopen logic.
- Do not change interest mutation behavior.
- Do not change authentication, role routing, or unrelated pages.
- Escape all rendered database-derived values as before.
- Prefer existing payload fields and a narrowly scoped CSS selector over broader API or styling refactors.
