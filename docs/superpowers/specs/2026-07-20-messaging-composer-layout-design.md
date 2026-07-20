# Messaging Composer Layout Regression Design

Date: 2026-07-20

## Objective

Keep the message composer visible and usable after every successful send. The thread header and composer remain fixed inside the thread panel while only the message history scrolls.

## Root Cause

The deployed message thread now contains enough rows to exceed the shell's available height on a typical laptop viewport. The shell has a fixed viewport-derived height and `overflow: hidden`, while the thread uses `grid-template-rows: auto 1fr auto` and the message list has no explicit zero minimum height.

The `1fr` row therefore retains an automatic min-content minimum as history grows. It expands instead of shrinking into a scrollable track, pushes the composer below the shell, and the shell clips the composer. The textarea remains in the DOM and the existing JavaScript re-enables it correctly; this is a CSS layout defect rather than a send, API, or database defect.

## Confirmed Behavior

- The composer stays pinned at the bottom of the selected thread.
- Only the message-history area scrolls as messages accumulate.
- The behavior applies on desktop and narrow layouts.
- Users can send consecutive messages without reloading or reselecting the conversation.
- Existing send persistence, notifications, validation, and prototype identities remain unchanged.

## CSS Design

Update the thread panel to use three bounded grid tracks:

```css
.thread-panel {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  background: #FFFFFF;
}
```

The header remains the first automatic track, the message history is the only flexible track, and the composer remains the final automatic track. `minmax(0, 1fr)` explicitly permits the history row to shrink below its min-content height.

Also set the scrollable history's minimum height to zero:

```css
.message-list {
  min-height: 0;
  overflow-y: auto;
}
```

For viewports up to 820 pixels wide, replace the thread's unbounded minimum-only sizing with a bounded 560-pixel thread height:

```css
@media (max-width: 820px) {
  .thread-panel {
    height: 560px;
    min-height: 0;
  }
}
```

The page may scroll to reach the thread on narrow screens, but once visible, the thread header and composer remain in place and history scrolls within the bounded middle track.

## Regression Coverage

Add a dependency-free messaging layout test under `backend/test/` that reads `messages.html` and verifies all layout invariants:

- The thread grid uses `auto minmax(0, 1fr) auto`.
- The thread panel has `min-height: 0` and `overflow: hidden`.
- The message list has `min-height: 0` and `overflow-y: auto`.
- The narrow-screen rule gives the thread an explicit 560-pixel height and resets its minimum height.

Extend the successful client-flow test to submit twice in the same harness. It must assert that the textarea and Send button are re-enabled after the first request and that the second submission issues a second POST without refreshing or reselecting the conversation. Keep the existing checks that a successful POST clears the draft and reloads the stored thread.

No browser automation dependency will be added. The static test guards the CSS contract, while the live acceptance check uses the deployed page with the existing six-message thread.

## Deployment and Acceptance

Deploy only `messages.html`; no backend service restart or database change is required.

Acceptance sequence:

1. Load the existing Alpha/Beta thread on `http://35.212.144.149/messages.html`.
2. Confirm the composer is visible with the current six-message history.
3. Send a message and confirm the history scrolls to the new row while the composer remains visible and enabled.
4. Type and send a second message without refreshing or reselecting the thread.
5. Refresh and confirm both messages remain in the database-backed thread.

If no interactive browser connection is available to the agent, automated layout, client, API, and live smoke tests still run, and the final visual acceptance step is explicitly handed to the user.

## File Scope

- Modify: `messages.html`
- Create: `backend/test/messages-layout.test.js`
- Modify: `backend/test/messages-client.test.js`
- Documentation: this messaging-specific specification and its implementation plan

No production JavaScript, API route, database schema, deployment service, or unrelated application file changes are required.

## Non-Goals

- Redesigning the message composer or thread appearance
- Adding auto-growing textarea behavior
- Changing message persistence or notification logic
- Adding a new browser-testing dependency
- Modifying unrelated responsive layouts
