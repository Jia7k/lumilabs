# Messaging Persistence Design

Date: 2026-07-20

## Objective

Make the existing LumiLabs message composer persist every successful send to MySQL so the same message remains visible after the page is refreshed. A successful send must atomically create both the message and its `new_message` notification.

## Confirmed Product Decisions

- The public page remains a shared Alpha/Beta prototype.
- The selected prototype role determines the sender: Alpha is user ID `2` and Beta is user ID `3`.
- Sending must work in both directions between Alpha and Beta.
- This change supports replying in an existing or URL-selected conversation only.
- Starting a new conversation from the Messages page is out of scope.
- Message and notification writes are atomic: both commit or both roll back.
- The user approved leaving two clearly labelled live verification messages in the shared database, one in each direction.

Because this is a shared public prototype, any visitor who can switch between Alpha and Beta can send as that prototype identity and mutate the shared demo data. This behavior is intentional for this task and is not a production authentication model.

## Current System

`messages.html` loads `js/messages.js`. The browser binds the existing composer to `POST /api/messages` and sends:

```json
{
  "receiver_id": 2,
  "content": "Message text",
  "portfolio_id": 1
}
```

The browser also sends the selected Alpha/Beta prototype headers. Apache forwards only the `/api/messages` namespace to the isolated Express messaging service. The message route already validates a request and attempts separate message and notification inserts, but it has no transaction-level guarantee and lacks POST persistence coverage.

A non-mutating live probe confirmed that `POST /api/messages` reaches Express and that JSON validation runs. The deployment proxy and request parser therefore do not need redesign for this feature.

## Backend Design

### Identity and validation

Keep the existing prototype identity resolution. For a valid prototype request, the API resolves Alpha to user ID `2` or Beta to user ID `3` from the database before processing the send.

Retain these validations:

- `receiver_id` is a positive integer and refers to an existing user.
- `content` is trimmed, non-empty, and no longer than 2,000 characters.
- `portfolio_id` is either `null` or a positive integer referring to an existing portfolio.
- The sender cannot message itself.
- When a portfolio is present, its owner must be either the sender or receiver.

Validation failures occur before writes and return an appropriate `4xx` response.

### Transaction

For a valid request, the route acquires one connection from the existing `mysql2/promise` pool and performs this sequence:

1. Begin a transaction.
2. Recheck the receiver and optional portfolio using that connection.
3. Insert the message into `messages`.
4. Insert the receiver's `new_message` row into `notifications`, referencing the sender and optional portfolio.
5. Read the inserted message through the same connection so the response contains its database-generated ID and timestamps.
6. Commit.
7. Release the connection and return the saved message with HTTP `201`.

If any transactional query fails, the route rolls back, releases the connection, and returns a server error. It must never return success before the commit completes. A notification failure must not leave a committed message row.

The messaging router will expose a small database-injection seam for tests while continuing to use the existing pool by default in production. No unrelated API namespace or shared backend behavior changes.

## Browser Design

The existing composer and request shape remain unchanged.

When the user submits a non-empty message in an active conversation:

1. Disable the textarea and Send button to prevent duplicate submissions.
2. Send the POST request using the current prototype headers.
3. Wait for a successful `201` response.
4. Treat the returned row as committed, clear the textarea, and show `Message sent`.
5. Reload the active thread and conversation list from the API so the displayed state is confirmed by MySQL rather than only a local optimistic copy.
6. Re-enable the composer.

If the POST fails, the browser keeps the typed content, re-enables the composer, and shows the API's useful error message. Error extraction will support both the route's `{ "error": "..." }` responses and express-validator's `{ "errors": [...] }` response shape. If the POST succeeds but the follow-up reload fails, the browser must not restore the cleared draft or invite a duplicate retry; it reports that the message was saved but the conversation could not be refreshed.

Refreshing `messages.html` continues to use the existing conversation GET endpoint, which must return the committed message.

## Error Handling

- Empty client input does not issue a request.
- Duplicate clicks are blocked while a send is pending.
- Validation and authorization errors preserve the draft and display a specific message.
- Connection, message-insert, notification-insert, read-back, or commit failures result in rollback and a generic safe server error.
- Rollback and connection release are guarded so cleanup errors do not hide the original failure.
- The input is never cleared when the POST fails.
- A follow-up GET failure is reported separately from a send failure because the message has already committed.

## Verification

Automated messaging tests will cover:

- A valid Beta-to-Alpha request uses sender ID `3`, inserts one message and one notification, commits once, and returns `201` with the saved row.
- A valid Alpha-to-Beta request uses sender ID `2` and receiver ID `3`.
- A forced notification failure rolls back and does not commit.
- Invalid content is rejected without acquiring a transaction connection.
- The existing messaging health, namespace-isolation, and seeded-conversation tests remain passing.
- Browser request behavior preserves input when the POST fails, avoids duplicate retry messaging after a committed POST, and reloads database-backed thread state after success, using the lightest test seam compatible with the existing dependency-free frontend.

Live acceptance verification will:

1. Deploy only the changed messaging files and restart only the isolated messaging service when required.
2. Send one labelled Beta-to-Alpha message and one labelled Alpha-to-Beta message through the deployed messaging API.
3. Reload each thread and confirm the returned database IDs and contents match the POST responses.
4. Confirm matching `new_message` notification rows exist in MySQL.
5. Confirm `http://35.212.144.149/messages.html` displays the persisted messages after refresh.

The two labelled verification messages will remain in the shared demo database as approved evidence of persistence.

## File Scope

Implementation changes are limited to messaging-related files. The expected functional scope is:

- `backend/src/routes/messages.js`
- `js/messages.js`
- messaging-specific tests under `backend/test/`
- `backend/messages-server.js` only if required for test dependency injection
- messaging deployment files only if the live service requires a corresponding adjustment

No unrelated page, route, schema, or application file will be modified.

## Non-Goals

- Production authentication or authorization redesign
- New-conversation discovery or recipient selection UI
- Real-time WebSocket delivery
- Attachments, editing, deletion, reactions, or pagination
- Changes to non-messaging API namespaces
