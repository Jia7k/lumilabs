# Relationship Manager and Managed Group Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add administrator-provisioned relationship managers, one overseen multi-investor room per approved portfolio, persistent MySQL group messages, and the complete eligibility/archive lifecycle without retaining the legacy direct-message model.

**Architecture:** Reconcile the repository and live database with a guarded chat-only reset, then put every multi-row room operation behind transaction services with row locks and database constraints. Expose role-scoped Express routes that return conversation IDs and participant metadata, and refactor the shared messages page plus a new relationship-manager dashboard around those room contracts. Keep the public frontend static and origin-relative through the existing `/api` reverse proxy.

**Tech Stack:** Node.js 24, Express 4, MySQL 8/InnoDB through `mysql2/promise`, JWT, bcryptjs, express-validator, static HTML/CSS/vanilla JavaScript, Node's built-in `node:test`, Apache reverse proxy, systemd, SFTP/SSH deployment.

## Global Constraints

- Public registration remains limited to `business_owner` and `investor`; only an administrator may create `relationship_manager` accounts.
- Each approved portfolio has at most one room, one owner, one assigned relationship manager, and one or more active investors with active interest records in that portfolio.
- The server accepts interest IDs and derives owner/investor identities; it never accepts arbitrary member user IDs from a client.
- Only the assigned manager, portfolio owner, and active investor members can access a room; administrators and other relationship managers cannot read it.
- New and reactivated investors see only messages with IDs greater than their newest `visible_after_message_id` boundary.
- The authenticated user's messages render on the right; all other messages render on the left with sender name and role.
- Only active rooms accept messages. Archived rooms preserve readable history for the owner, assigned manager, and currently active investors.
- Automatic archive reasons are exactly `no_active_investors`, `portfolio_unapproved`, and `portfolio_deleted`; manual archive uses `manual`.
- A room can reopen only when its portfolio still exists and is approved and at least one active investor still has an active interest.
- Reset only chat data: preserve users, portfolios, portfolio documents, investor interests, audit logs, and unrelated notifications.
- All identifiers are positive integers, message content is trimmed, non-empty, and at most 2,000 characters, and all SQL remains parameterized.
- Every room creation, membership change, message/notification fan-out, interest withdrawal, and portfolio-triggered archive is atomic and rollback-safe.
- Frontend requests remain same-origin through `window.LUMILABS_API_BASE || '/api'`; no localhost, raw production IP, credentials, tokens, or passwords may be committed.
- The permanent demo is X3 + Beta + testing1 + an explicitly selected existing relationship manager; leticia l remains outside the seeded room for Add Investors testing.
- Use `frontend-design` while implementing Tasks 8–10 so the new interface follows the approved Lumi5 visual direction and remains responsive and accessible.
- Before Task 1, invoke `superpowers:using-git-worktrees` and create an isolated feature worktree/branch from the current reviewed commit; do not implement directly on `main`.

## File and Responsibility Map

### Create

- `backend/src/services/managed-conversation-workflow.js` — transaction boundary for room creation, membership, status, withdrawal, and portfolio lifecycle hooks.
- `backend/src/services/group-message-workflow.js` — access-controlled room listing, thread loading, unread cursor updates, and message/notification fan-out.
- `backend/src/routes/relationship-manager.js` — relationship-manager dashboard and room-management HTTP endpoints.
- `backend/scripts/migrate-managed-chat.js` — guarded live chat reset and target-schema migration.
- `backend/scripts/seed-managed-chat.js` — idempotent permanent X3/testing1 demo seed.
- `backend/scripts/live-four-role-smoke.js` — self-cleaning public-origin smoke for all four roles.
- `relationshipmanagerdashboard.html` — protected relationship-manager workspace.
- `js/relationshipmanagerdashboard.js` — manager dashboard state, rendering, selections, and mutations.
- `backend/test/managed-chat-schema.test.js` — schema, reset guard, enum, key, and foreign-key contracts.
- `backend/test/managed-conversation-workflow.test.js` — room creation/add/archive/reopen transaction behavior.
- `backend/test/managed-conversation-lifecycle.test.js` — withdrawal and portfolio state/delete behavior.
- `backend/test/group-message-workflow.test.js` — access, visibility, unread, send, and notification behavior.
- `backend/test/relationship-manager-route.test.js` — manager role isolation and dashboard/room route contracts.
- `backend/test/relationship-manager-admin.test.js` — administrator provisioning/listing behavior.
- `backend/test/relationship-manager-client.test.js` — manager dashboard DOM/client behavior.
- `backend/test/managed-messages-client.test.js` — room-based messages client behavior.
- `backend/test/managed-chat-seed.test.js` — deterministic seed validation and idempotency.

### Modify

- `backend/schema.sql` — authoritative four-role managed-chat schema.
- `backend/migrate.js` — delegate to the guarded managed-chat migrator instead of the obsolete partial migration.
- `backend/package.json` — migration, seed, and four-role smoke commands.
- `backend/src/schema-contract.js` — readiness checks for columns, enum values, nullability, indexes, and foreign keys.
- `backend/server.js` — mount `/api/relationship-manager`.
- `backend/src/routes/admin.js` — manager account create/list APIs.
- `backend/src/routes/auth.js` — retain and regression-test the two public signup roles.
- `backend/src/routes/interests.js` — transactional withdrawal and managed-room metadata in interest responses.
- `backend/src/routes/messages.js` — replace partner endpoints with room endpoints.
- `backend/src/routes/notifications.js` — suppress room notifications from users without current room access.
- `backend/src/routes/dashboard.js` — managed-room message/unread counts for owner and investor.
- `backend/src/routes/portfolios.js` — transactional approved-to-draft archive hooks, manager document access, and managed-room metadata.
- `backend/src/services/workflow.js` — use shared lifecycle hooks during submit/moderation/update flows.
- `backend/src/services/document-workflow.js` — archive or detach rooms in the same transaction as document/status/delete changes.
- `index.html`, `css/style.css`, `js/script.js` — four-role homepage and relationship-manager login redirect.
- `moderatordashboard.html`, `js/moderatordashboard.js`, `js/api.js` — administrator manager-provisioning panel and all new API helpers.
- `messages.html`, `js/messages.js` — conversation-ID UI with participants, roles, archival state, and reusable composer.
- `businessownerdashboard.html`, `js/browse.js`, `js/my-interests.js`, `js/mybusinesses.js`, `js/investordashboard.js` — remove direct-message shortcuts and expose server-provided managed-room states.
- `backend/deploy/runtime-manifest.txt` — exact deployment allowlist for new/renamed runtime files.
- Existing tests under `backend/test/` — replace one-to-one expectations with managed-room contracts while preserving unrelated coverage.

## Shared Interfaces and Response Shapes

Use these names and shapes exactly across tasks:

```js
// backend/src/services/managed-conversation-workflow.js
class ManagedConversationError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

createManagedConversation({ database, managerId, portfolioId, interestIds })
// -> { conversation_id, portfolio_id, title, status, archived_reason,
//      owner: { id, name }, manager: { id, name },
//      investors: [{ id, name, interest_id }] }

addManagedInvestors({ database, managerId, conversationId, interestIds })
// -> { conversation_id, added_investor_ids: number[], participants: Participant[] }

archiveManagedConversation({ database, managerId, conversationId })
// -> { conversation_id, status: 'archived',
//      archived_reason: 'manual'|'no_active_investors'|'portfolio_unapproved'|'portfolio_deleted',
//      changed: boolean }

reopenManagedConversation({ database, managerId, conversationId })
// -> { conversation_id, status: 'active', archived_reason: null, changed: boolean }

withdrawInvestorInterest({ database, investorId, portfolioId })
// -> { removed: true, conversation_id: number|null, archived: boolean }

archiveConversationForPortfolio(connection, portfolioId, reason, actorId)
// -> { conversationId: number|null, changed: boolean }

prepareConversationForPortfolioDeletion(connection, portfolioId, actorId)
// -> { conversationId: number|null, changed: boolean }
```

```js
// backend/src/services/group-message-workflow.js
listAccessibleConversations({ database, userId }) // -> ConversationSummary[]
loadConversationThread({ database, userId, conversationId }) // -> ConversationThread
markConversationRead({ database, userId, conversationId, messageId })
// -> { conversation_id, last_read_message_id }
sendConversationMessage({ database, user, conversationId, content }) // -> Message
```

The shared value types are:

```js
// Participant
{ id: number, name: string, role: 'relationship_manager'|'business_owner'|'investor' }

// Message
{
  id: number, conversation_id: number, sender_id: number,
  sender_name: string,
  sender_role: 'relationship_manager'|'business_owner'|'investor',
  content: string, created_at: string,
}

// ConversationSummary
{
  id: number, portfolio_id: number|null, title: string,
  status: 'active'|'archived',
  archived_reason: 'manual'|'no_active_investors'|'portfolio_unapproved'|'portfolio_deleted'|null,
  unread_count: number, participants: Participant[],
  latest_message: null|{
    id: number, sender_id: number, sender_name: string,
    content: string, created_at: string,
  },
}

// ConversationThread
{ conversation: ConversationSummary & { can_send: boolean }, participants: Participant[], messages: Message[] }
```

```json
{
  "conversation": {
    "id": 12,
    "portfolio_id": 1,
    "title": "X3",
    "status": "active",
    "archived_reason": null,
    "can_send": true,
    "unread_count": 0,
    "latest_message": {
      "id": 44,
      "sender_id": 8,
      "sender_name": "Relationship Manager",
      "content": "Welcome to the managed X3 conversation.",
      "created_at": "2026-07-22T13:00:00.000Z"
    }
  },
  "participants": [
    { "id": 8, "name": "Relationship Manager", "role": "relationship_manager" },
    { "id": 3, "name": "Beta", "role": "business_owner" },
    { "id": 6, "name": "testing1", "role": "investor" }
  ],
  "messages": [
    {
      "id": 44,
      "conversation_id": 12,
      "sender_id": 8,
      "sender_name": "Relationship Manager",
      "sender_role": "relationship_manager",
      "content": "Welcome to the managed X3 conversation.",
      "created_at": "2026-07-22T13:00:00.000Z"
    }
  ]
}
```

---

### Task 1: Target Schema, Guarded Chat Reset, and Readiness Contract

**Files:**
- Create: `backend/scripts/migrate-managed-chat.js`
- Create: `backend/test/managed-chat-schema.test.js`
- Modify: `backend/schema.sql`
- Modify: `backend/migrate.js`
- Modify: `backend/package.json`
- Modify: `backend/src/schema-contract.js`
- Modify: `backend/test/schema-contract.test.js`

**Interfaces:**
- Consumes: MySQL 8 `information_schema`, the two exact deployment flags below, and the current pool/connection environment used by `backend/migrate.js`.
- Produces: `CHAT_RESET_CONFIRMATION`, `BACKUP_CONFIRMATION`, `assertMigrationGuards(environment)`, `migrateManagedChat(database, environment)`, and an expanded `verifySchema(database)`.

- [ ] **Step 1: Write failing schema and guard tests**

Create tests that read `backend/schema.sql` and the migration module and assert all target properties, including exact guard behavior:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = require('../scripts/migrate-managed-chat');
const schema = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');

test('managed chat migration requires backup and exact destructive confirmation', () => {
  assert.throws(() => migration.assertMigrationGuards({}), /backup/i);
  assert.throws(() => migration.assertMigrationGuards({
    CHAT_BACKUP_VERIFIED: migration.BACKUP_CONFIRMATION,
  }), /chat reset confirmation/i);
  assert.equal(migration.assertMigrationGuards({
    CHAT_BACKUP_VERIFIED: migration.BACKUP_CONFIRMATION,
    CONFIRM_CHAT_RESET: migration.CHAT_RESET_CONFIRMATION,
  }), true);
});

test('authoritative schema supports one portfolio room and multiple investors', () => {
  assert.match(schema, /relationship_manager/);
  assert.match(schema, /UNIQUE KEY unique_conversation_portfolio \(portfolio_id\)/);
  assert.match(schema, /singleton_role/);
  assert.match(schema, /UNIQUE KEY unique_conversation_singleton \(conversation_id, singleton_role\)/);
  assert.match(schema, /visible_after_message_id BIGINT UNSIGNED NOT NULL DEFAULT 0/);
  assert.match(schema, /last_read_message_id BIGINT UNSIGNED NOT NULL DEFAULT 0/);
  const messagesTable = schema.match(
    /CREATE TABLE(?: IF NOT EXISTS)? messages \(([\s\S]*?)CREATE TABLE(?: IF NOT EXISTS)? notifications/,
  )[1];
  assert.doesNotMatch(messagesTable, /receiver_id/);
  assert.doesNotMatch(messagesTable, /read_at/);
});
```

In `backend/test/schema-contract.test.js`, extend the fake database to return columns, indexes, and foreign keys and assert failures for a missing notification enum member, nullable `messages.conversation_id`, missing unique portfolio index, missing singleton index, and missing `(conversation_id,sender_id)` foreign key.

- [ ] **Step 2: Run the focused tests and confirm the old schema fails**

Run:

```bash
cd backend
node --test test/managed-chat-schema.test.js test/schema-contract.test.js
```

Expected: FAIL because the migration module and managed-chat tables do not exist and `verifySchema` checks only column names.

- [ ] **Step 3: Replace the authoritative chat schema**

Update `backend/schema.sql` with these exact logical definitions; preserve all non-chat tables and existing portfolio fields:

```sql
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(100) NOT NULL,
  role ENUM('business_owner','investor','relationship_manager','admin')
    NOT NULL DEFAULT 'business_owner',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE conversations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  portfolio_id INT NULL,
  relationship_manager_id INT NOT NULL,
  title VARCHAR(255) NOT NULL,
  status ENUM('active','archived') NOT NULL DEFAULT 'active',
  archived_reason ENUM('manual','no_active_investors','portfolio_unapproved','portfolio_deleted') NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_conversation_portfolio (portfolio_id),
  CONSTRAINT fk_conversations_portfolio FOREIGN KEY (portfolio_id)
    REFERENCES portfolios(id) ON DELETE SET NULL,
  CONSTRAINT fk_conversations_manager FOREIGN KEY (relationship_manager_id)
    REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE conversation_members (
  conversation_id INT NOT NULL,
  user_id INT NOT NULL,
  member_role ENUM('relationship_manager','business_owner','investor') NOT NULL,
  singleton_role VARCHAR(24)
    GENERATED ALWAYS AS (
      CASE WHEN member_role IN ('relationship_manager','business_owner')
           THEN member_role ELSE NULL END
    ) STORED,
  membership_status ENUM('active','removed') NOT NULL DEFAULT 'active',
  joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  left_at TIMESTAMP NULL,
  visible_after_message_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
  last_read_message_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (conversation_id, user_id),
  UNIQUE KEY unique_conversation_singleton (conversation_id, singleton_role),
  KEY idx_members_user_status (user_id, membership_status),
  CONSTRAINT fk_members_conversation FOREIGN KEY (conversation_id)
    REFERENCES conversations(id) ON DELETE CASCADE,
  CONSTRAINT fk_members_user FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  conversation_id INT NOT NULL,
  sender_id INT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_messages_conversation_id (conversation_id, id),
  CONSTRAINT fk_messages_member FOREIGN KEY (conversation_id, sender_id)
    REFERENCES conversation_members(conversation_id, user_id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  type ENUM(
    'new_message','new_interest','portfolio_approved','portfolio_rejected',
    'portfolio_needs_changes','portfolio_submitted','conversation_created',
    'conversation_member_added','conversation_archived'
  ) NOT NULL,
  title VARCHAR(255) NOT NULL,
  body TEXT NULL,
  related_portfolio_id INT NULL,
  related_conversation_id INT NULL,
  related_message_id INT NULL,
  related_user_id INT NULL,
  read_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_notifications_user (user_id),
  KEY idx_notifications_portfolio (related_portfolio_id),
  KEY idx_notifications_conversation (related_conversation_id),
  KEY idx_notifications_message (related_message_id),
  KEY idx_notifications_related_user (related_user_id),
  CONSTRAINT fk_notifications_user FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_notifications_portfolio FOREIGN KEY (related_portfolio_id)
    REFERENCES portfolios(id) ON DELETE SET NULL,
  CONSTRAINT fk_notifications_conversation FOREIGN KEY (related_conversation_id)
    REFERENCES conversations(id) ON DELETE SET NULL,
  CONSTRAINT fk_notifications_message FOREIGN KEY (related_message_id)
    REFERENCES messages(id) ON DELETE SET NULL,
  CONSTRAINT fk_notifications_related_user FOREIGN KEY (related_user_id)
    REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```

- [ ] **Step 4: Implement the guarded reset/migration**

Export constants and functions and run only when invoked directly:

```js
const CHAT_RESET_CONFIRMATION = 'RESET_LUMILABS_CHAT_ONLY_20260722';
const BACKUP_CONFIRMATION = 'BACKUP_AND_RESTORE_COMMAND_VERIFIED';

function assertMigrationGuards(environment) {
  if (environment.CHAT_BACKUP_VERIFIED !== BACKUP_CONFIRMATION) {
    throw new Error('Verified chat backup is required before migration');
  }
  if (environment.CONFIRM_CHAT_RESET !== CHAT_RESET_CONFIRMATION) {
    throw new Error('Exact chat reset confirmation is required');
  }
  return true;
}
```

`migrateManagedChat(database, environment)` must:

1. call `assertMigrationGuards` before its first write;
2. verify that `users`, `portfolios`, `investor_interests`, `notifications`, and `audit_logs` exist;
3. record pre-reset counts for users, portfolios, interests, documents, audit logs, unrelated notifications, and chat-related notifications;
4. delete notifications where `type IN ('new_message','conversation_created','conversation_member_added','conversation_archived') OR related_conversation_id IS NOT NULL OR related_message_id IS NOT NULL`;
5. discover and drop only notification foreign keys referencing `messages` or `conversations` through `information_schema.KEY_COLUMN_USAGE`;
6. drop `messages`, `conversation_members`, and `conversations` in that order and recreate them with the SQL above;
7. alter `users.role`, add notification reference columns with `ADD COLUMN IF NOT EXISTS`, alter the notification enum, and recreate named indexes/foreign keys only when absent;
8. call `verifySchema(database)`;
9. compare protected row counts and throw if users, portfolios, interests, documents, audit logs, or unrelated notifications changed.

Do not wrap the DDL in a false transaction promise; MySQL DDL auto-commits. `backend/migrate.js` should open the existing SSH tunnel, call the exported migrator, close both resources in `finally`, and never call `process.exit()` before cleanup.

Add scripts:

```json
{
  "migrate:managed-chat": "node migrate.js",
  "seed:managed-chat": "node scripts/seed-managed-chat.js",
  "smoke:live": "node scripts/live-four-role-smoke.js"
}
```

- [ ] **Step 5: Expand readiness verification beyond column presence**

Have `verifySchema(database)` query `information_schema.COLUMNS`, `STATISTICS`, and `KEY_COLUMN_USAGE`. Require:

- four values in `users.role`;
- exact conversation and member status/archive enums;
- non-null `messages.conversation_id`, `messages.sender_id`, `messages.content`;
- no direct-message columns in `messages`;
- unique `conversations(portfolio_id)`;
- unique `conversation_members(conversation_id,singleton_role)`;
- primary `conversation_members(conversation_id,user_id)`;
- foreign keys for conversation portfolio/manager, member conversation/user, message member, and notification conversation/message;
- all nine notification enum values.

Normalize uppercase/lowercase information-schema property names as the current contract does and throw one error listing every missing invariant.

- [ ] **Step 6: Run schema tests and the complete suite**

Run:

```bash
cd backend
node --test test/managed-chat-schema.test.js test/schema-contract.test.js
npm test
```

Expected: focused tests and the complete existing suite PASS. If an old schema assertion fails, update that assertion in this task so the repository remains green after the schema foundation commit; do not accept an expected cross-task failure.

- [ ] **Step 7: Commit the schema foundation**

```bash
git add backend/schema.sql backend/migrate.js backend/package.json backend/src/schema-contract.js backend/scripts/migrate-managed-chat.js backend/test/managed-chat-schema.test.js backend/test/schema-contract.test.js
git commit -m "feat: define managed group chat schema"
```

### Task 2: Transactional Room Creation, Membership, Archive, and Reopen

**Files:**
- Create: `backend/src/services/managed-conversation-workflow.js`
- Create: `backend/test/managed-conversation-workflow.test.js`

**Interfaces:**
- Consumes: the target schema from Task 1 and the exact service signatures in Shared Interfaces.
- Produces: `ManagedConversationError`, `createManagedConversation`, `addManagedInvestors`, `archiveManagedConversation`, and `reopenManagedConversation`.

- [ ] **Step 1: Write failing transaction-service tests**

Use a scripted fake `database.getConnection()` that records `beginTransaction`, ordered parameterized queries, `commit`, `rollback`, and `release`. Cover:

```js
test('create derives owner and investors from one approved portfolio and interests', async () => {
  const result = await createManagedConversation({
    database,
    managerId: 8,
    portfolioId: 1,
    interestIds: [1, 2],
  });
  assert.equal(result.portfolio_id, 1);
  assert.deepEqual(result.investors.map((item) => item.id), [6, 9]);
  assert.equal(connection.commits, 1);
  assert.equal(connection.rollbacks, 0);
});

test('one invalid interest rolls back the complete room creation', async () => {
  await assert.rejects(
    createManagedConversation({ database, managerId: 8, portfolioId: 1, interestIds: [1, 99] }),
    (error) => error.status === 409 && error.code === 'INELIGIBLE_INTEREST',
  );
  assert.equal(connection.commits, 0);
  assert.equal(connection.rollbacks, 1);
});
```

Also test: positive/deduplicated identifiers; approved-only portfolio; selected manager has `relationship_manager` role; unique portfolio claim mapped to `409 ROOM_ALREADY_CLAIMED`; one owner/manager and multiple investors; creation notification recipients; duplicate active add creates no writes/notifications; reactivation sets both cursors to current `MAX(messages.id)`; archived add allowed only for approved portfolio and does not reopen; assigned-manager-only archive/reopen; archive idempotency; reopen requires an approved portfolio and an active interest-backed investor; every failure rolls back and releases.

- [ ] **Step 2: Run the service test and verify it fails**

Run:

```bash
cd backend
node --test test/managed-conversation-workflow.test.js
```

Expected: FAIL with `Cannot find module '../src/services/managed-conversation-workflow'`.

- [ ] **Step 3: Implement validation, error mapping, and transaction scaffolding**

Implement:

```js
class ManagedConversationError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function positiveId(value, label) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ManagedConversationError(400, `Invalid ${label}`, 'INVALID_ID');
  }
  return id;
}

function uniqueInterestIds(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new ManagedConversationError(400, 'Select at least one investor interest', 'EMPTY_INTERESTS');
  }
  return [...new Set(values.map((value) => positiveId(value, 'interest ID')))];
}

async function inTransaction(database, work) {
  const connection = await database.getConnection();
  await connection.beginTransaction();
  try {
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
```

Map MySQL duplicate-key errors for `unique_conversation_portfolio` to a `409` `ManagedConversationError` without logging credentials or query parameters.

- [ ] **Step 4: Implement room creation**

Inside one transaction:

- lock the manager row and require role `relationship_manager`;
- lock `portfolios.id = ?`, require `status='approved'`, and retain `owner_id/name`;
- lock selected interests using `WHERE ii.portfolio_id=? AND ii.id IN (?)` joined to `users role='investor'` and require the returned IDs to exactly equal the deduplicated request;
- insert `conversations(portfolio_id,relationship_manager_id,title,status)`;
- insert owner and manager memberships plus all investor memberships;
- insert one `conversation_created` notification for the owner and each initial investor, with related portfolio, conversation, and manager IDs;
- query safe names and return the shared response shape.

Use one bulk membership insert and one bulk notification insert. Never use a submitted owner or investor user ID.

- [ ] **Step 5: Implement investor add/reactivation**

Lock the conversation, its portfolio, memberships, and selected interests. Require the caller to match `relationship_manager_id`, the portfolio to remain approved, and all interests to match the room portfolio. Read `COALESCE(MAX(id),0)` from messages before changing memberships.

For each selected investor:

- active row: leave unchanged;
- absent row: insert active membership with `visible_after_message_id` and `last_read_message_id` equal to the maximum message ID;
- removed row: update to active, reset `joined_at=NOW()`, `left_at=NULL`, and set both cursor fields to that maximum.

If at least one row changes, notify every newly active investor and every member who was active before the change except the acting manager, using one deduplicated `conversation_member_added` insert. Return `added_investor_ids`; if none changed, return current participants with no notification write.

- [ ] **Step 6: Implement manual archive and explicit reopen**

Archive locks the room, enforces assigned-manager ownership, updates only an active room to `status='archived', archived_reason='manual'`, and notifies other active members with `conversation_archived`. A repeat archive returns `changed:false` and creates no notification.

Reopen locks the room and portfolio, requires a non-null approved portfolio, then requires at least one active investor membership joined to a current `investor_interests` row for that portfolio. Set `status='active', archived_reason=NULL`; a room already active returns `changed:false`. A `portfolio_deleted` room returns `409`.

- [ ] **Step 7: Run service tests**

Run:

```bash
cd backend
node --test test/managed-conversation-workflow.test.js
```

Expected: all room workflow tests PASS with commit/rollback/release assertions satisfied.

- [ ] **Step 8: Commit the room workflow**

```bash
git add backend/src/services/managed-conversation-workflow.js backend/test/managed-conversation-workflow.test.js
git commit -m "feat: add managed conversation transactions"
```

### Task 3: Interest Withdrawal and Portfolio Lifecycle Integration

**Files:**
- Create: `backend/test/managed-conversation-lifecycle.test.js`
- Modify: `backend/src/services/managed-conversation-workflow.js`
- Modify: `backend/src/services/workflow.js`
- Modify: `backend/src/services/document-workflow.js`
- Modify: `backend/src/routes/interests.js`
- Modify: `backend/src/routes/portfolios.js`
- Modify: `backend/test/workflow-transactions.test.js`
- Modify: `backend/test/document-workflow.test.js`
- Modify: `backend/test/portfolio-state.test.js`

**Interfaces:**
- Consumes: `inTransaction` and `ManagedConversationError` internal helpers from Task 2.
- Produces: `withdrawInvestorInterest`, `archiveConversationForPortfolio`, and `prepareConversationForPortfolioDeletion` with the Shared Interfaces signatures.

- [ ] **Step 1: Write failing lifecycle tests**

Cover these complete transaction outcomes:

```js
test('withdrawal removes access and archives after the last investor', async () => {
  const result = await withdrawInvestorInterest({ database, investorId: 6, portfolioId: 1 });
  assert.deepEqual(result, { removed: true, conversation_id: 12, archived: true });
  assert.match(sqlLog.join('\n'), /membership_status='removed'/);
  assert.match(sqlLog.join('\n'), /archived_reason='no_active_investors'/);
  assert.match(sqlLog.join('\n'), /DELETE FROM notifications/);
  assert.equal(connection.commits, 1);
});

test('portfolio deletion preserves room history but severs portfolio and investor access', async () => {
  const result = await prepareConversationForPortfolioDeletion(connection, 1, 3);
  assert.equal(result.conversationId, 12);
  assert.match(sqlLog.join('\n'), /archived_reason='portfolio_deleted'/);
  assert.match(sqlLog.join('\n'), /portfolio_id=NULL/);
});
```

Also test: non-last withdrawal keeps room active; absent interest returns `404` and rolls back; approved portfolio edit/document mutation archives with `portfolio_unapproved` in the same transaction; submit from approved to pending archives; automatic reason overrides `manual`; reapproval leaves the room archived; draft/rejected portfolio deletion with an existing archived room applies `portfolio_deleted`; filesystem staging is restored if the database operation rolls back.

- [ ] **Step 2: Run lifecycle tests and confirm missing behavior**

Run:

```bash
cd backend
node --test test/managed-conversation-lifecycle.test.js test/workflow-transactions.test.js test/document-workflow.test.js test/portfolio-state.test.js
```

Expected: FAIL because withdrawal is a direct delete and portfolio/document changes do not call room lifecycle hooks.

- [ ] **Step 3: Implement shared automatic archive helpers**

`archiveConversationForPortfolio(connection, portfolioId, reason, actorId)` must accept only `no_active_investors`, `portfolio_unapproved`, or `portfolio_deleted`; lock the room; update status/reason when needed; and insert `conversation_archived` notifications for other active members only when the persisted state changes. Automatic reasons replace `manual`.

`prepareConversationForPortfolioDeletion` must, in order:

1. lock the portfolio's room and all memberships;
2. archive with `portfolio_deleted`;
3. delete every notification belonging to active investor members for that conversation;
4. mark all investor memberships removed with `left_at=NOW()`;
5. set `conversations.portfolio_id=NULL` while retaining title, owner, manager, and messages.

- [ ] **Step 4: Implement transactional withdrawal**

`withdrawInvestorInterest` must lock the exact `investor_interests` row, room, and matching membership. If a room exists, mark the investor removed, delete all of that user's conversation-linked notifications, delete the interest, then count active investor members. If the count is zero, call `archiveConversationForPortfolio(connection, portfolioId, 'no_active_investors', investorId)`. If no room exists, delete only the locked interest. Return the exact shared result.

Change `DELETE /api/interests/:portfolioId` to call this service and map `ManagedConversationError.status`; do not return success for a nonexistent interest.

- [ ] **Step 5: Route every approved-to-nonapproved change through the lifecycle helper**

Within each existing transaction and after the portfolio row is locked:

- `submitPortfolio`: if prior status is `approved`, archive with `portfolio_unapproved` before setting `pending`;
- owner portfolio update: move the update query into a transaction in `workflow.js`, lock the row, archive if the old status is approved, then set draft;
- `saveUploadedDocuments` and `deletePortfolioDocument`: if the locked old status is approved, archive before setting draft;
- `deleteEditablePortfolio`: call `prepareConversationForPortfolioDeletion` before deleting the portfolio, even if the room was previously archived;
- moderation rejection: call the archive helper defensively before persisting rejected; approval never reopens.

Pass the existing database object into helpers and avoid nested transactions.

- [ ] **Step 6: Preserve manager document/portfolio authorization without leaking unclaimed data**

For `GET /api/portfolios/:id` and document downloads, allow `relationship_manager` only when an active membership row proves that user is the assigned manager of that portfolio's conversation. Do not treat all relationship managers like administrators. Keep existing owner, approved-investor, and admin rules unchanged.

- [ ] **Step 7: Run lifecycle and regression tests**

Run:

```bash
cd backend
node --test test/managed-conversation-lifecycle.test.js test/workflow-transactions.test.js test/document-workflow.test.js test/portfolio-state.test.js test/documents-security.test.js
```

Expected: all listed tests PASS, including rollback and filesystem restoration paths.

- [ ] **Step 8: Commit lifecycle integration**

```bash
git add backend/src/services/managed-conversation-workflow.js backend/src/services/workflow.js backend/src/services/document-workflow.js backend/src/routes/interests.js backend/src/routes/portfolios.js backend/test/managed-conversation-lifecycle.test.js backend/test/workflow-transactions.test.js backend/test/document-workflow.test.js backend/test/portfolio-state.test.js backend/test/documents-security.test.js
git commit -m "feat: enforce managed chat lifecycle"
```

### Task 4: Group Message Access, Visibility, Unread Cursors, and Notifications

**Files:**
- Create: `backend/src/services/group-message-workflow.js`
- Create: `backend/test/group-message-workflow.test.js`
- Modify: `backend/src/routes/messages.js`
- Modify: `backend/src/routes/notifications.js`
- Modify: `backend/src/routes/dashboard.js`
- Modify: `backend/test/messages-route.test.js`
- Modify: `backend/test/dashboard-schema-contract.test.js`

**Interfaces:**
- Consumes: managed-chat tables from Task 1 and `ManagedConversationError` from Task 2.
- Produces: the four `group-message-workflow.js` functions and the exact `ConversationThread` response under Shared Interfaces.

- [ ] **Step 1: Write failing group-message service tests**

Use transaction-aware fake connections for mutations and pool query fakes for reads. Cover:

```js
test('new investor thread excludes messages at or below visibility boundary', async () => {
  const thread = await loadConversationThread({ database, userId: 9, conversationId: 12 });
  assert.deepEqual(thread.messages.map((message) => message.id), [51, 52]);
  assert.equal(thread.conversation.can_send, true);
});

test('send inserts one message and notifications for every other active member', async () => {
  const saved = await sendConversationMessage({
    database,
    user: { id: 8, name: 'RM', role: 'relationship_manager' },
    conversationId: 12,
    content: '  Welcome everyone  ',
  });
  assert.equal(saved.content, 'Welcome everyone');
  assert.deepEqual(notificationRecipients, [3, 6, 9]);
  assert.equal(connection.commits, 1);
});
```

Also test: non-member and removed-investor list/read/send denial; other manager and admin denial; archived owner/manager/active-investor read access; archived send `409`; participant list includes names and roles; owner and manager boundaries remain zero; unread excludes own messages and pre-join messages; cursor message must belong to the room and exceed the caller's visibility boundary; read cursor uses monotonic `GREATEST`; read marks related `new_message` notifications only through the accepted cursor; 2,001-character/blank content rejection; recipient insert failure rolls back the message; no password hashes or email addresses in responses.

- [ ] **Step 2: Run focused tests and verify the direct-message code fails**

Run:

```bash
cd backend
node --test test/group-message-workflow.test.js test/messages-route.test.js
```

Expected: FAIL because the service does not exist and the routes still require `partnerId`/`receiver_id`.

- [ ] **Step 3: Implement shared membership authorization**

In `group-message-workflow.js`, first look up the conversation ID and return `404` if it does not exist. Then join `conversation_members`, `conversations`, and `users` by `conversation_id` and `user_id`, require `membership_status='active'`, and return `member_role`, cursors, status, reason, portfolio ID, title, and assigned manager ID. Return `403` for a missing/removed membership without returning title, participants, messages, or other room data.

`listAccessibleConversations` must return only active memberships, group participants by room, select a latest message above that user's visibility boundary, and calculate unread as messages where:

```sql
m.id > GREATEST(cm.visible_after_message_id, cm.last_read_message_id)
AND m.sender_id <> cm.user_id
```

Each summary is:

```js
{
  id, portfolio_id, title, status, archived_reason, unread_count,
  participants: [{ id, name, role }],
  latest_message: null | { id, sender_id, sender_name, content, created_at },
}
```

- [ ] **Step 4: Implement thread loading and per-member visibility**

`loadConversationThread` returns the exact Shared Interfaces JSON. Query messages with `m.id > cm.visible_after_message_id`, join the sender user for `sender_name` and `sender_role`, and order by `m.id ASC`. Set `can_send` only when both conversation and membership are active. Participant metadata contains active members only, ordered manager, owner, then investors by name.

- [ ] **Step 5: Implement read-cursor and send transactions**

`markConversationRead` locks the caller membership and requested message. Require the message to belong to that room and `message.id > visible_after_message_id`. Update:

```sql
UPDATE conversation_members
SET last_read_message_id=GREATEST(last_read_message_id, ?)
WHERE conversation_id=? AND user_id=? AND membership_status='active'
```

Then mark `new_message` notifications read for that user/room where `related_message_id <= ?`, in the same transaction.

`sendConversationMessage` trims and validates content, locks the room and active membership, rejects archived rooms, inserts the message, then bulk-inserts `new_message` notifications for all other active members with `related_portfolio_id`, `related_conversation_id`, `related_message_id`, and `related_user_id=sender`. Read the saved message with sender name/role before commit.

- [ ] **Step 6: Replace the partner-based HTTP routes**

Keep `GET /api/messages/me` and replace every other messages route with:

```text
GET  /api/messages/conversations
GET  /api/messages/conversations/:conversationId
PUT  /api/messages/conversations/:conversationId/read
POST /api/messages/conversations/:conversationId/messages
```

Use express-validator for positive path IDs, positive `message_id`, and trimmed content length `1..2000`. Map known workflow errors by status; return `500 {"error":"Server error"}` for unexpected failures. Remove `POST /api/messages` and all `receiver_id` handling.

- [ ] **Step 7: Authorization-filter notification list/count/read operations**

For list and unread count, include a conversation-linked notification only when this exists:

```sql
EXISTS (
  SELECT 1 FROM conversation_members cm
  WHERE cm.conversation_id=n.related_conversation_id
    AND cm.user_id=n.user_id
    AND cm.membership_status='active'
)
```

Apply the same filter to single-read and read-all updates. Unrelated notifications remain visible and writable. A removed investor's historical room notifications must never contribute to their unread count.

- [ ] **Step 8: Replace direct-message dashboard counts**

Owner and investor dashboard message totals/unread counts must query active memberships and room messages using the same cursor formula. Return managed room metadata in recent interests:

```js
{
  conversation_id: number | null,
  conversation_status: 'active' | 'archived' | null,
  chat_state: 'open' | 'archived' | 'awaiting_manager',
}
```

Do not query `receiver_id` or `messages.read_at` anywhere.

- [ ] **Step 9: Run group-message and dashboard tests**

Run:

```bash
cd backend
node --test test/group-message-workflow.test.js test/messages-route.test.js test/dashboard-schema-contract.test.js
```

Expected: all tests PASS and a source scan finds no direct-message SQL:

```bash
! rg -n "receiver_id|messages\.read_at|partnerId" src
```

- [ ] **Step 10: Commit group messaging**

```bash
git add backend/src/services/group-message-workflow.js backend/src/routes/messages.js backend/src/routes/notifications.js backend/src/routes/dashboard.js backend/test/group-message-workflow.test.js backend/test/messages-route.test.js backend/test/dashboard-schema-contract.test.js
git commit -m "feat: replace direct messages with managed rooms"
```

### Task 5: Administrator-Provisioned Relationship Manager Accounts

**Files:**
- Create: `backend/test/relationship-manager-admin.test.js`
- Modify: `backend/src/routes/admin.js`
- Modify: `backend/src/routes/auth.js`
- Modify: `backend/test/frontend-flow-contract.test.js`

**Interfaces:**
- Consumes: existing `authenticate`, `requireRole`, bcryptjs cost `10`, and `users.role='relationship_manager'` from Task 1.
- Produces: `POST /api/admin/relationship-managers` and `GET /api/admin/relationship-managers`.

- [ ] **Step 1: Write failing admin provisioning tests**

Test anonymous `401`, wrong-role `403`, invalid name/email/password `400`, duplicate email `409`, bcrypt hash rather than plaintext, forced role regardless of extra client properties, `201` safe metadata, and safe sorted list output. Include this public-registration regression:

```js
test('public registration rejects relationship managers', async () => {
  const response = await request(app, 'POST', '/api/auth/register', {
    name: 'Unauthorised RM', email: 'rm-public@example.test', password: 'secret1',
    role: 'relationship_manager',
  });
  assert.equal(response.status, 400);
  assert.equal(insertCalls.length, 0);
});
```

- [ ] **Step 2: Run tests and verify the routes are absent**

Run:

```bash
cd backend
node --test test/relationship-manager-admin.test.js test/frontend-flow-contract.test.js
```

Expected: FAIL with `404` on manager admin endpoints.

- [ ] **Step 3: Implement administrator-only create/list endpoints**

Validate create input with:

```js
[
  body('name').trim().isLength({ min: 1, max: 100 }),
  body('email').isEmail().normalizeEmail().isLength({ max: 255 }),
  body('password').isLength({ min: 6, max: 128 }),
]
```

Check email existence, hash using `bcrypt.hash(password, 10)`, and insert only `(email,password_hash,name,'relationship_manager')`. Map a unique-email `ER_DUP_ENTRY` race to the same `409 Email already registered` response. Return:

```json
{
  "id": 8,
  "name": "Relationship Manager",
  "email": "rm@example.test",
  "role": "relationship_manager",
  "created_at": "2026-07-22T13:00:00.000Z"
}
```

The list endpoint selects only those five safe columns for role relationship_manager, ordered by `created_at DESC, id DESC`. Never echo the submitted password or return `password_hash`.

- [ ] **Step 4: Run provisioning tests and secret scan**

Run:

```bash
cd backend
node --test test/relationship-manager-admin.test.js test/frontend-flow-contract.test.js
! rg -n "password_hash.*res\.json|res\.json.*password_hash" src/routes
```

Expected: tests PASS and the scan returns no match.

- [ ] **Step 5: Commit account provisioning**

```bash
git add backend/src/routes/admin.js backend/src/routes/auth.js backend/test/relationship-manager-admin.test.js backend/test/frontend-flow-contract.test.js
git commit -m "feat: let admins provision relationship managers"
```

### Task 6: Relationship Manager Dashboard and Room Management API

**Files:**
- Create: `backend/src/routes/relationship-manager.js`
- Create: `backend/test/relationship-manager-route.test.js`
- Modify: `backend/server.js`
- Modify: `backend/test/messages-server.test.js`
- Modify: `backend/test/server-lifecycle.test.js`

**Interfaces:**
- Consumes: Task 2 service functions and Task 4 unread formula.
- Produces: the four relationship-manager endpoints from the approved design and the dashboard payload below.

- [ ] **Step 1: Write failing route and role-isolation tests**

Test that the router is mounted, anonymous users receive `401`, owner/investor/admin receive `403`, assigned manager success is forwarded, service status codes are preserved, and another manager receives `403` without participant data.

Assert this dashboard structure:

```js
{
  stats: {
    eligible_interests: 2,
    active_rooms: 1,
    businesses_overseen: 1,
    unread_messages: 3,
  },
  unclaimed_portfolios: [{
    portfolio_id: 1,
    portfolio_name: 'X3',
    owner: { id: 3, name: 'Beta' },
    interests: [{ id: 1, investor: { id: 6, name: 'testing1' }, created_at: '2026-07-22T13:00:00.000Z' }],
  }],
  rooms: [{
    conversation_id: 12,
    portfolio_id: 1,
    title: 'X3',
    status: 'active',
    archived_reason: null,
    unread_count: 3,
    owner: { id: 3, name: 'Beta' },
    investors: [{ id: 6, name: 'testing1' }],
    eligible_interests: [{ id: 2, investor: { id: 9, name: 'leticia l' } }],
  }],
}
```

- [ ] **Step 2: Run tests and verify router absence**

Run:

```bash
cd backend
node --test test/relationship-manager-route.test.js test/messages-server.test.js test/server-lifecycle.test.js
```

Expected: FAIL because `/api/relationship-manager` is not mounted.

- [ ] **Step 3: Implement the dashboard query**

Protect every route with `authenticate, requireRole('relationship_manager')`. Build the dashboard from parameterized queries scoped to `req.user.id`:

- unclaimed: approved portfolios with at least one interest and no conversation;
- rooms: `conversations.relationship_manager_id = ?` only;
- room investors: active investor memberships;
- eligible additions: current interests for the same still-approved portfolio without an active investor membership;
- unread: messages above the manager member cursor and not sent by the manager.

Group flat query rows into the exact nested response, deduplicating by numeric IDs. Never return another manager's room.

- [ ] **Step 4: Implement room-management route adapters**

Implement:

```text
POST /api/relationship-manager/conversations
  body: { portfolio_id: number, interest_ids: number[] }
POST /api/relationship-manager/conversations/:id/investors
  body: { interest_ids: number[] }
PUT /api/relationship-manager/conversations/:id/archive
PUT /api/relationship-manager/conversations/:id/reopen
```

Validate positive IDs and a non-empty interest array before calling the Task 2 functions with `database: db` and `managerId: req.user.id`. Return `201` for room creation, `200` for all other success paths, and exact `ManagedConversationError.status` for known failures.

- [ ] **Step 5: Mount the router and preserve server lifecycle behavior**

In `createApp`, require and mount:

```js
const relationshipManagerRoutes = require('./src/routes/relationship-manager');
app.use('/api/relationship-manager', relationshipManagerRoutes);
```

Keep health, readiness, error middleware, startup, shutdown, and dependency injection behavior unchanged.

- [ ] **Step 6: Run route/server tests**

Run:

```bash
cd backend
node --test test/relationship-manager-route.test.js test/messages-server.test.js test/server-lifecycle.test.js
```

Expected: all listed tests PASS.

- [ ] **Step 7: Commit the manager API**

```bash
git add backend/src/routes/relationship-manager.js backend/server.js backend/test/relationship-manager-route.test.js backend/test/messages-server.test.js backend/test/server-lifecycle.test.js
git commit -m "feat: expose relationship manager workspace API"
```

### Task 7: Idempotent X3/testing1 Managed-Room Seed

**Files:**
- Create: `backend/scripts/seed-managed-chat.js`
- Create: `backend/test/managed-chat-seed.test.js`
- Modify: `backend/package.json`

**Interfaces:**
- Consumes: the Task 1 target schema and Task 2 room invariants.
- Produces: `SEED_KEY`, `SEED_CONFIRMATION`, `resolveSeedConfig(environment)`, and `seedManagedChat(database, config)`.

- [ ] **Step 1: Write failing seed validation/idempotency tests**

Use a fake transaction connection and assert:

```js
test('seed config requires explicit stable identifiers and confirmation', () => {
  assert.throws(() => resolveSeedConfig({}), /confirmation/i);
  const config = resolveSeedConfig({
    CONFIRM_MANAGED_CHAT_SEED: SEED_CONFIRMATION,
    MANAGED_CHAT_SEED_KEY: SEED_KEY,
    MANAGED_CHAT_MANAGER_EMAIL: 'rm@example.test',
    MANAGED_CHAT_PORTFOLIO_ID: '1',
    MANAGED_CHAT_INVESTOR_ID: '6',
  });
  assert.equal(config.portfolioId, 1);
  assert.equal(config.investorId, 6);
});
```

Also test: X3 name and approved status required; owner is derived and must be named Beta; manager email resolves one `relationship_manager`; investor ID resolves testing1 and one active X3 interest; portfolio row is locked before room lookup; absent room creates room/members; existing matching room reuses it; exactly one message per fixed author/body tuple; complete rerun performs no inserts; partial seed message set throws and rolls back; mismatched manager/owner/investor membership throws; leticia l is not inserted; concurrent attempts serialize on the portfolio lock.

- [ ] **Step 2: Run seed tests and confirm the script is missing**

Run:

```bash
cd backend
node --test test/managed-chat-seed.test.js
```

Expected: FAIL with missing module.

- [ ] **Step 3: Implement explicit configuration and deterministic messages**

Use:

```js
const SEED_KEY = 'managed-chat-demo-v1';
const SEED_CONFIRMATION = 'SEED_X3_TESTING1_MANAGED_CHAT';
const DEMO_MESSAGES = [
  { author: 'manager', body: 'Welcome to the managed X3 conversation. I will help coordinate this discussion.' },
  { author: 'owner', body: 'Thanks for joining. I am happy to share more about X3 and answer your questions.' },
  { author: 'investor', body: 'Thank you. I am interested in learning more about X3’s traction and next milestones.' },
];
```

Require the exact confirmation, exact seed key, manager email or positive manager ID, positive portfolio ID, and positive investor ID. Do not select accounts by display name alone.

- [ ] **Step 4: Implement the single-transaction seed**

Inside one transaction:

1. lock portfolio by explicit ID and verify exact name `X3`, owner name `Beta`, and status approved;
2. resolve/lock the explicit manager and require the correct role;
3. resolve/lock explicit investor ID and active interest and require exact name `testing1`;
4. lock the unique room by portfolio ID;
5. create the room and manager/owner/testing1 memberships only if absent, otherwise validate all fixed identities;
6. load the three exact author/body tuples;
7. if all three exist, return `{created:false}`; if zero exist, insert them manager → owner → investor; if one or two exist or an expected body has a different author, throw a conflict and insert nothing;
8. never add any other interest/member or create seed notifications.

Concurrency safety comes from locking the portfolio before room lookup and holding the lock through the message tuple check.

- [ ] **Step 5: Run seed tests and syntax check**

Run:

```bash
cd backend
node --test test/managed-chat-seed.test.js
node --check scripts/seed-managed-chat.js
```

Expected: all tests PASS and syntax check exits 0.

- [ ] **Step 6: Commit the demo seed**

```bash
git add backend/scripts/seed-managed-chat.js backend/test/managed-chat-seed.test.js backend/package.json
git commit -m "feat: add idempotent managed chat demo seed"
```

### Task 8: Four-Role Homepage, Login Routing, and Admin Provisioning UI

**Files:**
- Modify: `index.html`
- Modify: `css/style.css`
- Modify: `js/script.js`
- Modify: `js/api.js`
- Modify: `moderatordashboard.html`
- Modify: `js/moderatordashboard.js`
- Modify: `backend/test/frontend-flow-contract.test.js`
- Modify: `backend/test/frontend-origin.test.js`

**Interfaces:**
- Consumes: Task 5 administrator endpoints and existing `apiFetch`, `requirePageRole`, form/error styles, and role cards.
- Produces: `ROLE_MAP.relationship_manager`, `API.getRelationshipManagers()`, `API.createRelationshipManager(payload)`, and the manager-provisioning panel.

- [ ] **Step 1: Write failing static/client contract tests**

Assert:

```js
test('homepage offers four roles without public manager signup', () => {
  const html = read('index.html');
  assert.match(html, />Relationship Manager</);
  assert.match(html, /href="signin\.html"[^>]*>\s*Sign In as Relationship Manager/s);
  assert.doesNotMatch(html, /signup\.html\?role=relationship_manager/);
});

test('login maps relationship managers to their protected dashboard', () => {
  assert.match(read('js/script.js'), /relationship_manager:\s*\{\s*dashboard:\s*'relationshipmanagerdashboard\.html'/);
});
```

Also assert four/two/one-column CSS breakpoints, admin page form labels/name/email/temporary password, safe list container, pending state, field error containers, same-origin API helpers, and continued public-signup limitation.

- [ ] **Step 2: Run frontend contracts and verify failure**

Run:

```bash
cd backend
node --test test/frontend-flow-contract.test.js test/frontend-origin.test.js
```

Expected: FAIL because the relationship-manager card, redirect, and admin UI do not exist.

- [ ] **Step 3: Add the fourth homepage role card and responsive grid**

Add a relationship-manager card between Investor and Administrator with copy:

- persona: `For managed introductions`;
- features: `Oversee portfolio conversations`, `Connect eligible investors`, `Guide group discussions`, `Preserve a clear audit trail`;
- CTA: `Sign In as Relationship Manager` linking to `signin.html`.

Change owner/investor wording from direct messaging to managed conversations. Use a four-column grid above `1200px`, two columns from `700px` through `1199px`, and one column below `700px`. Preserve focus styles, semantic headings, and minimum 44px touch targets.

- [ ] **Step 4: Add role redirect and API helpers**

Add:

```js
relationship_manager: { dashboard: 'relationshipmanagerdashboard.html' },
```

to `ROLE_MAP`. Add to `API`:

```js
getRelationshipManagers: () => apiFetch('/admin/relationship-managers'),
createRelationshipManager: (payload) => apiFetch('/admin/relationship-managers', {
  method: 'POST', body: JSON.stringify(payload),
}),
getRelationshipManagerDashboard: () => apiFetch('/relationship-manager/dashboard'),
createManagedConversation: (portfolioId, interestIds) => apiFetch('/relationship-manager/conversations', {
  method: 'POST', body: JSON.stringify({ portfolio_id: portfolioId, interest_ids: interestIds }),
}),
addManagedInvestors: (conversationId, interestIds) => apiFetch(`/relationship-manager/conversations/${conversationId}/investors`, {
  method: 'POST', body: JSON.stringify({ interest_ids: interestIds }),
}),
archiveManagedConversation: (conversationId) => apiFetch(`/relationship-manager/conversations/${conversationId}/archive`, { method: 'PUT' }),
reopenManagedConversation: (conversationId) => apiFetch(`/relationship-manager/conversations/${conversationId}/reopen`, { method: 'PUT' }),
```

- [ ] **Step 5: Build the administrator manager-account panel**

Below moderation stats and before the queue, add a card containing an accessible form with IDs `rm-name`, `rm-email`, `rm-password`, `rm-submit`, `rm-form-message`, and a list/table body `rm-account-list`. Label the password `Temporary password` and explain that the administrator must communicate it securely.

In `js/moderatordashboard.js`:

- load queue/stats/manager list with `Promise.all`;
- client-validate non-empty name, valid email, and password length 6–128;
- disable only the RM submit button during creation and retain field values on failure;
- call `API.createRelationshipManager` and refresh the safe list on success;
- clear the password field immediately after success;
- render only escaped name, email, role, and creation date.

- [ ] **Step 6: Run frontend contracts and syntax checks**

Run:

```bash
cd backend
node --test test/frontend-flow-contract.test.js test/frontend-origin.test.js
node --check ../js/script.js
node --check ../js/api.js
node --check ../js/moderatordashboard.js
```

Expected: tests PASS and all syntax checks exit 0.

- [ ] **Step 7: Commit the four-role entry/provisioning UI**

```bash
git add index.html css/style.css js/script.js js/api.js moderatordashboard.html js/moderatordashboard.js backend/test/frontend-flow-contract.test.js backend/test/frontend-origin.test.js
git commit -m "feat: add relationship manager entry and provisioning UI"
```

### Task 9: Protected Relationship Manager Dashboard UI

**Files:**
- Create: `relationshipmanagerdashboard.html`
- Create: `js/relationshipmanagerdashboard.js`
- Create: `backend/test/relationship-manager-client.test.js`
- Modify: `css/style.css`
- Modify: `backend/test/frontend-flow-contract.test.js`

**Interfaces:**
- Consumes: Task 6 dashboard payload and Task 8 API helpers.
- Produces: a role-protected, responsive manager dashboard that always opens chat by `conversationId`.

- [ ] **Step 1: Write failing manager-client tests**

Use static source assertions and a small `vm`/fake-DOM harness to verify:

- `requirePageRole('relationship_manager')` runs before data loading;
- wrong role redirects through existing page-role behavior;
- loading, empty, data, and recoverable error states exist;
- room creation accepts multiple checked `interest_ids`;
- Add Investors accepts multiple checked interests;
- a pending action disables only its initiating controls;
- API errors remain visible and selections are retained;
- archive and reopen refresh the dashboard;
- Open Group Chat navigates exactly with `` `messages.html?conversationId=${conversationId}` ``;
- all interpolated names/titles are escaped.

- [ ] **Step 2: Run the client tests and verify missing files**

Run:

```bash
cd backend
node --test test/relationship-manager-client.test.js test/frontend-flow-contract.test.js
```

Expected: FAIL because the new dashboard files do not exist.

- [ ] **Step 3: Build semantic dashboard markup**

Create a standard Lumi5 navbar with Dashboard and Messages links, current-user chip, and sign out. The main area contains:

- four stat cards with IDs `stat-eligible`, `stat-active`, `stat-businesses`, `stat-unread`;
- `dashboard-status` live region;
- `unclaimed-room-list` for approved portfolios with interest checkboxes and Create Room;
- `managed-room-list` for owned active/archived rooms, participant chips, eligible-interest checkboxes, Add Investors, Open Group Chat, Archive, and Reopen;
- empty-state elements that are meaningful without icons alone.

Use real `<button>`, `<fieldset>`, `<legend>`, `<label>`, and `aria-live="polite"`; do not attach click handlers through unescaped inline HTML data.

- [ ] **Step 4: Implement dashboard state and rendering**

Use:

```js
const state = {
  user: null,
  dashboard: null,
  pending: new Set(),
  selectedCreateInterests: new Map(),
  selectedAddInterests: new Map(),
};
```

On load, authenticate the exact role, render user details, fetch the dashboard, normalize all IDs as strings at DOM boundaries, and render. Group checked interests by portfolio/conversation; require at least one selected interest before create/add. Preserve selections when a mutation fails. After a success, clear only the completed selection, refetch, and show an actionable success message.

- [ ] **Step 5: Add dashboard styling and responsive behavior**

Extend shared CSS rather than copying the `messages.html` inline stylesheet. Match existing radius, borders, stat cards, muted text, green/blue/purple accents, and spacing. Use:

- desktop: stats in four columns and room cards in two columns;
- tablet: stats and rooms in two columns;
- mobile: one column, wrapped participant chips, full-width action buttons;
- visible `:focus-visible` outlines, disabled opacity plus cursor, and non-color status text.

- [ ] **Step 6: Run client, syntax, and source-safety checks**

Run:

```bash
cd backend
node --test test/relationship-manager-client.test.js test/frontend-flow-contract.test.js
node --check ../js/relationshipmanagerdashboard.js
! rg -n "innerHTML\s*=.*(name|email|title)" ../js/relationshipmanagerdashboard.js
```

Expected: tests PASS, syntax exits 0, and unescaped interpolation scan has no match.

- [ ] **Step 7: Commit the manager dashboard**

```bash
git add relationshipmanagerdashboard.html js/relationshipmanagerdashboard.js css/style.css backend/test/relationship-manager-client.test.js backend/test/frontend-flow-contract.test.js
git commit -m "feat: add relationship manager dashboard"
```

### Task 10: Shared Managed-Room Messages UI and Owner/Investor Entry Points

**Files:**
- Create: `backend/test/managed-messages-client.test.js`
- Modify: `messages.html`
- Modify: `js/messages.js`
- Modify: `css/style.css`
- Modify: `businessownerdashboard.html`
- Modify: `js/browse.js`
- Modify: `js/my-interests.js`
- Modify: `js/mybusinesses.js`
- Modify: `js/investordashboard.js`
- Modify: `backend/src/routes/interests.js`
- Modify: `backend/src/routes/portfolios.js`
- Modify: `backend/test/messages-client.test.js`
- Modify: `backend/test/messages-layout.test.js`
- Modify: `backend/test/frontend-flow-contract.test.js`

**Interfaces:**
- Consumes: Task 4 room API, Task 6 conversation IDs, and Task 8 `apiFetch` behavior.
- Produces: conversation-ID-only messages state and `chat_state`/`conversation_id` entry-point metadata.

- [ ] **Step 1: Replace one-to-one client expectations with failing room tests**

Test the following against a fake DOM and mocked `fetch`:

```js
test('a sent message reloads from the selected conversation and leaves composer reusable', async () => {
  await selectConversation('12');
  messageInput.value = 'Hello group';
  await submitMessage();
  assert.equal(requests[0].path, '/messages/conversations/12/messages');
  assert.equal(requests[0].body.content, 'Hello group');
  assert.equal(messageInput.value, '');
  assert.equal(messageInput.disabled, false);
});

test('current user is right aligned and every other sender is left aligned with identity', () => {
  renderThread();
  assert.match(messageList.innerHTML, /message-row mine[\s\S]*You[\s\S]*Relationship Manager/);
  assert.match(messageList.innerHTML, /message-row[\s\S]*Beta[\s\S]*Business Owner/);
  assert.match(messageList.innerHTML, /message-row[\s\S]*testing1[\s\S]*Investor/);
});
```

Also test: URL starter is only `conversationId`; partner/receiver query parameters are ignored; summaries keyed by conversation ID/title; participant names/roles in header; manager nav selection; archived composer disabled with reason text; failed send keeps draft and re-enables composer; stale thread/list responses cannot replace current selection; successful thread load calls read endpoint with the last visible message ID; no-message thread skips read call; unread count refresh; search includes title/participants/content; HTML escaping; refresh persistence.

- [ ] **Step 2: Run message client/layout tests and confirm partner model failure**

Run:

```bash
cd backend
node --test test/managed-messages-client.test.js test/messages-client.test.js test/messages-layout.test.js
```

Expected: FAIL because state, URL handling, requests, and markup still use partner IDs.

- [ ] **Step 3: Update messages page structure for all three participant roles**

In `messages.html`:

- add a hidden `relationship-manager-nav` with Dashboard and active Messages links;
- add `body.role-relationship-manager` styling variables;
- replace single thread avatar/subtitle assumptions with `thread-participants` chips;
- label the status as `Managed conversation` when active;
- add an `archive-notice` live region above the composer;
- preserve the existing list/thread two-column desktop layout and responsive mobile layout;
- ensure the composer stays in the DOM permanently and is disabled, never removed, for no selection/archive/send pending.

- [ ] **Step 4: Refactor state and normalization around conversation IDs**

Use:

```js
const state = {
  token: '',
  user: null,
  conversations: [],
  activeConversationId: null,
  activeThread: null,
  search: '',
  selectionVersion: 0,
  sending: false,
};
```

Normalize `conversation.id`, participant IDs, and message sender IDs as strings in the client. Read only `conversationId` from the query string. Select via `[data-conversation-id]`, request `/messages/conversations/:id`, and apply a response only when both `selectionVersion` and `activeConversationId` still match.

- [ ] **Step 5: Render summaries, participants, archival state, and bubbles**

Conversation cards use title, participant-name summary, latest sender/content/time, status, and unread count. The thread header shows all active participant chips with role labels from:

```js
const ROLE_LABELS = {
  business_owner: 'Business Owner',
  investor: 'Investor',
  relationship_manager: 'Relationship Manager',
};
```

Each message renders sender name, role, content, and time. Add `mine` only when `sameId(message.sender_id, state.user.id)`. Never align by role. For an archived room, call `setComposeEnabled(false)`, render `This conversation is archived and is read-only.`, and map the reason to a human-readable explanation.

- [ ] **Step 6: Implement reusable send/read/refresh behavior**

On send:

1. capture the trimmed draft and current conversation ID;
2. disable input/button without removing them;
3. POST `{content}` to `/messages/conversations/:id/messages`;
4. only on success clear the input;
5. refetch both the active thread and list from MySQL;
6. on failure retain the exact draft and show the API error;
7. always re-enable the composer when the still-selected room is active.

After a successful thread load, find the last visible message and PUT `{message_id:last.id}` to `/messages/conversations/:id/read`, then reload summaries. A read-call failure shows a non-destructive toast and does not discard the loaded thread.

- [ ] **Step 7: Add server-provided managed-chat state to owner/investor data**

Extend relevant portfolio/interest/dashboard queries with a left join scoped to the requesting user and return:

```js
conversation_id,
conversation_status,
chat_state // 'open', 'archived', or 'awaiting_manager'
```

For business owners, derive access from owner membership; for investors, require their active investor membership. Do not expose a room ID to an investor whose interest exists but membership is removed.

- [ ] **Step 8: Remove direct-message shortcuts and render managed-room states**

Delete every URL builder that emits `partnerId`, `receiver_id`, owner user IDs, or investor user IDs. In browse, interests, businesses, and dashboard views:

- `chat_state='open'`: button `Open Managed Chat` → `` `messages.html?conversationId=${conversationId}` ``;
- `chat_state='archived'`: button `View Archived Chat` → same URL and visibly marked read-only;
- no room: non-clickable status `Awaiting Relationship Manager`.

Keep generic navigation links to `messages.html`; remove only direct person-to-person initiation.

- [ ] **Step 9: Run managed-message, frontend, and source scans**

Run:

```bash
cd backend
node --test test/managed-messages-client.test.js test/messages-client.test.js test/messages-layout.test.js test/frontend-flow-contract.test.js
node --check ../js/messages.js
node --check ../js/browse.js
node --check ../js/my-interests.js
node --check ../js/mybusinesses.js
node --check ../js/investordashboard.js
! rg -n "partnerId|receiver_id|receiverName|Message owner|Message investor|Direct messaging" ../*.html ../js src
```

Expected: all tests PASS, syntax checks exit 0, and the direct-message scan returns no match.

- [ ] **Step 10: Commit the managed-room frontend**

```bash
git add messages.html js/messages.js css/style.css businessownerdashboard.html js/browse.js js/my-interests.js js/mybusinesses.js js/investordashboard.js backend/src/routes/interests.js backend/src/routes/portfolios.js backend/test/managed-messages-client.test.js backend/test/messages-client.test.js backend/test/messages-layout.test.js backend/test/frontend-flow-contract.test.js
git commit -m "feat: add multi-party managed messaging UI"
```

### Task 11: Self-Cleaning Four-Role Smoke and Exact Deployment Manifest

**Files:**
- Create: `backend/scripts/live-four-role-smoke.js`
- Modify: `backend/package.json`
- Modify: `backend/deploy/runtime-manifest.txt`
- Modify: `backend/test/live-smoke-contract.test.js`
- Modify: `backend/test/messages-deployment-files.test.js`
- Delete after replacement: `backend/scripts/live-three-role-smoke.js`

**Interfaces:**
- Consumes: same-origin public API, database credentials supplied only through runtime environment, and all four role workflows.
- Produces: `npm run smoke:live` using only records whose prefix is `codex_e2e_` followed by a runtime `crypto.randomUUID()` value, with guaranteed cleanup.

- [ ] **Step 1: Write failing smoke/manifest contracts**

Update tests to require `live-four-role-smoke.js`, four temporary emails, relationship-manager provisioning through the admin API, room creation using interest IDs, conversation message routes, own/other membership checks, archive behavior, and `finally` cleanup. The exact manifest must add:

```text
relationshipmanagerdashboard.html
js/relationshipmanagerdashboard.js
backend/scripts/live-four-role-smoke.js
backend/src/routes/relationship-manager.js
backend/src/services/group-message-workflow.js
backend/src/services/managed-conversation-workflow.js
```

and remove `backend/scripts/live-three-role-smoke.js`. Migration and permanent seed scripts stay private deployment tools and are copied deliberately during migration/seed steps; they are not public frontend assets.

- [ ] **Step 2: Run contract tests and verify failure**

Run:

```bash
cd backend
node --test test/live-smoke-contract.test.js test/messages-deployment-files.test.js
```

Expected: FAIL because the smoke and exact manifest still describe three roles/direct messages.

- [ ] **Step 3: Implement unique temporary identities and setup**

Generate one UUID prefix and a random credential at runtime. Directly insert only the temporary admin because public registration cannot create it; log in, create the temporary manager through `POST /api/admin/relationship-managers`, log that manager in with the generated credential, and register owner/investor through the public API. Track every returned user, portfolio, interest, conversation, message, notification, document, and audit ID.

Reject any origin other than loopback or the exact approved public origin `http://35.212.144.149`. Never contain a fixed password, live account email, or production JWT.

- [ ] **Step 4: Exercise the complete public workflow**

Through HTTP:

1. verify each role via `/auth/me` and reject public RM registration;
2. reject manager endpoints for owner/investor/admin and reject admin endpoints for manager;
3. create owner portfolio/document, submit, admin approve, investor express interest;
4. load manager dashboard, locate the exact temporary interest ID, and create the room;
5. verify other temporary manager cannot see/claim the room if a second manager is created for isolation;
6. send one message each as manager, owner, and investor;
7. verify persistence, participant labels, own/other messages, per-member unread/read behavior, and notification fan-out;
8. archive as assigned manager and verify reads succeed while sends return `409`;
9. reopen, withdraw interest, and verify investor loses all room/notification access while the last-investor removal archives with `no_active_investors`.

- [ ] **Step 5: Implement strict foreign-key-safe cleanup**

In `finally`, open one database transaction and delete only rows proven by both UUID-prefixed identity values and tracked numeric IDs, in this order:

1. notifications for tracked users/portfolio/conversation/messages;
2. messages for tracked conversation;
3. conversation memberships;
4. conversation;
5. audit logs for tracked portfolio;
6. interest for tracked investor/portfolio if still present;
7. portfolio documents and staged filesystem file;
8. portfolio;
9. temporary users.

Commit, then query for every tracked ID and assert none remain. Roll back on cleanup failure and set nonzero exit status. Never delete by display-name prefix alone.

- [ ] **Step 6: Update package command and exact manifest**

Set:

```json
"smoke:live": "node scripts/live-four-role-smoke.js"
```

Update `runtime-manifest.txt` and `expectedRuntimeFiles` in the same order, adding every new runtime route/service/frontend file and excluding tests, docs, `.env`, migration, schema backups, and node_modules.

- [ ] **Step 7: Run smoke contracts and all local tests**

Run:

```bash
cd backend
node --test test/live-smoke-contract.test.js test/messages-deployment-files.test.js
npm test
```

Expected: both focused tests and the complete suite PASS with zero failures.

- [ ] **Step 8: Commit smoke and deployment manifest**

```bash
git add backend/scripts/live-four-role-smoke.js backend/package.json backend/deploy/runtime-manifest.txt backend/test/live-smoke-contract.test.js backend/test/messages-deployment-files.test.js
git rm backend/scripts/live-three-role-smoke.js
git commit -m "test: add four-role managed chat smoke"
```

### Task 12: Complete Local Release Gate, Visual Verification, and Code Review

**Files:**
- Modify only files identified by failures or review findings from Tasks 1–11.

**Interfaces:**
- Consumes: the complete feature branch and all automated tests.
- Produces: a clean, reviewed, deployable commit with no known contract, visual, syntax, or security regressions.

- [ ] **Step 1: Run the full deterministic local gate**

Run from the repository root:

```bash
git diff --check
cd backend
npm test
node --check server.js
node --check migrate.js
for file in src/routes/*.js src/services/*.js scripts/*.js ../js/*.js; do node --check "$file"; done
npm ls --depth=0
```

Expected: `git diff --check` exits 0; every test passes with zero skipped feature tests; every syntax check exits 0; `npm ls` reports no missing/invalid dependency.

- [ ] **Step 2: Run explicit contract/security scans**

Run:

```bash
cd ..
! rg -n "receiver_id|partnerId|receiverName|Direct messaging" --glob '!docs/**' --glob '!backend/test/**'
! rg -n "https?://35\.212\.144\.149|localhost|127\.0\.0\.1:300[01]" --glob '!docs/**' --glob '!backend/scripts/live-four-role-smoke.js' --glob '!backend/deploy/**'
! rg -n "password\s*=\s*['\"][^'\"]+|JWT_SECRET\s*=|DB_PASSWORD\s*=" --glob '!docs/**' --glob '!backend/test/**' --glob '!backend/package-lock.json'
git ls-files | rg '(^|/)(\.env|node_modules|\.vscode|\.superpowers)(/|$)' && exit 1 || true
```

Expected: no legacy direct-message contract, forbidden origin, committed plaintext secret, or ignored runtime directory is found.

- [ ] **Step 3: Run a local MySQL integration pass against a disposable database**

Create a disposable database named exactly `lumi5_managed_chat_test_20260722`, load `backend/schema.sql`, start the API on loopback with test-only credentials, and run a local variant of the four-role smoke. Before creation, assert that the database does not already exist. After the smoke, stop the API, assert smoke cleanup, and drop only that exact disposable database.

Expected: schema readiness returns `200`, the four-role smoke passes, and the disposable database is removed. If local MySQL is unavailable, do not silently skip; record the missing prerequisite and require the live staging smoke in Task 13 before any public cutover.

- [ ] **Step 4: Visually verify the four affected pages**

Use `browser:control-in-app-browser` with a local static server and local API to inspect wide desktop, tablet, and mobile widths for:

- `index.html`: four/two/one role-card layout and sign-in-only manager CTA;
- `moderatordashboard.html`: manager form/list, field errors, pending and success states;
- `relationshipmanagerdashboard.html`: stats, multi-select create/add, active/archived cards, empty/error states;
- `messages.html` opened with the exact temporary conversation ID returned by the local smoke: participant chips, own-right/others-left bubbles, archived notice, and composer persistence after a simulated failed send.

Check keyboard tab order, visible focus, readable contrast, no horizontal overflow at 375px, and no console errors. Capture screenshots for implementation review but do not commit them.

- [ ] **Step 5: Request independent code review and address only concrete findings**

Invoke `superpowers:requesting-code-review` on the full feature diff. Require the reviewer to compare against `docs/superpowers/specs/2026-07-22-relationship-manager-group-chat-design.md`, focusing on transaction rollback, role isolation, visibility boundaries, notification privacy, migration preservation, and direct-message removal.

For every finding, reproduce it with a failing test before changing implementation. Rerun that focused test and the full gate. Reject speculative scope additions such as attachments, WebSockets, multiple managers, or admin room access because they are explicitly out of scope.

- [ ] **Step 6: Commit verified review fixes if any**

If review required changes:

```bash
git add -A
git commit -m "fix: address managed chat review findings"
```

If no changes were required, do not create an empty commit. Confirm `git status --short` is empty.

### Task 13: Reversible Live Migration, Deployment, Smoke, Demo Seed, and Git Publication

**Files:**
- Remote backup: `/home/user/lumilabs-quarantine-20260722-managed-chat/`
- Remote backend: `/var/www/lumilabs-backend`
- Remote staged backend: `/var/www/lumilabs-backend-next-managed-chat`
- Remote previous backend: `/var/www/lumilabs-backend-pre-managed-chat-20260722`
- Remote staged frontend: `/var/www/html-next-managed-chat`
- Remote live frontend: `/var/www/html`
- Remote previous frontend: `/var/www/html-pre-managed-chat-20260722`
- Modify local Git state only after every live check passes.

**Interfaces:**
- Consumes: clean verified branch, SSH/SFTP access, live `.env`, exact runtime manifest, guarded migration, four-role smoke, and permanent seed.
- Produces: live managed group chat, recoverable backups, X3/testing1 demo room, synchronized `main`/`origin/main`, and a concise evidence record.

- [ ] **Step 1: Preflight exact live state without writes**

Verify:

```bash
git status --short --branch
git log -1 --oneline
```

On the server, record service state, Apache config result, current release hashes, database name, chat row counts, all relationship-manager IDs/emails, X3 portfolio ID/owner/status, and the testing1/leticia l interest IDs. Require exactly one approved X3, one testing1 active interest, and at least one explicit manager candidate. Stop before writes if any identity is ambiguous.

Also verify that these targets do not already exist:

```bash
test ! -e /home/user/lumilabs-quarantine-20260722-managed-chat
test ! -e /var/www/html-next-managed-chat
test ! -e /var/www/html-pre-managed-chat-20260722
test ! -e /var/www/lumilabs-backend-next-managed-chat
test ! -e /var/www/lumilabs-backend-pre-managed-chat-20260722
sudo systemctl is-active lumilabs-backend apache2
sudo apache2ctl configtest
```

Expected: clean branch, both services active, Apache syntax OK, and no collision with dated backup/staging paths.

Before recording the release commit, fetch `origin`, rebase the isolated feature branch onto the latest `origin/main`, resolve conflicts without discarding newer teammate work, and rerun Task 12's complete gate. Record both the rebased release commit and the `origin/main` commit used as its base; deploy only that exact release commit.

- [ ] **Step 2: Back up every mutated table and the current deployment**

On the server:

```bash
umask 077
release_backup_dir=/home/user/lumilabs-quarantine-20260722-managed-chat
mkdir -m 0700 "$release_backup_dir"
sudo cp -a /var/www/lumilabs-backend "$release_backup_dir/backend-before"
sudo cp -a /var/www/html "$release_backup_dir/webroot-before"
sudo cp -a /etc/systemd/system/lumilabs-backend.service "$release_backup_dir/lumilabs-backend.service.before"
sudo cp -a /etc/apache2/sites-available/000-default.conf "$release_backup_dir/000-default.conf.before"
cd /var/www/lumilabs-backend
set -a
. ./.env
set +a
MYSQL_PWD="$DB_PASSWORD" mysqldump \
  --host="${DB_HOST:-127.0.0.1}" --port="${DB_PORT:-3306}" \
  --user="$DB_USER" --single-transaction --routines=false --triggers \
  "$DB_NAME" users conversations conversation_members messages notifications \
  | gzip -9 > "$release_backup_dir/managed-chat-tables.sql.gz"
gzip -t "$release_backup_dir/managed-chat-tables.sql.gz"
sha256sum "$release_backup_dir/managed-chat-tables.sql.gz" \
  > "$release_backup_dir/managed-chat-tables.sql.gz.sha256"
```

If an optional chat table is absent, create two dumps: one schema/data dump of tables that exist plus a signed preflight inventory stating which chat tables were absent. Never omit users or notifications.

- [ ] **Step 3: Prove the database backup can be restored before migration**

Use the exact scratch database `lumi5_restorecheck_20260722_managed_chat`. Assert it does not exist, create it, restore the gzip stream into it with the live MySQL client, compare users/messages/notifications counts to the preflight inventory, then drop only that exact scratch database. Save the verified restore command to `$release_backup_dir/RESTORE.txt` with no password value.

Expected: restore count checks match, the scratch database is removed, and `RESTORE.txt` describes both database restore and filesystem/service rollback.

- [ ] **Step 4: Upload private backend staging files and run the guarded migration**

Create `/var/www/lumilabs-backend-next-managed-chat` with the same owner/group/mode as the current backend. Upload the backend paths from `runtime-manifest.txt` there, stripping the leading `backend/`, plus the private files `migrate.js`, `schema.sql`, `scripts/migrate-managed-chat.js`, and `scripts/seed-managed-chat.js`. Copy the current `.env` and uploads into this private staged directory with their existing restrictive permissions. Do not upload tests, docs, local dependencies, or credentials from the workstation. Compare local/remote SHA-256 values before installation.

Run `npm ci --omit=dev` in staging and verify that its file set is exactly the backend manifest subset plus `.env`, uploads, node_modules, `migrate.js`, `schema.sql`, and the two private migration/seed scripts. Stop `lumilabs-backend` and confirm it is inactive before the first schema write so the old direct-message process cannot write during reset. Atomically rename `/var/www/lumilabs-backend` to `/var/www/lumilabs-backend-pre-managed-chat-20260722`, rename the staged directory to `/var/www/lumilabs-backend`, then execute:

```bash
cd /var/www/lumilabs-backend
set -a
. ./.env
set +a
CHAT_BACKUP_VERIFIED=BACKUP_AND_RESTORE_COMMAND_VERIFIED \
CONFIRM_CHAT_RESET=RESET_LUMILABS_CHAT_ONLY_20260722 \
npm run migrate:managed-chat
```

Expected: migration reports unchanged protected-table/unrelated-notification counts and readiness passes. On any mismatch, keep the service stopped, restore the SQL backup and prior backend immediately, restart the prior service, and do not stage the frontend.

- [ ] **Step 5: Restart and verify the private API before public frontend cutover**

```bash
sudo systemctl restart lumilabs-backend
sudo systemctl is-active lumilabs-backend
curl --fail --silent http://127.0.0.1:3100/api/health
curl --fail --silent http://127.0.0.1:3100/api/ready
sudo journalctl -u lumilabs-backend -n 100 --no-pager
```

Expected: active service, `{"status":"ok"}`, `{"status":"ready"}`, and no schema, SQL, crash-loop, credential, or stack-trace leak.

- [ ] **Step 6: Stage and atomically cut over the exact public frontend**

Create `/var/www/html-next-managed-chat`, upload only non-`backend/` manifest paths while preserving their relative directories, and verify exact file-set equality against that frontend subset. Scan the staged tree for `.env`, tests, docs, backend code, localhost, port 3000/3001, and raw API origins.

Then:

```bash
sudo mv /var/www/html /var/www/html-pre-managed-chat-20260722
sudo mv /var/www/html-next-managed-chat /var/www/html
sudo apache2ctl configtest
sudo systemctl reload apache2
```

Expected: atomic rename succeeds, Apache config is OK, and `/api/health` plus all four HTML entry pages return 200 through the public origin.

- [ ] **Step 7: Run the self-cleaning live smoke before permanent seed**

From the private backend directory with the existing database tunnel/environment:

```bash
cd /var/www/lumilabs-backend
set -a
. ./.env
set +a
LUMILABS_E2E_ORIGIN=http://35.212.144.149 npm run smoke:live
```

Expected: `Live four-role managed chat smoke passed`, followed by explicit zero-row cleanup checks for every temporary ID. If it fails, restore the prior frontend/backend/database and service configuration; do not seed X3.

- [ ] **Step 8: Seed and verify the permanent X3/testing1 room**

Use the explicit relationship-manager ID or email selected during Step 1, explicit X3 portfolio ID, and explicit testing1 user ID. Run the seed with:

```bash
CONFIRM_MANAGED_CHAT_SEED=SEED_X3_TESTING1_MANAGED_CHAT \
MANAGED_CHAT_SEED_KEY=managed-chat-demo-v1 \
MANAGED_CHAT_MANAGER_ID="$MANAGED_CHAT_SELECTED_MANAGER_ID" \
MANAGED_CHAT_PORTFOLIO_ID="$MANAGED_CHAT_X3_PORTFOLIO_ID" \
MANAGED_CHAT_INVESTOR_ID="$MANAGED_CHAT_TESTING1_USER_ID" \
npm run seed:managed-chat
```

The three ID variables must be assigned from the unambiguous read-only Step 1 results in the same protected shell session; print only IDs, never credentials. Run the seed twice: first run must report created; second run must report existing with the same room and message IDs.

Log in through public HTTP as the selected manager, Beta, and testing1 and verify all three exact messages, sender names/roles, refresh persistence, own-right/others-left behavior, and active composer. Verify leticia l appears as eligible in the assigned manager's dashboard but is not yet a member.

- [ ] **Step 9: Run final security, privacy, and public-file checks**

Verify anonymous `401`; wrong-role manager/admin room access `403`; removed/nonmember access `403`; a fabricated conversation ID leaks no participants; private files such as `/backend/.env`, `/backend/server.js`, migration scripts, tests, and backups return `404`; the webroot exactly matches the frontend manifest subset; Apache/backend remain active; logs contain no credentials.

Keep `/var/www/html-pre-managed-chat-20260722`, `/var/www/lumilabs-backend-pre-managed-chat-20260722`, and the dated quarantine until Git publication and a final teammate check are complete.

- [ ] **Step 10: Finish the branch, merge safely, and push main**

Invoke `superpowers:finishing-a-development-branch`. Re-run:

```bash
git status --short
git diff --check
cd backend && npm test && cd ..
git fetch origin
git log --oneline --left-right --cherry-pick main...origin/main
```

If `origin/main` is still the exact base commit recorded in Step 1, fast-forward local main to the deployed release commit. If `origin/main` advanced during deployment, stop publication: rebase the feature branch, preserve the newer teammate changes, rerun the full local gate, redeploy the new exact commit through Steps 4–9, and repeat the live smoke before moving main. Never push a commit different from the one currently deployed and verified. Push only after the working tree is clean and live evidence remains green:

```bash
git push origin main
git rev-parse HEAD
git rev-parse origin/main
```

Expected: both hashes match. Do not force-push.

- [ ] **Step 11: Retain rollback evidence and report the exact outcome**

Report the deployed commit hash, local test totals, readiness/smoke results, permanent room ID, explicit participant IDs/roles, protected counts before/after migration, public file-set result, and backup/quarantine locations. Keep the SQL/deployment backups permission-restricted. Removing the prior webroot or backup requires a later explicit cleanup approval after teammates confirm the release.

## Rollback Procedure

If any critical live check fails before Git publication:

1. stop `lumilabs-backend`;
2. move the failed webroot to `/var/www/html-failed-managed-chat-20260722` and restore `/var/www/html-pre-managed-chat-20260722`;
3. move the failed backend to `/var/www/lumilabs-backend-failed-managed-chat-20260722` and restore `/var/www/lumilabs-backend-pre-managed-chat-20260722` (or `backend-before` if the rename never completed);
4. restore the exact database dump using the verified command in `RESTORE.txt`;
5. restore systemd/Apache configuration files from quarantine;
6. run `daemon-reload`, Apache config test, and restart both services;
7. verify old health, readiness appropriate to the old schema, and prior owner/investor/admin flows;
8. report the failed check and leave Git unpushed.

Never improvise a partial schema repair on the live database after the guarded reset.
