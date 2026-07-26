# Five-Role Superadmin Assignment Workflow Design

**Date:** 2026-07-27

**Status:** Approved in conversation

**Target branch:** `main`

## Goal

Implement one coherent, database-backed workflow in which:

1. a business owner submits a portfolio;
2. an admin approves or rejects it;
3. a superadmin assigns an approved portfolio to a relationship manager;
4. the assigned manager oversees that portfolio's single group conversation;
5. one or more interested investors and the business owner participate in that
   conversation; and
6. every privileged assignment and staff-provisioning action is transactional,
   authorized, and permanently auditable.

The release must preserve all existing users, portfolios, interests,
conversations, memberships, messages, notifications, and moderation audit
records.

## Confirmed Product Decisions

### Roles

The application has exactly five roles:

- `business_owner`
- `investor`
- `relationship_manager`
- `admin`
- `superadmin`

Every user must have one of these roles. There is no default role, no role-less
account, and no UI or API for creating another superadmin.

### Strict staff separation

- Admins moderate portfolios. They approve or reject submissions and see only
  moderation audit history.
- Superadmins assign portfolios and provision admin or relationship-manager
  accounts. They see only superadmin audit history.
- Superadmins cannot approve or reject portfolios.
- Admins cannot assign portfolios or provision staff accounts.
- Existing admin accounts remain admins; none are converted to superadmin.

### Assignment and conversation rules

- Only approved portfolios may receive a new assignment or reassignment.
- A relationship manager sees only portfolios assigned to that manager.
- An assigned manager can read the portfolio's details and documents but cannot
  edit either.
- A portfolio may be assigned before it has investor interest.
- A portfolio has at most one conversation for its lifetime.
- The assigned relationship manager is the only manager who may create or
  manage that portfolio's conversation.
- The business owner is added automatically when the conversation is created.
- At least one currently interested investor must be selected at creation.
- Multiple interested investors may be selected at creation or added later.
- An investor can be manually removed by the assigned manager.
- Withdrawing interest immediately removes that investor's active access.
- Removed members and their messages are retained.
- A removed investor may be re-added only while a current interest exists.
- An investor added or re-added to an existing conversation sees messages from
  that join point forward. The relationship manager assigned through a
  reassignment is the exception and receives the full existing history.

### Reassignment and unassignment

- Reassignment changes the portfolio assignment and the existing
  conversation's active manager together.
- The previous manager immediately loses access.
- The new manager receives access to the full existing history.
- All other memberships and all messages remain unchanged.
- A portfolio may be unassigned only before a conversation exists.
- Once a conversation exists, the portfolio must be reassigned rather than
  unassigned.

### Portfolio status lifecycle

- If an assigned portfolio becomes `draft`, `pending`, or `rejected`, its
  assignment remains.
- Its conversation becomes archived and read-only with reason
  `portfolio_unapproved`.
- When the portfolio is approved again, the conversation automatically becomes
  active if it still has at least one active, interested investor.
- If it has no active investor, it remains archived until the assigned manager
  adds an eligible investor; that successful addition reactivates it.
- An assigned manager continues to see the portfolio and documents read-only
  while the conversation is archived.

## Chosen Architecture

### Assignment source of truth

`portfolios.relationship_manager_id` is the canonical current assignment.

Before a conversation exists, only the portfolio stores the assignment. After
one exists, the following invariant must always hold:

```text
portfolios.relationship_manager_id
  = conversations.relationship_manager_id
  = the sole active relationship_manager membership
```

Every operation that could affect this invariant uses one database connection,
row locks, and one transaction.

This approach is preferred over deriving assignment from conversations because
the product must support assignment before interest and before chat creation. A
separate assignment table was rejected because the live database already has
the canonical portfolio assignment column and a second current-assignment
record would create unnecessary synchronization risk.

### Service boundaries

The backend keeps responsibilities separate:

- portfolio moderation service: admin-only status changes, moderation audit,
  owner notifications, and conversation lifecycle changes;
- superadmin assignment service: assignment, reassignment, unassignment,
  assignment notifications, and superadmin audit;
- staff provisioning service: admin/RM creation and superadmin audit;
- managed conversation service: creation, investor membership changes,
  withdrawal effects, and archive/reactivation behavior;
- group message service: accessible room lists, thread loading, read cursors,
  sending, and message notifications.

Routes validate authentication, role, IDs, and request bodies, then delegate to
these services. Routes do not perform multi-step workflow writes themselves.

## Database Design

### Verified live baseline

The live MySQL 8.0.46 database was inspected after the manual migration. It
already has:

- the exact five-value, non-null `users.role` enum with no default;
- nullable `portfolios.relationship_manager_id` with a user foreign key;
- one conversation per portfolio through a unique index;
- active/removed conversation memberships;
- the corrected active-only generated singleton constraint;
- all required notification enum values; and
- `superadmin_audit_logs` with immutable ID/name/email snapshots.

All inspected assignment, role, membership, approval, interest, and active-chat
integrity checks returned zero violations. The source schema and schema
contract have not yet been updated to match this live database.

### Users

The canonical schema and metadata contract use:

```sql
role ENUM(
  'business_owner',
  'investor',
  'relationship_manager',
  'admin',
  'superadmin'
) NOT NULL
```

The application always supplies a role explicitly.

### Portfolios

`portfolios.relationship_manager_id` is nullable, indexed, and references
`users.id` with `ON DELETE SET NULL`.

The application, rather than a cross-table database constraint, verifies that:

- the referenced user has role `relationship_manager`; and
- assignment and reassignment targets are approved portfolios.

### Conversations and memberships

`conversations.portfolio_id` remains unique. A conversation is never duplicated
for a portfolio.

The stored generated membership key is active-only:

```sql
CASE
  WHEN membership_status = 'active'
   AND member_role IN ('relationship_manager', 'business_owner')
  THEN member_role
  ELSE NULL
END
```

The unique index on `(conversation_id, singleton_role)` therefore permits:

- one active relationship manager;
- one active business owner;
- multiple active investors; and
- any number of removed historical managers or investors.

The composite message-to-membership foreign key remains intact, so historical
members cannot be deleted while their messages exist.

### Investor interests

The existence of an `investor_interests` row means the interest is active.

- Manual chat removal changes only `conversation_members`; the interest remains,
  so the manager may re-add that investor.
- Investor withdrawal marks the membership removed and deletes the interest row
  in the same transaction.
- Expressing interest again creates the interest row again and makes that
  investor eligible for a future re-add.

### Superadmin audit history

`superadmin_audit_logs` records these action values:

- `portfolio_assigned`
- `portfolio_reassigned`
- `portfolio_unassigned`
- `admin_account_created`
- `relationship_manager_account_created`

Each event records the acting superadmin, event timestamp, and the applicable
portfolio, previous manager, new manager, or created user. Live foreign-key
references use `ON DELETE SET NULL`; immutable ID, name, and email snapshots
preserve the permanent historical identity.

The application never exposes update or delete operations for this table.
Assignment and account-creation writes insert their audit event in the same
transaction as the primary action.

### Notifications

The canonical notification enum includes the existing values plus:

- `portfolio_assigned`
- `portfolio_reassigned`
- `portfolio_unassigned`
- `conversation_member_removed`

Notification recipients are:

- new interest: business owner and assigned manager, or only the owner while
  unassigned;
- assignment: new manager and business owner;
- reassignment: previous manager, new manager, and business owner;
- unassignment: previous manager and business owner;
- conversation creation: owner and selected investors;
- investor addition: added investors and existing active participants other
  than the acting manager;
- manual investor removal: removed investor and business owner;
- investor withdrawal: assigned manager and business owner;
- conversation archival: active members other than the actor; and
- new message: every other active member.

Repeated no-op requests do not create duplicate audit events or notifications.

### Reproducible source and migration

The repository must be updated so that:

- `backend/schema.sql` creates the verified final schema from scratch;
- `backend/src/schema-contract.js` recognizes that exact schema;
- the production-schema fixture reflects all ten tables and final metadata; and
- a dedicated, data-preserving five-role workflow migration can safely verify
  an already-migrated live database or apply only missing additive changes.

When upgrading a pre-assignment database, the migration first rejects any case
where a non-null portfolio manager conflicts with its conversation manager. It
then backfills only null portfolio assignments from the existing conversation
manager. This preserves every existing managed room and its current manager.

The destructive managed-chat reset migration is not used for this release.
No migration may convert `superadmin` users to `admin`, reset conversations, or
delete messages.

## Authorization Matrix

| Capability | Business owner | Investor | Relationship manager | Admin | Superadmin |
|---|---:|---:|---:|---:|---:|
| Create/edit own editable portfolio | Yes | No | No | No | No |
| Submit own portfolio | Yes | No | No | No | No |
| Express/withdraw own interest | No | Yes | No | No | No |
| Approve/reject portfolio | No | No | No | Yes | No |
| Assign/reassign/unassign portfolio | No | No | No | No | Yes |
| Create admin/RM accounts | No | No | No | No | Yes |
| Read assigned portfolio/documents | Owner only | Approved catalog rules | Yes, read-only | Review queue | Assignment view |
| Create/manage assigned conversation | No | No | Yes | No | No |
| Send messages | Active member | Active member | Active member | No | No |
| View moderation audit | No | No | No | Yes | No |
| View superadmin audit | No | No | No | No | Yes |

Both page guards and API middleware enforce this matrix. Hiding a button is
never treated as authorization.

## API Design

### Superadmin routes

All routes are mounted under `/api/superadmin` and require
`requireRole('superadmin')`.

- `GET /stats`: user totals, portfolio assignment totals, and RM workload.
- `GET /portfolio-assignments`: approved portfolios plus any retained
  assignments in other statuses, including chat existence and allowed actions.
- `GET /relationship-managers`: safe manager metadata for workload and
  selection.
- `GET /staff`: safe admin and manager account metadata.
- `POST /staff`: create one `admin` or `relationship_manager`.
- `PUT /portfolios/:id/assignment`: assign or reassign using
  `relationship_manager_id`.
- `DELETE /portfolios/:id/assignment`: unassign only if no conversation exists.
- `GET /audit-logs`: paginated superadmin audit history.

`POST /staff` uses the current account-validation rules:

- trimmed name, 1-100 characters;
- normalized valid email, at most 255 characters;
- explicit password, 6-128 characters;
- role restricted to `admin` or `relationship_manager`; and
- bcrypt cost 10.

Duplicate email returns `409`. Password hashes and secrets are never returned.

### Admin routes

Existing `/api/admin` moderation routes remain admin-only. The
relationship-manager creation route and staff directory are removed from this
namespace and from the admin UI.

Admin approval and rejection remain transactional and write only to
`audit_logs`.

### Relationship-manager routes

All routes remain under `/api/relationship-manager` and require
`requireRole('relationship_manager')`.

- `GET /dashboard`: only assigned portfolios, full portfolio summary, chat
  state, interested investors, active participants, and allowed actions.
- `GET /portfolios/:portfolioId`: assigned portfolio details and document
  metadata.
- authenticated document download reuses the existing document service with an
  assigned-manager authorization branch.
- `POST /conversations`: create the assigned portfolio's single conversation
  from one or more eligible `interest_ids`.
- `POST /conversations/:conversationId/investors`: add or reactivate one or more
  eligible investors.
- `DELETE /conversations/:conversationId/investors/:investorId`: manually
  remove one investor while preserving history.

The manager's manual archive/reopen controls are removed from the primary
workflow. Archive/reactivation is derived from portfolio approval and active
eligible membership, preventing chat state from contradicting portfolio state.

### Interest and message routes

`POST /api/interests/:portfolioId` notifies both the owner and assigned manager.

`DELETE /api/interests/:portfolioId` atomically removes chat access, preserves
messages, deletes the current interest, and archives the conversation if no
active investor remains.

The existing `/api/messages` routes remain membership-based. Removed members
receive `403`; archived conversations may be read by active members but reject
sends with `409`.

## Transactional Workflows

### Assignment

1. Lock the portfolio and acting superadmin.
2. Verify the portfolio is approved.
3. Verify the selected user is a relationship manager.
4. Verify no conversation exists for an initial assignment.
5. Set `portfolios.relationship_manager_id`.
6. Insert the audit snapshot.
7. Insert owner and manager notifications.
8. Commit.

Selecting the already assigned manager returns `200` with `changed: false` and
does not create another audit event or notification.

### Reassignment

1. Lock the portfolio, conversation, old/new users, and relevant memberships.
2. Verify the portfolio is approved and the new user is a relationship manager.
3. Set the portfolio and conversation manager IDs.
4. Mark the old manager membership `removed` with `left_at=NOW()`.
5. Insert or reactivate the new manager membership with full-history visibility.
6. Preserve owner/investor memberships and every message.
7. Insert the reassignment audit snapshot.
8. Notify the old manager, new manager, and owner.
9. Commit.

The active-only singleton constraint protects against two active managers.

### Unassignment

1. Lock the portfolio and check for a conversation.
2. Reject with `409` if a conversation exists.
3. Clear the portfolio assignment.
4. Insert the unassignment audit snapshot.
5. Notify the previous manager and owner.
6. Commit.

### Conversation creation

1. Lock and verify the assigned manager and approved portfolio.
2. Verify the acting manager equals the portfolio assignment.
3. Reject if a conversation already exists.
4. Lock and verify all selected interests still belong to that portfolio.
5. Insert the conversation using the assigned manager.
6. Insert manager, owner, and selected investor memberships.
7. Insert creation notifications.
8. Commit.

### Investor membership changes

Manual removal marks the membership removed and sets `left_at`; it does not
delete the interest or messages. Withdrawal performs the membership change and
interest deletion together. The last active investor causes automatic
`no_active_investors` archival.

Adding an eligible investor inserts or reactivates the membership using the
current latest message as the visibility boundary. If the portfolio is
approved and the room was automatically archived for no active investors, the
successful addition reactivates the same room.

### Approval lifecycle

Editing an approved portfolio returns it to draft and archives its conversation
without clearing its manager. Submission leaves the assignment in place.
Admin rejection keeps the assignment and archived chat.

Admin approval reactivates a `portfolio_unapproved` conversation only when at
least one active investor still has a current interest. Manual membership and
message history remain untouched.

## Frontend Design

### Entry routing

Login and index routing recognize all five roles:

- business owner → existing owner dashboard;
- investor → existing investor dashboard;
- relationship manager → relationship-manager dashboard;
- admin → moderator dashboard; and
- superadmin → superadmin dashboard.

Each protected page calls the shared role guard before loading page data.

### Superadmin dashboard

The dashboard contains:

- summary cards;
- RM workload;
- approved/unassigned portfolios;
- retained assignments and current status;
- assign, reassign, and permitted unassign actions;
- admin and RM account-creation forms using shared validation;
- safe staff directories; and
- superadmin audit history.

Unavailable actions remain visible but disabled with a short reason. For
example, unassignment displays "Reassign required because this portfolio
already has a chat."

### Admin dashboard

The moderator dashboard contains only:

- pending portfolio review;
- approve/reject controls;
- moderation statistics; and
- moderation audit history.

All staff-creation and assignment UI is removed.

### Relationship-manager dashboard

Every assigned portfolio card shows:

- owner, status, assignment, and chat state;
- portfolio details and document links;
- current active participants;
- currently interested, eligible investors; and
- an action with a reason when disabled.

"Create chat" is disabled until the portfolio is approved and at least one
interest is selected. Multi-select supports one or more investors.

### Messaging UI

The existing messaging rules remain:

- the signed-in user's messages appear on the right;
- every other participant's messages appear on the left;
- sender name and role identify each message;
- current participant names appear at the top;
- removed members are absent from the active participant list;
- archived rooms remain readable but the composer is disabled; and
- sending one message never removes or replaces the composer.

All changed pages remain responsive at desktop and 390-pixel mobile widths,
avoid horizontal overflow, use pinned frontend dependencies, and use the
repository's release-key convention for changed assets.

## Errors and Concurrency

Workflow operations return:

- `400` for malformed IDs, bodies, or unsupported account roles;
- `401` for missing/invalid authentication;
- `403` for wrong role, wrong assigned manager, or removed chat membership;
- `404` for resources that do not exist within the authorized workflow;
- `409` for stale state, disallowed status, existing chat, ineligible interest,
  forbidden unassignment, archived send, or concurrent workflow change; and
- `500` with a generic response for unexpected server failures.

Transactions lock rows in a consistent portfolio-first order. Unique indexes
remain the final defense against duplicate rooms or singleton participants.
Duplicate-key races are translated to stable `409` workflow errors rather than
raw database failures.

Every database error rolls back primary writes, audit rows, and notifications
together. Rollback errors are logged without hiding the original error.

## Merge and Release Strategy

The local `main` branch is four commits behind `origin/main`. The remote work
contains useful UI changes and an incomplete superadmin assignment feature.
Implementation must integrate the latest remote commits while replacing unsafe
direct-update and incomplete migration behavior with this design.

The merge must preserve:

- the teammate's unrelated admin modal/sign-out and investor score styling;
- the superadmin page direction where compatible;
- the final five-role contract;
- the verified live database; and
- all existing chat history.

The release allowlist/runtime manifest must include every final superadmin
route, page, and script. It must not omit a backend module required by
`server.js`.

Deployment order:

1. fetch and integrate latest `origin/main` on `main`;
2. implement through failing tests and focused commits;
3. run the complete local suite and static checks;
4. take and verify a live database/backend/frontend backup;
5. run the data-preserving schema verifier/migration, which should recognize the
   already-migrated live database;
6. deploy the allowlisted backend and frontend files;
7. restart only `lumilabs-backend.service`;
8. require both `/api/health` and `/api/ready` to return `200`;
9. run role-specific API and signed-in browser smoke tests; and
10. push the verified `main` commit to Git.

No production reset, message deletion, account conversion, or broad SFTP
cleanup is part of this feature release.

## Testing and Acceptance

### Automated tests

The suite must cover:

- exact ten-table schema metadata and five-role enum;
- additive migration from the prior source schema and no-op verification of the
  already-migrated live shape;
- no destructive chat-reset path in this release;
- authentication and authorization for all five roles on every changed route;
- strict admin/superadmin capability separation;
- account validation, bcrypt hashing, duplicate email, and audit rollback;
- approved-only assignment/reassignment;
- pre-chat unassignment and post-chat rejection;
- RM assignment visibility and read-only document authorization;
- chat creation with one and multiple investors;
- duplicate creation and concurrent creation;
- manual investor removal, re-add, withdrawal, and preserved messages;
- automatic archive/reactivation rules;
- reassignment membership transfer and full manager history;
- audit snapshots and exact notification recipients;
- archived read access and send rejection;
- page role guards, disabled-action explanations, escaping, and recovery states;
- messaging left/right alignment and persistent composer; and
- runtime manifest completeness.

### Signed-in walkthroughs

Use the provided test accounts without writing credentials into source or test
fixtures. Verify:

1. business-owner submission;
2. admin approval;
3. superadmin assignment;
4. assigned-manager read-only portfolio/document access;
5. disabled chat creation without interest;
6. investor interest and dual notification;
7. multi-investor chat creation;
8. message persistence and sender layout;
9. investor removal and withdrawal access revocation;
10. reassignment and old/new manager access;
11. portfolio status archival/reactivation; and
12. strict wrong-role redirects and API denials.

Run desktop and 390-pixel browser checks with no console errors or horizontal
overflow. Live smoke tests must not delete existing data.

### Completion criteria

The feature is complete only when:

- the repository schema exactly matches the verified live schema;
- `/api/health` and `/api/ready` both return `200`;
- every automated test passes;
- every five-role signed-in walkthrough passes;
- current production messages remain present;
- Git `main`, deployed frontend, deployed backend, and the live database agree;
  and
- assignment, account creation, notifications, and audit history operate
  transactionally as specified.
