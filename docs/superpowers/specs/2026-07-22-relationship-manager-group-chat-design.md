# Relationship Manager and Managed Group Chat Design

Date: 2026-07-22  
Status: Approved design

## Purpose

Lumi5 Labs will add a trusted `relationship_manager` role that oversees conversations between a business owner and investors who have expressed interest in that owner's approved portfolio. The relationship manager claims an eligible portfolio, creates its managed room, and may add more eligible investors as the situation develops.

The finished product is dynamic. The permanent X3/testing1 room is only seeded demonstration data; the production workflow must work for every approved portfolio and every qualifying investor interest.

## Success criteria

- The homepage presents business owner, investor, relationship manager, and administrator entry points in a coherent four-role layout.
- Relationship managers use staff accounts created by administrators and cannot self-register publicly.
- Only a relationship manager can access the relationship-manager dashboard.
- Each approved portfolio can have at most one managed room.
- A room has one portfolio owner, one assigned relationship manager, and one or more investors with active interests in that portfolio.
- The assigned manager can add additional eligible investors, archive the room, and reopen it when eligibility conditions are satisfied.
- Only the assigned manager, portfolio owner, and active investor members can access the room.
- New investors see only messages sent after they joined.
- An investor who withdraws interest immediately loses room access. The last investor's departure archives the room.
- A portfolio leaving `approved` status archives its room and makes it read-only.
- Messages persist in MySQL and survive refreshes.
- The authenticated user's messages appear on the right; every other participant's messages appear on the left with sender name and role.
- Chat writes, membership changes, notifications, and state transitions are transactional and concurrency-safe.
- The existing direct-message data is reset without removing users, portfolios, interests, audit logs, or unrelated notifications.

## Product decisions

The following decisions were explicitly approved:

- One managed room per portfolio, not one room per investor and not multiple rooms for subsets of investors.
- A room may contain multiple investors.
- Every investor added must have an active interest in the same approved portfolio.
- The manager selects approved interest records; the server derives the investor and business owner rather than trusting independently supplied user IDs.
- Relationship-manager accounts are administrator-created staff accounts.
- Managers self-claim unassigned portfolios when creating the room.
- Other relationship managers cannot view or manage a claimed room.
- The manager may participate, archive, and reopen, but may not edit/delete messages or manually remove participants.
- Interest withdrawal removes the corresponding investor automatically.
- A newly added or re-added investor cannot see messages from before the latest join point.
- Only approved portfolios may have active rooms.
- Existing chat data will be reset rather than migrated.
- One permanent demo room will use X3, owner Beta, and investor testing1. Leticia l remains eligible to be added dynamically.

## Current-state findings

The repository currently supports only `business_owner`, `investor`, and `admin` in its schema and role routing. Its message APIs are partner-based: messages have a single `receiver_id`, inboxes group by partner, and a scalar `read_at` cannot represent multiple recipients.

The live database is ahead of the repository and already contains:

- `relationship_manager` in the `users.role` enum;
- empty `conversations` and `conversation_members` tables;
- nullable `messages.conversation_id` support while retaining ten legacy direct messages;
- notification references to conversations and messages;
- one relationship-manager user;
- two active interests in approved portfolio X3: testing1 and leticia l.

The live conversation tables are not yet suitable for the approved model. `conversations` currently stores one `investor_id`, and `conversation_members` has a uniqueness rule allowing only one member per role. Both conflict with multiple investors. The implementation must reconcile repository and live schemas before switching application behavior.

## Architecture

### Role and account provisioning

`users.role` supports:

- `business_owner`
- `investor`
- `relationship_manager`
- `admin`

Public registration remains restricted to business owners and investors. An authenticated administrator creates a relationship-manager account by supplying name, email, and a temporary password of at least six characters, matching the existing account minimum. The password is hashed with the same mechanism as other accounts, and the administrator communicates it outside the platform. Email delivery, forced password rotation, password reset, and manager account deletion are outside this phase.

Sign-in remains role-agnostic. After authentication, `relationship_manager` maps to `relationshipmanagerdashboard.html`.

### Conversation ownership

A conversation is a managed room for exactly one portfolio. Its assigned relationship manager is fixed when the room is created. The portfolio record is the canonical source of the business owner.

The manager dashboard returns:

- approved portfolios with active interests that do not yet have a room;
- active interests that are eligible to join the manager's existing rooms;
- rooms assigned to the current manager;
- active/archived state and unread counts.

Once a portfolio is claimed, it no longer appears as claimable to other managers. Other managers receive no participant data or message access for that room.

## Data model

### `conversations`

The target table contains:

- `id` primary key;
- `portfolio_id`, unique while present, referencing `portfolios(id)`;
- `relationship_manager_id`, referencing a `users` row whose role is `relationship_manager`;
- `title`, the portfolio-name snapshot used for archived-history display;
- `status ENUM('active','archived')`;
- nullable `archived_reason ENUM('manual','no_active_investors','portfolio_unapproved','portfolio_deleted')`;
- `created_at` and `updated_at`.

An active room requires a non-null approved portfolio and at least one active investor member. `portfolio_id` may become null on portfolio deletion so archived message history can be retained; the title snapshot remains available.

### `conversation_members`

The target table contains:

- composite primary key `(conversation_id, user_id)`;
- `member_role ENUM('relationship_manager','business_owner','investor')`;
- a generated nullable `singleton_role` that equals `member_role` only for relationship managers and business owners;
- `membership_status ENUM('active','removed')`;
- `joined_at`;
- nullable `left_at`;
- `visible_after_message_id`, defaulting to zero;
- `last_read_message_id`, defaulting to zero.

The existing unique constraint on `(conversation_id, member_role)` is removed because multiple investors are allowed. A unique `(conversation_id, singleton_role)` index uses MySQL's allowance for multiple null values to enforce at most one relationship manager and one business owner while allowing many investors. Application transactions additionally ensure that the manager membership matches `conversations.relationship_manager_id`, that the owner membership matches `portfolios.owner_id`, and that only eligible investors receive investor memberships.

Owner and manager memberships remain active for the lifetime of the room. Investor rows are retained after withdrawal with `membership_status='removed'`, which preserves sender identity and message integrity while denying access.

When an investor is first added or re-added, `visible_after_message_id` is set to the current highest message ID in the room and `last_read_message_id` is initialized to the same boundary. Thread queries for that investor return only messages with IDs greater than the visibility boundary. This avoids timestamp precision races and ensures a later investor cannot read earlier discussion.

### `messages`

After the approved chat reset, messages become group-only and contain:

- `id` primary key;
- non-null `conversation_id`;
- non-null `sender_id`;
- `content`;
- `created_at`.

The legacy `receiver_id`, duplicated `portfolio_id`, and scalar `read_at` fields are removed. A composite foreign key from `(conversation_id, sender_id)` to `conversation_members` preserves sender membership. The application additionally requires the sender's membership and the conversation itself to be active at send time.

Unread state is per member. A message is unread when its ID is greater than both that member's `last_read_message_id` and `visible_after_message_id`, excluding messages sent by that member.

### `notifications`

Notifications retain the live conversation/message foreign keys and add `conversation_created`, `conversation_member_added`, and `conversation_archived` to the type enum while preserving `new_message` and every existing non-chat type.

Each new message creates notifications for every other active member in the same transaction. Room creation notifies the owner and selected investors. Adding investors notifies every newly added investor and every pre-existing active member except the acting manager. Archiving notifies the other active members when the state actually changes. Notification rows include `related_portfolio_id`, `related_conversation_id`, `related_message_id` where applicable, and the acting `related_user_id`.

## Backend services and APIs

All identifiers are parsed as positive integers, all SQL is parameterized, and all multi-row workflows use one database connection and transaction.

### Administrator APIs

- `POST /api/admin/relationship-managers`
  - Admin only.
  - Accepts name, email, and temporary password.
  - Rejects duplicate email and invalid values.
  - Always creates role `relationship_manager`; the client cannot choose another role.
- `GET /api/admin/relationship-managers`
  - Admin only.
  - Returns safe account metadata without password hashes.

### Relationship-manager APIs

- `GET /api/relationship-manager/dashboard`
  - Relationship manager only.
  - Returns current-manager statistics, unclaimed eligible portfolios, eligible interests for owned rooms, and current-manager rooms.
- `POST /api/relationship-manager/conversations`
  - Relationship manager only.
  - Accepts a portfolio ID and one or more investor-interest IDs.
  - Locks the portfolio and relevant interest rows.
  - Requires an approved portfolio and active interests belonging to that portfolio.
  - Derives and inserts the owner, manager, and investor members atomically.
  - A unique portfolio constraint prevents simultaneous double claims.
  - Returns a clear conflict if another manager already claimed the portfolio.
- `POST /api/relationship-manager/conversations/:id/investors`
  - Assigned manager only.
  - Accepts one or more interest IDs, validates them against the conversation portfolio, and adds/reactivates memberships atomically.
  - Duplicate active additions are idempotent.
  - One invalid interest rejects the whole batch; an archived room stays archived until an explicit reopen succeeds.
  - Adding/reactivating investors in an archived room is allowed only while its portfolio is approved; it never reopens the room automatically.
- `PUT /api/relationship-manager/conversations/:id/archive`
  - Assigned manager only.
  - Archives the room without deleting history.
- `PUT /api/relationship-manager/conversations/:id/reopen`
  - Assigned manager only.
  - Requires an approved portfolio and at least one active member who still has an active interest.

### Conversation messaging APIs

- `GET /api/messages/conversations`
  - Lists only rooms accessible to the authenticated user.
  - Owners and assigned managers retain read-only access to archived rooms.
  - Removed investors receive no room listing.
- `GET /api/messages/conversations/:conversationId`
  - Verifies access and applies the current member's visibility boundary.
  - Returns active participants with names and role labels.
- `PUT /api/messages/conversations/:conversationId/read`
  - Validates that the requested cursor belongs to the same room and is visible to the caller.
  - Advances the current member's `last_read_message_id` with monotonic `GREATEST` semantics and marks corresponding `new_message` notifications read in the same transaction.
- `POST /api/messages/conversations/:conversationId/messages`
  - Requires an active room and active membership.
  - Accepts trimmed non-empty content up to 2,000 characters.
  - Inserts the message and all recipient notifications atomically.

The partner-based route and `receiver_id` request contract are removed after frontend migration.

## Lifecycle workflows

### Create a room

1. The manager chooses an unclaimed approved portfolio and at least one displayed interest.
2. The server locks and re-reads the portfolio and interests.
3. The server derives the portfolio owner and investor users.
4. The server inserts the room, owner membership, manager membership, investor memberships, and creation notifications in one transaction.
5. The client opens `messages.html?conversationId=<id>`.

### Add investors

1. The assigned manager opens the eligible-investor control.
2. The server accepts interest IDs, not arbitrary investor IDs.
3. It verifies every interest still exists and belongs to the approved portfolio.
4. Each new/reactivated investor receives a visibility boundary equal to the current latest room message.
5. The addition and notifications commit together.

### Withdraw interest

Interest removal becomes a transaction:

1. Lock the investor-interest row and related room/member rows.
2. Mark that investor membership removed and record `left_at`.
3. Delete the `investor_interests` row.
4. If no active investors remain, archive the room with reason `no_active_investors`.
5. Commit all changes together.

The removed investor immediately loses list, read, send, and notification access. Their conversation-linked notifications are deleted in the withdrawal transaction, and notification list/count queries exclude conversation-linked rows unless the caller still has room access. Their historical messages remain visible to members who still have access.

### Portfolio leaves approved state

Every route that changes an approved portfolio to any non-approved status locks and archives its room in the same transaction. Automatic disqualification reasons (`no_active_investors`, `portfolio_unapproved`, or `portfolio_deleted`) replace a prior `manual` reason when they occur. A non-approved portfolio cannot be reopened. Reapproval does not silently reopen a room; the assigned manager performs the explicit reopen action after eligibility is revalidated.

Before portfolio deletion, the delete workflow records `portfolio_deleted`, marks every investor membership removed because the corresponding interests will be deleted, removes their conversation-linked notifications, and then allows `portfolio_id` to become null. The portfolio-name snapshot, owner membership, manager membership, and message history remain. The historical room is read-only and can never be reopened without a portfolio.

### Archive and reopen

Archived rooms remain readable by the owner, assigned manager, and currently active investors but have a disabled composer. When a room has no active investors, the assigned manager may first add/reactivate eligible investors while the portfolio is approved; the room remains archived until the manager explicitly reopens it. Reopen succeeds only if the portfolio is approved and at least one active investor still has an active interest.

## Frontend design

### Homepage

The role section becomes an intentional four-card layout: four columns at wide desktop widths, two columns at medium widths, and one column on mobile. The relationship-manager card describes managed introductions and oversight and links to sign-in. Public signup does not offer that role.

### Administrator dashboard

The existing moderation dashboard gains a relationship-manager account panel. Its form includes name, email, and temporary password, displays field-level errors, disables while submitting, and refreshes a safe staff list after success.

### Relationship-manager dashboard

New files:

- `relationshipmanagerdashboard.html`
- `js/relationshipmanagerdashboard.js`

The approved visual direction uses existing Lumi5 Labs navigation, cards, badges, spacing, and responsive behavior. It contains:

- statistics for eligible interests, active rooms, businesses overseen, and unread messages;
- managed portfolio-room cards;
- owner and active-investor participant chips;
- eligible investors grouped by portfolio;
- Create Room, Add Investors, Open Group Chat, Archive, and Reopen actions;
- explicit empty, loading, and recoverable error states.

Only `relationship_manager` may remain on this page after the role check.

### Owner and investor flows

Direct-message entry points are removed. Portfolio and interest views show one of:

- `Awaiting Relationship Manager` when no room exists;
- `Open Managed Chat` when the user has active access;
- an archived/read-only state when applicable.

The backend supplies conversation IDs; the browser does not infer room access from query-string user IDs.

### Shared messages page

`messages.html` remains the shared conversation UI but becomes room-based:

- room cards are keyed by `conversation_id` and led by portfolio title;
- room metadata lists the business owner, assigned manager, and active investors;
- the manager receives manager-specific Dashboard and Messages navigation;
- the thread header shows participant names and roles;
- each bubble shows sender name, sender role, and time;
- a message sent by the authenticated user is right-aligned;
- every other participant's message is left-aligned;
- archived rooms disable the composer and explain why;
- send failures preserve the draft and keep the composer reusable;
- stale network responses cannot replace a more recently selected room;
- successful sends are reloaded from MySQL so refresh behavior matches the saved state.

## Error handling and concurrency

- Unauthorized roles and non-members receive `403` without leaking conversation data.
- Missing resources receive `404`; invalid input receives `400`; invalid state and claim conflicts receive `409`.
- A duplicate active investor addition returns the current state without creating duplicate membership or notifications.
- Unique constraints and row locks resolve simultaneous portfolio claims safely.
- Message and notification inserts roll back together.
- Room creation, membership changes, interest withdrawal, and portfolio-triggered archival roll back entirely on failure.
- Frontend mutations disable their initiating controls while pending and render actionable errors without discarding user input.
- Server logs contain contextual errors but never passwords, JWTs, or database credentials.

## Migration and reset

The migration is explicit, guarded, and reversible. MySQL DDL auto-commit behavior means backup and preflight occur before schema mutation.

1. Verify the exact live table definitions, role enum, row counts, target portfolio, target interests, and manager account.
2. Export schema and data for every mutated table—`users`, `conversations`, `conversation_members`, `messages`, and `notifications`—store the backup outside the public webroot, and verify the corresponding restore command before DDL begins.
3. Require an explicit deployment-only confirmation flag before destructive reset.
4. Delete message-related notifications first, including all legacy `new_message` rows, so foreign-key nulling cannot make them indistinguishable later.
5. Delete messages, conversation members, and conversations in foreign-key-safe order.
6. Reshape conversations for one unique portfolio and remove the single-investor column/constraint.
7. Reshape memberships for multiple investors, status, visibility, and unread state.
8. Convert messages to the group-only schema and remove direct-message columns.
9. Synchronize notification types and references.
10. Update `schema.sql`, the migration utility, and schema readiness checks so repository and live definitions agree.
11. Verify constraints, enums, indexes, and foreign keys—not column presence alone.

The reset must preserve users, portfolios, portfolio documents, investor interests, audit logs, and all unrelated notifications.

## Permanent demo seed

An idempotent seed command requires an explicit manager ID or email plus explicit portfolio and investor identifiers rather than relying only on display names. For the approved live seed it resolves and verifies:

- approved portfolio X3;
- owner Beta, derived from X3;
- existing relationship-manager account;
- active X3 interest for testing1.

It locks the target portfolio row before looking up or creating its conversation, then creates the room plus one deterministic, clearly labelled message from the manager, owner, and investor in a single transaction. On rerun, the portfolio lock serializes concurrent seed attempts; the command verifies the exact author/body tuples and returns the existing result. If it finds a partial or conflicting seed state, it refuses to guess or insert duplicates. Leticia l is deliberately not seeded into the room so the Add Investors workflow remains visibly testable.

## Verification strategy

### Automated tests

Tests cover:

- public registration rejecting `relationship_manager`;
- administrator-only manager account creation and password hashing;
- manager dashboard role isolation;
- room creation from approved interests only;
- server-derived owner/investor identity;
- one room per portfolio and concurrent claim conflicts;
- exactly one assigned manager and owner with multiple investors;
- idempotent additions and reactivation visibility boundaries;
- assigned-manager-only membership and status controls;
- participant-only list/read/send access;
- removed-investor denial;
- new-investor history filtering;
- per-member unread/read behavior;
- multi-recipient notification fan-out and rollback;
- automatic archive after last investor withdrawal;
- automatic archive when a portfolio leaves approved state;
- preserved read-only history after an archived portfolio is deleted;
- reopen eligibility;
- archived composer behavior;
- sender names and roles;
- own-message right alignment and other-message left alignment;
- draft preservation after failed send;
- stale-response protection;
- schema enum, index, uniqueness, nullability, and foreign-key requirements;
- guarded reset and idempotent seed contracts;
- exact frontend and backend deployment manifests.

### Live verification

A new self-cleaning four-role smoke test creates temporary admin, relationship manager, owner, investor, portfolio, interest, room, and messages; verifies role isolation, persistence, notifications, and archival; and then removes its records in foreign-key-safe order.

The release sequence is:

1. Run all local tests, syntax checks, dependency checks, and secret/origin scans.
2. Back up the live chat tables and current deployment.
3. Run the guarded chat reset and migration.
4. Deploy the private backend and staged frontend allowlist.
5. Verify health/readiness and run the self-cleaning four-role smoke through the public origin.
6. Seed the permanent X3/testing1 demo room.
7. Verify the demo through relationship-manager, owner, and investor sessions and confirm refresh persistence.
8. Confirm protected endpoints reject anonymous and wrong-role access and private server files remain non-public.
9. Merge and push only after live and local evidence is green.

If a critical check fails, restore the database backup and prior staged frontend/backend/service configuration rather than improvising a partial repair.

## Out of scope

- Public relationship-manager signup
- Multiple relationship managers in one room
- Multiple rooms for one portfolio
- Investors without an active interest
- Administrator access to private conversations
- Manager deletion or editing of messages
- Manual participant removal by the manager
- File attachments, calls, typing indicators, reactions, or real-time WebSockets
- Email invitations, password reset, or forced temporary-password rotation
- Migrating or retaining the legacy one-to-one messages
