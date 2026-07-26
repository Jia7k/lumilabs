# Five-Role Superadmin Assignment Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved five-role, database-backed workflow from portfolio submission through admin moderation, superadmin assignment, relationship-manager group-chat management, and persistent multi-party messaging.

**Architecture:** `portfolios.relationship_manager_id` is the canonical assignment, with a transactional service keeping it aligned with the conversation manager and sole active manager membership after a chat exists. Separate services own superadmin assignment, staff provisioning, relationship-manager reads, conversation membership, moderation, and messaging; thin role-guarded routes expose them. The release first rebases the approved specification over the latest teammate work, then deploys only an explicit runtime allowlist after a verified database backup and an idempotent, data-preserving migration.

**Tech Stack:** Node.js 24, Express 4, MySQL 8/InnoDB through `mysql2/promise`, JWT, `bcryptjs` cost 10, `express-validator`, static HTML/CSS/vanilla JavaScript, Node's built-in `node:test`, Apache 2.4, systemd, SSH/SFTP, Git.

## Global Constraints

- The only roles are `business_owner`, `investor`, `relationship_manager`, `admin`, and `superadmin`; `users.role` is `NOT NULL` with no default.
- Public registration creates only business owners or investors. No UI or API creates a superadmin.
- Admins only moderate portfolios and view moderation audit history. Superadmins only manage assignments, create admins/RMs, and view superadmin audit history.
- Only approved portfolios may be newly assigned or reassigned. A pre-chat retained assignment may be unassigned in any portfolio status.
- A portfolio has at most one lifetime conversation. Once a chat exists, the portfolio cannot be unassigned and must be reassigned.
- The canonical post-chat invariant is `portfolios.relationship_manager_id = conversations.relationship_manager_id = sole active relationship_manager membership`.
- Business owners are added to chats automatically. Chat creation requires one or more current interests and supports multiple investors.
- Manual investor removal preserves the interest and all history. Interest withdrawal removes active membership and the interest atomically while preserving history.
- Ordinary investors see messages only after their current join boundary. A newly assigned relationship manager receives the full existing history.
- Non-approved portfolios retain assignments and archive chats read-only. Reapproval reactivates only with an active interested investor.
- Preserve all existing users, portfolios, interests, documents, conversations, memberships, messages, notifications, and both audit histories.
- Do not run the destructive managed-chat reset, convert roles, delete production messages, clean broad SFTP paths, edit `.env`, replace uploads, reload Apache, or restart any service except `lumilabs-backend.service`.
- Preserve teammate commits `c6b71f2`, `012b3f4`, `ab8a26e`, and `1ea0f33` where compatible; specifically retain the standardized account menu/modal and investor score-circle UI.
- Pin Tabler to `@3.0.0`, use one release key `20260727.1` for all changed shared frontend assets, and pass desktop plus 390-pixel layout checks.
- Workflow errors use `400`, `401`, `403`, `404`, `409`, or generic `500` exactly as defined in the approved design.
- Every mutation uses portfolio-first row locking, one connection, one transaction, rollback on failure, and stable duplicate-key-to-`409` translation.
- Never put SFTP, sudo, SQL, JWT, or test-account passwords in source, commands, Git history, logs, or tool output; enter them only at hidden prompts.

---

## File and Responsibility Map

### New backend units

- `backend/scripts/migrate-five-role-workflow.js`: guarded, idempotent, data-preserving schema upgrade and verification.
- `backend/src/services/superadmin-assignment-workflow.js`: assign, reassign, and pre-chat unassign transactions.
- `backend/src/services/staff-provisioning-workflow.js`: transactional admin/RM creation and audit.
- `backend/src/services/superadmin-read-model.js`: superadmin stats, assignments, manager workload, staff, and audit pagination.
- `backend/src/services/relationship-manager-read-model.js`: assigned-only dashboard and read-only portfolio/document view.
- `backend/test/five-role-workflow-migration.test.js`: additive/no-op migration and preservation coverage.
- `backend/test/superadmin-assignment-workflow.test.js`: assignment invariants, recipients, audit, locking, and rollback.
- `backend/test/staff-provisioning-workflow.test.js`: validation, hashing, duplicate handling, safe response, and rollback.
- `backend/test/superadmin-read-model.test.js`: exact superadmin read shapes and allowed-action reasons.
- `backend/test/superadmin-route.test.js`: superadmin route validation and authorization.
- `backend/test/superadmin-client.test.js`: protected superadmin dashboard behavior.
- `backend/test/assignments-client.test.js`: assignment UI behavior and recovery.
- `backend/scripts/live-five-role-smoke.js`: self-cleaning five-role production smoke.

### Backend units to modify

- `backend/schema.sql`, `backend/src/schema-contract.js`, and `backend/test/fixtures/production-schema-metadata.json`: exact verified ten-table schema.
- `backend/migrate.js` and `backend/package.json`: expose only the safe five-role migration.
- `backend/src/routes/superadmin.js`: replace the incoming direct-update route with the final router factory.
- `backend/src/routes/admin.js`: retain moderation only; remove staff/user administration.
- `backend/src/routes/relationship-manager.js`: assigned-only reads plus create/add/remove membership routes.
- `backend/src/routes/portfolios.js`: explicit five-role detail/document authorization.
- `backend/src/routes/interests.js`: positive IDs and withdrawal integration.
- `backend/src/routes/notifications.js`: preserve access isolation while allowing history-safe removal/reassignment notices.
- `backend/src/services/managed-conversation-workflow.js`: assignment enforcement, add/remove/withdraw, and automatic lifecycle.
- `backend/src/services/workflow.js`: interest recipients and approval reconciliation.
- `backend/src/services/group-message-workflow.js`: preserve membership/history boundaries and stable authorization.
- `backend/server.js`: dependency-injected superadmin and relationship-manager routers.
- `backend/scripts/seed-managed-chat.js`: require an audited assignment instead of silently assigning.
- `backend/deploy/runtime-manifest.txt`: exact final frontend/backend release allowlist.

### Frontend units to modify

- `index.html`, `signin.html`, `js/script.js`, and `js/api.js`: five-role entry routing and final API client.
- `superadmindashboard.html` and `js/superadmindashboard.js`: protected overview, staff creation/directory, workload, and audit.
- `assignments.html` and `js/assignments.js`: safe assign/reassign/unassign workspace.
- `moderatordashboard.html` and `js/moderatordashboard.js`: moderation-only admin surface.
- `relationshipmanagerdashboard.html` and `js/relationshipmanagerdashboard.js`: every assigned portfolio, read-only details/documents, and investor membership controls.
- `messages.html` and `js/messages.js`: persistent composer, active participants, five-role routing, archived copy, and revoked-access reconciliation.
- `businessownerdashboard.html`, `investordashboard.html`, `mybusinesses.html`, `my-interests.html`, `browse.html` and their scripts: assignment-aware labels and notifications.
- `css/style.css`: protected loading states, responsive superadmin/RM layouts, disabled reasons, accessible modals, and `[hidden]` correctness.

### Retired release paths

- Delete `backend/scripts/migrate-managed-chat.js`; remove `migrate:managed-chat`.
- Rename `backend/scripts/live-four-role-smoke.js` to `backend/scripts/live-five-role-smoke.js`.
- Remove the admin relationship-manager account endpoints and RM manual archive/reopen endpoints.

---

### Task 1: Rebase the Approved Specification onto Latest `origin/main`

**Files:**
- Preserve: `docs/superpowers/specs/2026-07-27-five-role-superadmin-assignment-workflow-design.md`
- Integrate from remote: `superadmindashboard.html`, `assignments.html`, `js/superadmindashboard.js`, `js/assignments.js`, `backend/src/routes/superadmin.js`, and teammate-touched UI files

**Interfaces:**
- Consumes: clean local `main` containing specification commit `96c7829` and
  this implementation-plan commit; `origin/main` at or beyond `1ea0f33`.
- Produces: local `main` based on the latest remote tip with both approved
  documentation commits replayed above it; no force-push and no production
  change.

- [ ] **Step 1: Establish a recoverable pre-rebase reference**

Run:

```bash
test -z "$(git status --porcelain)"
git fetch origin main
git branch codex/pre-five-role-20260727 HEAD
git rev-list --left-right --count origin/main...HEAD
```

Expected: the worktree check succeeds, the safety branch points to the plan
commit, and the divergence is `4 2` when the remote is still `1ea0f33`. If the
remote advanced, inspect the additional commits before continuing.

- [ ] **Step 2: Rebase without force or destructive conflict commands**

Run:

```bash
git rebase origin/main
```

Expected: the specification and plan commits are replayed cleanly over teammate
work. If any conflict appears, run `git rebase --abort`, inspect the
conflicting remote commit, and revise this task before retrying; do not guess
through conflicts.

- [ ] **Step 3: Verify all required teammate commits remain ancestors**

Run:

```bash
for teammate_commit in c6b71f2 012b3f4 ab8a26e 1ea0f33; do
  git merge-base --is-ancestor "$teammate_commit" HEAD
done
git log --oneline --decorate -7
```

Expected: every ancestry check exits `0`; the plan is the top commit, the
approved specification is directly below it, and both sit over the four
teammate commits.

- [ ] **Step 4: Record the known incoming baseline before feature edits**

Run:

```bash
npm --prefix backend test
```

Expected on the surveyed `1ea0f33` baseline: 322 of 336 tests pass and 14 fail—nine portfolio-editor role-menu failures, two frontend-contract failures, and three obsolete destructive-migration failures. Any different failure group must be diagnosed before feature work so teammate regressions are not hidden.

- [ ] **Step 5: Confirm the rebase itself introduced no uncommitted edits**

Run:

```bash
git status --short --branch
git diff --check
```

Expected: clean `main`, ahead of `origin/main` only by the two replayed
documentation commits, and no whitespace errors. This task creates no
additional commit.

---

### Task 2: Make the Repository Schema Match the Verified Five-Role Database

**Files:**
- Modify: `backend/schema.sql`
- Modify: `backend/src/schema-contract.js`
- Modify: `backend/test/fixtures/production-schema-metadata.json`
- Modify: `backend/test/schema-contract.test.js`
- Modify: `backend/test/managed-chat-schema.test.js`

**Interfaces:**
- Consumes: the verified MySQL 8 metadata described in the approved specification.
- Produces: `FINAL_ROLE_COLUMN_TYPE`, `FINAL_NOTIFICATION_COLUMN_TYPE`, `EXPECTED_SCHEMA`, and `verifyPreservedCoreSchema(metadata)` that accept only the prior safe four-role shape or exact final five-role shape.

- [ ] **Step 1: Write failing exact-contract tests**

Add assertions equivalent to:

```js
const FINAL_ROLES = [
  'business_owner',
  'investor',
  'relationship_manager',
  'admin',
  'superadmin',
];

const FINAL_NOTIFICATION_TYPES = [
  'new_message',
  'new_interest',
  'portfolio_approved',
  'portfolio_rejected',
  'portfolio_needs_changes',
  'portfolio_submitted',
  'conversation_created',
  'conversation_member_added',
  'conversation_archived',
  'portfolio_assigned',
  'portfolio_reassigned',
  'portfolio_unassigned',
  'conversation_member_removed',
];

test('canonical metadata has ten tables and the final role contract', () => {
  assert.equal(schema.tableNames.length, 10);
  assert.deepEqual(schema.roleValues, FINAL_ROLES);
  assert.equal(schema.roleNullable, false);
  assert.equal(schema.roleDefault, null);
  assert.deepEqual(schema.notificationValues, FINAL_NOTIFICATION_TYPES);
  assert.equal(schema.portfolios.relationship_manager_id.delete_rule, 'SET NULL');
  assert.match(
    schema.conversation_members.singleton_role.generation_expression,
    /membership_status.*active.*relationship_manager.*business_owner/i
  );
  assert.ok(schema.tables.superadmin_audit_logs);
});
```

Also assert that a historical three-role/default-owner shape is rejected, while the prior four-role/no-default source shape remains an accepted migration input.

- [ ] **Step 2: Run the schema tests and observe the old contract**

Run:

```bash
node --test \
  backend/test/schema-contract.test.js \
  backend/test/managed-chat-schema.test.js
```

Expected: failures report the missing `superadmin` role, portfolio assignment column, notification values, active-only singleton expression, and `superadmin_audit_logs`.

- [ ] **Step 3: Update the source schema with the exact final definitions**

Use these literal role and membership definitions in `backend/schema.sql`:

```sql
role ENUM(
  'business_owner',
  'investor',
  'relationship_manager',
  'admin',
  'superadmin'
) NOT NULL,

relationship_manager_id INT NULL,
KEY idx_portfolios_relationship_manager (relationship_manager_id),
CONSTRAINT fk_portfolios_relationship_manager
  FOREIGN KEY (relationship_manager_id) REFERENCES users(id)
  ON DELETE SET NULL,

singleton_role VARCHAR(24)
  GENERATED ALWAYS AS (
    CASE
      WHEN membership_status = 'active'
       AND member_role IN ('relationship_manager','business_owner')
      THEN member_role
      ELSE NULL
    END
  ) STORED,
UNIQUE KEY uq_conversation_active_singletons
  (conversation_id, singleton_role)
```

Set the notification enum to the 13 values from Step 1. Define `superadmin_audit_logs` from the verified live `SHOW CREATE TABLE` output, preserving its five action values, immutable actor/portfolio/old-manager/new-manager/created-user snapshots, timestamp, six access indexes including the primary key, and five `ON DELETE SET NULL` foreign keys. Do not infer or reorder live columns: copy their names, types, defaults, generated expressions, collations, and ordinal positions exactly into both the source schema and fixture.

- [ ] **Step 4: Align the JavaScript contract and captured production fixture**

Define the same enum strings centrally in `backend/src/schema-contract.js`:

```js
const FINAL_ROLE_COLUMN_TYPE =
  "enum('business_owner','investor','relationship_manager','admin','superadmin')";

const FINAL_NOTIFICATION_COLUMN_TYPE =
  "enum('new_message','new_interest','portfolio_approved','portfolio_rejected'," +
  "'portfolio_needs_changes','portfolio_submitted','conversation_created'," +
  "'conversation_member_added','conversation_archived','portfolio_assigned'," +
  "'portfolio_reassigned','portfolio_unassigned','conversation_member_removed')";

const SUPPORTED_UPGRADE_ROLE_TYPES = new Set([
  "enum('business_owner','investor','relationship_manager','admin')",
  FINAL_ROLE_COLUMN_TYPE,
]);
```

Update `EXPECTED_SCHEMA` to ten tables and the exact portfolio, membership, notification, and superadmin-audit metadata. Replace only the affected objects in `production-schema-metadata.json` with literal values captured from the verified live database; retain existing unrelated table metadata byte-for-byte.

- [ ] **Step 5: Re-run focused schema tests**

Run:

```bash
node --test \
  backend/test/schema-contract.test.js \
  backend/test/managed-chat-schema.test.js
```

Expected: all focused tests pass, including exact table/column/index/FK counts and rejection of unsafe historical role defaults.

- [ ] **Step 6: Commit the canonical contract**

Run:

```bash
git add \
  backend/schema.sql \
  backend/src/schema-contract.js \
  backend/test/fixtures/production-schema-metadata.json \
  backend/test/schema-contract.test.js \
  backend/test/managed-chat-schema.test.js
git commit -m "feat(schema): align source with five-role workflow"
```

Expected: one focused schema commit with no migration or application behavior mixed in.

---

### Task 3: Replace the Destructive Reset with a Guarded Additive Migration

**Files:**
- Create: `backend/scripts/migrate-five-role-workflow.js`
- Create: `backend/test/five-role-workflow-migration.test.js`
- Modify: `backend/migrate.js`
- Modify: `backend/package.json`
- Delete: `backend/scripts/migrate-managed-chat.js`

**Interfaces:**
- Consumes: `verifyPreservedCoreSchema(metadata)` and the exact final contract from Task 2.
- Produces:

```js
class FiveRoleMigrationError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'FiveRoleMigrationError';
    this.code = code;
  }
}

async function migrateFiveRoleWorkflow(connection, environment = process.env)
function assertMigrationGuards(environment)
```

`migrateFiveRoleWorkflow()` returns:

```js
{
  changed: [],
  backfilled_assignments: 0,
  before: {
    users: 0,
    portfolios: 0,
    portfolio_documents: 0,
    investor_interests: 0,
    conversations: 0,
    conversation_members: 0,
    messages: 0,
    notifications: 0,
    audit_logs: 0,
    superadmin_audit_logs: 0
  },
  after: {
    users: 0,
    portfolios: 0,
    portfolio_documents: 0,
    investor_interests: 0,
    conversations: 0,
    conversation_members: 0,
    messages: 0,
    notifications: 0,
    audit_logs: 0,
    superadmin_audit_logs: 0
  }
}
```

- [ ] **Step 1: Write preservation and guard tests before the script**

Cover the no-op, additive, conflict, rerun, and forbidden-SQL cases with concrete assertions:

```js
const confirmedEnvironment = {
  WORKFLOW_BACKUP_VERIFIED: 'BACKUP_AND_RESTORE_COMMAND_VERIFIED',
  CONFIRM_FIVE_ROLE_WORKFLOW_MIGRATION:
    'APPLY_LUMILABS_FIVE_ROLE_WORKFLOW_20260727',
};

test('already migrated metadata is a no-op and preserves identities', async () => {
  const connection = migrationHarness(finalMetadata);
  const result = await migrateFiveRoleWorkflow(connection, confirmedEnvironment);
  assert.deepEqual(result.changed, []);
  assert.equal(result.backfilled_assignments, 0);
  assert.deepEqual(result.after, result.before);
  assert.equal(connection.mutations.length, 0);
});

test('manager mismatch aborts before schema or data mutation', async () => {
  const connection = migrationHarness(priorMetadata, {
    managerConflicts: [{ portfolio_id: 9, portfolio_manager_id: 4, conversation_manager_id: 7 }],
  });
  await assert.rejects(
    migrateFiveRoleWorkflow(connection, confirmedEnvironment),
    error => error.code === 'ASSIGNMENT_CONFLICT'
  );
  assert.deepEqual(connection.mutations, []);
});

test('generated migration SQL cannot reset protected data', () => {
  const source = readFileSync(migrationPath, 'utf8');
  assert.doesNotMatch(source, /DROP\s+TABLE/i);
  assert.doesNotMatch(source, /TRUNCATE/i);
  assert.doesNotMatch(source, /DELETE\s+FROM\s+(messages|conversation_members|conversations)/i);
  assert.doesNotMatch(source, /SET\s+role\s*=\s*['"]admin['"].*superadmin/is);
});
```

Add cases for null-only backfill, non-RM assigned users, duplicate active singletons, partially applied reruns, and exact preservation of protected row counts and message/member identity pairs.

- [ ] **Step 2: Run the new migration test and verify it fails safely**

Run:

```bash
node --test backend/test/five-role-workflow-migration.test.js
```

Expected: failure because `migrate-five-role-workflow.js` does not exist; no database command runs.

- [ ] **Step 3: Implement explicit production guards**

Use exact, non-secret confirmations:

```js
function assertMigrationGuards(environment) {
  if (environment.WORKFLOW_BACKUP_VERIFIED !== 'BACKUP_AND_RESTORE_COMMAND_VERIFIED') {
    throw new FiveRoleMigrationError(
      'A verified database backup is required',
      'BACKUP_NOT_VERIFIED'
    );
  }
  if (
    environment.CONFIRM_FIVE_ROLE_WORKFLOW_MIGRATION !==
    'APPLY_LUMILABS_FIVE_ROLE_WORKFLOW_20260727'
  ) {
    throw new FiveRoleMigrationError(
      'Five-role migration confirmation is required',
      'CONFIRMATION_REQUIRED'
    );
  }
}
```

Acquire `GET_LOCK('lumilabs-five-role-workflow-20260727', 30)` and always release it in `finally`. Query metadata and protected counts before mutation.

- [ ] **Step 4: Implement conflict-first, idempotent upgrade sequencing**

The script must execute this order:

```js
await assertNoPortfolioConversationManagerConflicts(connection);
await assertAssignedUsersAreRelationshipManagers(connection);
await assertNoDuplicateActiveSingletons(connection);

await ensureFiveRoleEnum(connection, changed);
await ensurePortfolioAssignmentColumnIndexAndForeignKey(connection, changed);
await backfillNullAssignmentsFromConversationManagers(connection, result);
await ensureActiveOnlySingletonExpression(connection, changed);
await ensureFinalNotificationEnum(connection, changed);
await ensureSuperadminAuditTable(connection, changed);
await verifyFinalSchema(connection);
await verifyProtectedRowsAndIdentities(connection, result.before, result.after);
```

Every `ensure*` helper must read `information_schema` first and issue DDL only when that exact object is missing or differs. Backfill only:

```sql
UPDATE portfolios p
JOIN conversations c ON c.portfolio_id = p.id
SET p.relationship_manager_id = c.relationship_manager_id
WHERE p.relationship_manager_id IS NULL
```

If a non-null assignment conflicts with the conversation manager, abort before any DDL or DML. DDL autocommit means the script must be safely rerunnable after every individual `ensure*` operation.

- [ ] **Step 5: Wire only the safe entry point**

In `backend/migrate.js`, replace the old import/call with:

```js
const {
  migrateFiveRoleWorkflow,
} = require('./scripts/migrate-five-role-workflow');

const result = await migrateFiveRoleWorkflow(connection, environment);
console.log(JSON.stringify(result));
```

In `backend/package.json`, replace the old script with:

```json
"migrate:five-role-workflow": "node migrate.js"
```

Delete `backend/scripts/migrate-managed-chat.js`. No command or import may retain a reachable reset path.

- [ ] **Step 6: Run migration and schema tests**

Run:

```bash
node --test \
  backend/test/schema-contract.test.js \
  backend/test/managed-chat-schema.test.js \
  backend/test/five-role-workflow-migration.test.js
```

Expected: all cases pass, including no-op verification, null-only backfill, partial rerun, guard rejection, and forbidden-SQL scans.

- [ ] **Step 7: Commit the safe migration**

Run:

```bash
git add \
  backend/migrate.js \
  backend/package.json \
  backend/scripts/migrate-five-role-workflow.js \
  backend/scripts/migrate-managed-chat.js \
  backend/test/five-role-workflow-migration.test.js
git commit -m "feat(schema): add preserving five-role migration"
```

Expected: Git records the old migration deletion and new guarded entry point in one commit.

---

### Task 4: Implement Transactional Assignment, Reassignment, and Unassignment

**Files:**
- Create: `backend/src/services/superadmin-assignment-workflow.js`
- Create: `backend/test/superadmin-assignment-workflow.test.js`

**Interfaces:**
- Consumes: the final assignment, membership, notification, and audit schema from Tasks 2–3.
- Produces:

```js
class SuperadminAssignmentError extends Error {
  constructor(status, message, code) {
    super(message);
    this.name = 'SuperadminAssignmentError';
    this.status = status;
    this.code = code;
  }
}

async function assignPortfolio({
  database,
  superadminId,
  portfolioId,
  relationshipManagerId,
})

async function unassignPortfolio({
  database,
  superadminId,
  portfolioId,
})
```

Successful assignment returns:

```js
{
  changed: true,
  action: 'portfolio_assigned',
  portfolio: { id: 1, name: 'Example', status: 'approved' },
  previous_relationship_manager: null,
  relationship_manager: { id: 7, name: 'Manager', email: 'manager@example.test' },
  conversation_id: null
}
```

`action` becomes `portfolio_reassigned` for a change from one manager to another; an idempotent same-manager call returns `changed: false` and `action: null`.

- [ ] **Step 1: Write service tests around observable transaction effects**

Build a scripted connection harness and cover exact success/failure effects:

```js
test('post-chat reassignment transfers only the manager and grants full history', async () => {
  const database = assignmentHarness(postChatFixture);
  const result = await assignPortfolio({
    database,
    superadminId: 1,
    portfolioId: 20,
    relationshipManagerId: 8,
  });

  assert.equal(result.action, 'portfolio_reassigned');
  assert.deepEqual(database.activeMembers(40, 'relationship_manager'), [8]);
  assert.equal(database.member(40, 7).membership_status, 'removed');
  assert.equal(database.member(40, 8).visible_after_message_id, 0);
  assert.deepEqual(database.messageIds(40), [101, 102, 103]);
  assert.deepEqual(database.activeInvestorIds(40), [11, 12]);
  assert.deepEqual(database.auditActions(), ['portfolio_reassigned']);
  assert.deepEqual(database.notificationRecipientIds(), [7, 8, 9]);
  assert.equal(database.commits, 1);
});

test('same-manager request is a no-op', async () => {
  const database = assignmentHarness(assignedFixture);
  const result = await assignPortfolio({
    database,
    superadminId: 1,
    portfolioId: 20,
    relationshipManagerId: 7,
  });
  assert.deepEqual(result, {
    changed: false,
    action: null,
    portfolio: { id: 20, name: 'Example', status: 'approved' },
    previous_relationship_manager: { id: 7, name: 'Old Manager', email: 'old@example.test' },
    relationship_manager: { id: 7, name: 'Old Manager', email: 'old@example.test' },
    conversation_id: null,
  });
  assert.equal(database.writeCount, 0);
});
```

Also cover initial assignment, pre-chat reassignment, unapproved assign/reassign, wrong target role, actor not superadmin, portfolio/conversation mismatch, null assignment with existing chat corruption, post-chat unassignment `409`, pre-chat unassignment in a retained non-approved status, duplicate-key translation, and rollback after each write boundary.

- [ ] **Step 2: Run the service test and confirm the module is absent**

Run:

```bash
node --test backend/test/superadmin-assignment-workflow.test.js
```

Expected: failure with `MODULE_NOT_FOUND` for `superadmin-assignment-workflow`.

- [ ] **Step 3: Implement validation and the portfolio-first transaction shell**

Use one connection and preserve the original failure even if rollback fails:

```js
async function inTransaction(database, work) {
  const connection = await database.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    try {
      await connection.rollback();
    } catch (rollbackError) {
      console.error('Assignment rollback failed', rollbackError);
    }
    throw translateDuplicateError(error);
  } finally {
    connection.release();
  }
}
```

Normalize every ID with `Number.isSafeInteger(id) && id > 0` before acquiring the connection. Inside the transaction, lock in this order:

```sql
SELECT p.id,p.name,p.status,p.owner_id,p.relationship_manager_id,
       owner.name AS owner_name,owner.email AS owner_email
FROM portfolios p
JOIN users owner ON owner.id=p.owner_id
WHERE p.id=?
FOR UPDATE;

SELECT id,portfolio_id,relationship_manager_id,status,archived_reason
FROM conversations
WHERE portfolio_id=?
FOR UPDATE;

SELECT id,name,email,role
FROM users
WHERE id IN (?,?,?)
ORDER BY id
FOR UPDATE;
```

Validate the acting user is `superadmin`, the target is `relationship_manager`, the portfolio exists, and every non-no-op assignment/reassignment target is `approved`.

- [ ] **Step 4: Implement initial assignment and post-chat reassignment**

For initial assignment, require no conversation and update only the canonical portfolio:

```sql
UPDATE portfolios
SET relationship_manager_id=?
WHERE id=? AND relationship_manager_id <=> ?;
```

For post-chat reassignment, first reject a portfolio/conversation manager mismatch, then perform:

```sql
UPDATE conversation_members
SET membership_status='removed',left_at=CURRENT_TIMESTAMP
WHERE conversation_id=? AND user_id=? AND member_role='relationship_manager'
  AND membership_status='active';

INSERT INTO conversation_members
  (conversation_id,user_id,member_role,membership_status,
   visible_after_message_id,joined_at,left_at,last_read_message_id)
VALUES (?,?,'relationship_manager','active',0,CURRENT_TIMESTAMP,NULL,0)
ON DUPLICATE KEY UPDATE
  member_role='relationship_manager',
  membership_status='active',
  visible_after_message_id=0,
  joined_at=CURRENT_TIMESTAMP,
  left_at=NULL;

UPDATE conversations SET relationship_manager_id=? WHERE id=?;
UPDATE portfolios SET relationship_manager_id=? WHERE id=?;
```

Check affected rows and the sole-active-manager invariant before writing audit/notifications. Never alter owner/investor memberships or message rows.

- [ ] **Step 5: Insert immutable audit snapshots and exact notifications**

Insert one `superadmin_audit_logs` row using the exact snapshot columns established in Task 2. Use:

```js
const recipients = action === 'portfolio_assigned'
  ? [portfolio.owner_id, newManager.id]
  : [portfolio.owner_id, oldManager.id, newManager.id];
```

Deduplicate recipients. New-manager and owner assignment notifications may reference the conversation when they retain access. The previous manager's reassignment notification must set `related_conversation_id` to `NULL` and keep `related_portfolio_id`, because the notification visibility query must not grant or assume current chat membership. Insert audit and notification rows before committing.

- [ ] **Step 6: Implement pre-chat unassignment**

Lock the portfolio and conversation first. Return `changed: false` when already unassigned. Reject with:

```js
throw new SuperadminAssignmentError(
  409,
  'Reassign required because this portfolio already has a chat',
  'CONVERSATION_REQUIRES_REASSIGNMENT'
);
```

when any conversation exists. Otherwise clear the canonical assignment, insert one `portfolio_unassigned` audit snapshot, and notify the former manager and owner with `related_conversation_id=NULL`. Do not require the retained portfolio to remain approved.

- [ ] **Step 7: Run the focused assignment suite**

Run:

```bash
node --test backend/test/superadmin-assignment-workflow.test.js
```

Expected: every transaction, no-op, authorization, recipient, history-preservation, and rollback case passes.

- [ ] **Step 8: Commit the assignment service**

Run:

```bash
git add \
  backend/src/services/superadmin-assignment-workflow.js \
  backend/test/superadmin-assignment-workflow.test.js
git commit -m "feat(superadmin): add transactional portfolio assignment"
```

Expected: one service-layer commit with no route or UI code.

---

### Task 5: Move Staff Provisioning to Superadmin and Enforce Strict Admin Separation

**Files:**
- Create: `backend/src/services/staff-provisioning-workflow.js`
- Create: `backend/test/staff-provisioning-workflow.test.js`
- Modify: `backend/src/routes/admin.js`
- Modify: `backend/test/relationship-manager-admin.test.js`
- Modify: `backend/test/auth-request-boundaries.test.js`

**Interfaces:**
- Consumes: five-role auth middleware and `superadmin_audit_logs`.
- Produces:

```js
class StaffProvisioningError extends Error {
  constructor(status, message, code) {
    super(message);
    this.name = 'StaffProvisioningError';
    this.status = status;
    this.code = code;
  }
}

async function createStaffAccount({
  database,
  superadminId,
  name,
  email,
  password,
  role,
  hashPassword = (value) => bcrypt.hash(value, 10),
})
```

The module imports `const bcrypt = require('bcryptjs')` before defining that default.

The only response fields are:

```js
{ id: 15, name: 'Staff Name', email: 'staff@example.test', role: 'admin', created_at: '2026-07-27T00:00:00.000Z' }
```

- [ ] **Step 1: Write failing service and separation tests**

Add exact tests:

```js
test('creates an admin and its audit row in one transaction', async () => {
  const database = staffHarness();
  const staff = await createStaffAccount({
    database,
    superadminId: 1,
    name: '  New Admin  ',
    email: ' NEW.ADMIN@EXAMPLE.TEST ',
    password: 'secure12',
    role: 'admin',
    hashPassword: async () => 'bcrypt-hash',
  });
  assert.equal(staff.name, 'New Admin');
  assert.equal(staff.email, 'new.admin@example.test');
  assert.equal(staff.role, 'admin');
  assert.equal('password' in staff, false);
  assert.equal('password_hash' in staff, false);
  assert.deepEqual(database.auditActions(), ['admin_account_created']);
  assert.equal(database.commits, 1);
});

test('invalid role performs no hashing or database work', async () => {
  let hashes = 0;
  const database = staffHarness();
  await assert.rejects(
    createStaffAccount({
      database,
      superadminId: 1,
      name: 'Bad Role',
      email: 'bad@example.test',
      password: 'secure12',
      role: 'superadmin',
      hashPassword: async () => {
        hashes += 1;
        return 'unused';
      },
    }),
    error => error.status === 400 && error.code === 'INVALID_STAFF_ROLE'
  );
  assert.equal(hashes, 0);
  assert.equal(database.connections, 0);
});
```

Add route-contract assertions that the three removed admin endpoints return `404`, an admin receives `403` from every superadmin route, and a superadmin receives `403` from approve/reject.

- [ ] **Step 2: Run tests and observe the old admin-owned behavior**

Run:

```bash
node --test \
  backend/test/staff-provisioning-workflow.test.js \
  backend/test/relationship-manager-admin.test.js \
  backend/test/auth-request-boundaries.test.js
```

Expected: the new service is missing and existing tests expose `/api/admin/relationship-managers` and `/api/admin/users`.

- [ ] **Step 3: Implement validation before hashing or database access**

Use:

```js
function normalizeStaffInput({ name, email, password, role }) {
  const normalized = {
    name: typeof name === 'string' ? name.trim() : '',
    email: typeof email === 'string' ? email.trim().toLowerCase() : '',
    password: typeof password === 'string' ? password : '',
    role,
  };
  if (normalized.name.length < 1 || normalized.name.length > 100) {
    throw new StaffProvisioningError(400, 'Name must be 1 to 100 characters', 'INVALID_NAME');
  }
  if (
    normalized.email.length > 255 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized.email)
  ) {
    throw new StaffProvisioningError(400, 'A valid email is required', 'INVALID_EMAIL');
  }
  if (normalized.password.length < 6 || normalized.password.length > 128) {
    throw new StaffProvisioningError(400, 'Password must be 6 to 128 characters', 'INVALID_PASSWORD');
  }
  if (!['admin', 'relationship_manager'].includes(normalized.role)) {
    throw new StaffProvisioningError(400, 'Role must be admin or relationship_manager', 'INVALID_STAFF_ROLE');
  }
  return normalized;
}
```

- [ ] **Step 4: Implement transactional account creation and audit**

Hash with bcrypt cost 10 before beginning the transaction. Inside one transaction:

```sql
SELECT id,name,email,role FROM users WHERE id=? FOR UPDATE;
SELECT id FROM users WHERE email=? FOR UPDATE;
INSERT INTO users (email,password_hash,name,role) VALUES (?,?,?,?);
SELECT id,name,email,role,created_at FROM users WHERE id=?;
```

Require the actor role to be `superadmin`. Insert one `admin_account_created` or `relationship_manager_account_created` snapshot before commit. Translate both the email pre-check and `ER_DUP_ENTRY` race to `409 DUPLICATE_EMAIL`; if the audit insert fails, roll back the user insert. Never log or return the password/hash.

- [ ] **Step 5: Remove staff and general-user endpoints from admin**

Delete these route registrations from `backend/src/routes/admin.js`:

```text
POST /relationship-managers
GET  /relationship-managers
GET  /users
```

Leave only queue, approve, reject, moderation audit, and moderation stats behind `requireRole('admin')`. Keep public `/api/auth/register` restricted to:

```js
body('role').isIn(['business_owner', 'investor'])
```

- [ ] **Step 6: Run focused staff and authorization tests**

Run:

```bash
node --test \
  backend/test/staff-provisioning-workflow.test.js \
  backend/test/relationship-manager-admin.test.js \
  backend/test/auth-request-boundaries.test.js
```

Expected: valid admin/RM creation passes; invalid inputs cause zero side effects; duplicate/audit rollback cases pass; removed admin endpoints return `404`; wrong-role calls return `403`.

- [ ] **Step 7: Commit strict staff ownership**

Run:

```bash
git add \
  backend/src/services/staff-provisioning-workflow.js \
  backend/src/routes/admin.js \
  backend/test/staff-provisioning-workflow.test.js \
  backend/test/relationship-manager-admin.test.js \
  backend/test/auth-request-boundaries.test.js
git commit -m "feat(superadmin): own staff provisioning"
```

Expected: one commit establishes service-level provisioning and removes admin-owned staff APIs.

---

### Task 6: Replace the Incoming Direct-Update API with a Complete Superadmin API

**Files:**
- Create: `backend/src/services/superadmin-read-model.js`
- Create: `backend/test/superadmin-read-model.test.js`
- Create: `backend/test/superadmin-route.test.js`
- Modify: `backend/src/routes/superadmin.js`
- Modify: `backend/server.js`
- Modify: `backend/test/messages-server.test.js`

**Interfaces:**
- Consumes: `assignPortfolio()`, `unassignPortfolio()`, and `createStaffAccount()` from Tasks 4–5.
- Produces:

```js
async function loadSuperadminStats(database)
async function listPortfolioAssignments(database)
async function listRelationshipManagers(database)
async function listStaff(database)
async function listSuperadminAuditLogs(database, { page, limit })

function createSuperadminRouter({
  database,
  assignmentWorkflow = require('../services/superadmin-assignment-workflow'),
  provisioningWorkflow = require('../services/staff-provisioning-workflow'),
  readModel = require('../services/superadmin-read-model'),
})
```

- [ ] **Step 1: Write read-model and route tests**

Assert exact selection rules and route paths:

```js
test('assignment list includes approved portfolios and retained non-approved assignments', async () => {
  const items = await listPortfolioAssignments(readDatabase);
  assert.deepEqual(items.map(item => item.id), [1, 2, 4]);
  assert.equal(items.find(item => item.id === 3), undefined);
  assert.equal(items.find(item => item.id === 2).actions.can_unassign, false);
  assert.equal(
    items.find(item => item.id === 2).actions.unassign_disabled_reason,
    'Reassign required because this portfolio already has a chat'
  );
});

test('router delegates the final assignment path to the workflow', async () => {
  const response = await requestAs('superadmin')
    .put('/api/superadmin/portfolios/20/assignment')
    .send({ relationship_manager_id: 8 });
  assert.equal(response.status, 200);
  assert.deepEqual(assignmentCalls, [{
    database,
    superadminId: 1,
    portfolioId: 20,
    relationshipManagerId: 8,
  }]);
});
```

Cover all eight final routes, malformed IDs and pagination before service calls, `401`, `403`, `404`, workflow status mapping, and generic `500` without internal details. Assert `/assign` no longer exists.

- [ ] **Step 2: Run the tests and expose the raw incoming implementation**

Run:

```bash
node --test \
  backend/test/superadmin-read-model.test.js \
  backend/test/superadmin-route.test.js \
  backend/test/messages-server.test.js
```

Expected: failures show missing read models, the obsolete `/assign` route, no unassign/staff/audit routes, and incomplete app-factory mounting.

- [ ] **Step 3: Implement safe read shapes**

`listPortfolioAssignments()` must select:

```sql
WHERE p.status='approved' OR p.relationship_manager_id IS NOT NULL
```

and return owner, current manager, conversation state, and:

```js
function assignmentActions(row) {
  return {
    can_assign: row.status === 'approved' && row.relationship_manager_id === null,
    assign_disabled_reason:
      row.status !== 'approved' ? 'Portfolio must be approved before assignment' : null,
    can_reassign: row.status === 'approved' && row.relationship_manager_id !== null,
    reassign_disabled_reason:
      row.status !== 'approved' ? 'Portfolio must be approved before reassignment' : null,
    can_unassign: row.relationship_manager_id !== null && row.conversation_id === null,
    unassign_disabled_reason:
      row.conversation_id !== null
        ? 'Reassign required because this portfolio already has a chat'
        : null,
  };
}
```

Stats include role totals, approved/unassigned/assigned portfolio totals, and per-RM assigned/active-room counts. Staff and manager lists expose only IDs, names, emails, roles, and timestamps. Audit pagination returns:

```js
{
  items: auditRows,
  pagination: {
    page,
    limit,
    total,
    total_pages: Math.ceil(total / limit),
  },
}
```

- [ ] **Step 4: Build one router-level authorization boundary**

Start the router with:

```js
const router = express.Router();
router.use(authenticate, requireRole('superadmin'));
```

Register exactly:

```text
GET    /stats
GET    /portfolio-assignments
GET    /relationship-managers
GET    /staff
POST   /staff
PUT    /portfolios/:id/assignment
DELETE /portfolios/:id/assignment
GET    /audit-logs?page=1&limit=50
```

Validate positive safe integer IDs, page `>=1`, and limit `1..100` before service/database access. Delegate every mutation to the Task 4/5 services; the route must contain no `UPDATE` or `INSERT` query.

- [ ] **Step 5: Inject the route through the application factory**

In `backend/server.js`, mount once:

```js
const {
  createSuperadminRouter,
} = require('./src/routes/superadmin');

app.use('/api/superadmin', createSuperadminRouter({ database }));
```

Do not import a prebuilt router tied to the global pool. Keep health/readiness behavior unchanged.

- [ ] **Step 6: Run the focused API suite**

Run:

```bash
node --test \
  backend/test/superadmin-read-model.test.js \
  backend/test/superadmin-route.test.js \
  backend/test/messages-server.test.js
```

Expected: all read-shape, route, dependency-injection, auth, validation, and error-mapping cases pass.

- [ ] **Step 7: Commit the complete superadmin API**

Run:

```bash
git add \
  backend/src/services/superadmin-read-model.js \
  backend/src/routes/superadmin.js \
  backend/server.js \
  backend/test/superadmin-read-model.test.js \
  backend/test/superadmin-route.test.js \
  backend/test/messages-server.test.js
git commit -m "feat(superadmin): expose assignment and staff API"
```

Expected: the unsafe direct-update endpoint is fully replaced.

---

### Task 7: Build the Assigned-Only Relationship-Manager Read Model and Document Access

**Files:**
- Create: `backend/src/services/relationship-manager-read-model.js`
- Modify: `backend/src/routes/relationship-manager.js`
- Modify: `backend/src/routes/portfolios.js`
- Modify: `backend/test/relationship-manager-route.test.js`
- Modify: `backend/test/documents-security.test.js`
- Modify: `backend/test/portfolio-request-boundaries.test.js`

**Interfaces:**
- Consumes: canonical `portfolios.relationship_manager_id` and existing document download service.
- Produces:

```js
async function loadRelationshipManagerDashboard({ database, managerId })
async function loadAssignedPortfolio({ database, managerId, portfolioId })
```

Dashboard shape:

```js
{
  stats: {
    assigned_portfolios: 1,
    approved_portfolios: 1,
    eligible_interests: 2,
    active_rooms: 0,
    unread_messages: 0
  },
  portfolios: [{
    id: 20,
    name: 'Example',
    status: 'approved',
    readiness_score: 85,
    owner: { id: 9, name: 'Owner', email: 'owner@example.test' },
    conversation: null,
    interests: [{
      interest_id: 31,
      investor: { id: 11, name: 'Investor', email: 'investor@example.test' },
      is_active_member: false
    }],
    participants: [],
    documents: [{
      id: 51,
      file_name: 'deck.pdf',
      file_type: 'pitch_deck',
      uploaded_at: '2026-07-27T00:00:00.000Z',
      download_url: '/api/portfolios/20/documents/51/download'
    }],
    actions: {
      can_create_conversation: true,
      create_disabled_reason: null,
      can_add_investors: false,
      add_disabled_reason: 'Create the portfolio chat first'
    }
  }]
}
```

- [ ] **Step 1: Write assigned-visibility and document-authorization tests**

Add concrete cases:

```js
test('dashboard includes every assigned portfolio and no unassigned portfolio', async () => {
  const dashboard = await loadRelationshipManagerDashboard({
    database: readDatabase,
    managerId: 7,
  });
  assert.deepEqual(dashboard.portfolios.map(item => item.id), [20, 21, 22, 23]);
  assert.deepEqual(dashboard.portfolios.map(item => item.status), [
    'approved',
    'draft',
    'pending',
    'rejected',
  ]);
  assert.equal(dashboard.portfolios.some(item => item.id === 99), false);
});

test('assigned manager can download before chat, other manager cannot', async () => {
  assert.equal((await downloadAsManager(7, 20, 51)).status, 200);
  assert.equal((await downloadAsManager(8, 20, 51)).status, 403);
});
```

Cover assigned-with-no-interest visibility, correct action reasons, retained non-approved assignments, no conversation, active/archived conversation, active-only participants, details/documents, malformed IDs, and explicit denial for every wrong role. Add a regression test proving `superadmin` no longer falls through generic portfolio authorization.

- [ ] **Step 2: Run focused route/security tests**

Run:

```bash
node --test \
  backend/test/relationship-manager-route.test.js \
  backend/test/documents-security.test.js \
  backend/test/portfolio-request-boundaries.test.js
```

Expected: failures show the current global “unclaimed approved portfolios” query, missing assigned detail route, and conversation-dependent document authorization.

- [ ] **Step 3: Implement assigned-only read queries**

Every dashboard/detail query must begin from:

```sql
FROM portfolios p
JOIN users owner ON owner.id=p.owner_id
LEFT JOIN conversations c ON c.portfolio_id=p.id
WHERE p.relationship_manager_id=?
```

Load interest candidates only from current `investor_interests`, active participants only from `conversation_members.membership_status='active'`, document metadata from `portfolio_documents`, and unread counts from the manager's active membership cursor. Group rows by portfolio without duplicating interests, documents, or participants.

Use exact action derivation:

```js
function relationshipManagerActions(portfolio) {
  const approved = portfolio.status === 'approved';
  const hasConversation = portfolio.conversation !== null;
  const eligible = portfolio.interests.filter(item => !item.is_active_member);
  return {
    can_create_conversation: approved && !hasConversation && portfolio.interests.length > 0,
    create_disabled_reason:
      !approved
        ? 'Portfolio must be approved before creating a chat'
        : hasConversation
          ? 'This portfolio already has its group chat'
          : portfolio.interests.length === 0
            ? 'Create chat becomes available after an investor expresses interest'
            : null,
    can_add_investors: approved && hasConversation && eligible.length > 0,
    add_disabled_reason:
      !hasConversation
        ? 'Create the portfolio chat first'
        : !approved
          ? 'Portfolio must be approved before adding investors'
          : eligible.length === 0
            ? 'No additional interested investors are available'
            : null,
  };
}
```

- [ ] **Step 4: Add the assigned portfolio route and canonical download check**

Add:

```text
GET /api/relationship-manager/portfolios/:portfolioId
```

behind the router's relationship-manager guard. `loadAssignedPortfolio()` returns `404` when the portfolio does not exist and `403` when it exists but belongs to another manager.

Replace conversation-membership-based RM document authorization in `backend/src/routes/portfolios.js` with:

```sql
SELECT 1
FROM portfolios
WHERE id=? AND relationship_manager_id=?
```

Make every generic detail/download role branch explicit: owner only for owned portfolio, investor only under approved catalog rules, admin under moderation rules, assigned RM through the canonical assignment, and superadmin only through its assignment read model. An unrecognized or unauthorized role returns `403`.

- [ ] **Step 5: Inject the read model through the RM router factory**

Extend:

```js
function createRelationshipManagerRouter({
  database,
  workflows = require('../services/managed-conversation-workflow'),
  readModel = require('../services/relationship-manager-read-model'),
} = {})
```

and ensure `backend/server.js` mounts the factory with the same application database used by readiness and tests.

- [ ] **Step 6: Run focused tests**

Run:

```bash
node --test \
  backend/test/relationship-manager-route.test.js \
  backend/test/documents-security.test.js \
  backend/test/portfolio-request-boundaries.test.js
```

Expected: assigned pre-chat and retained-status reads pass; unassigned/cross-manager and superadmin fallthrough reads are denied; document traversal and ownership security remain green.

- [ ] **Step 7: Commit the assigned read model**

Run:

```bash
git add \
  backend/src/services/relationship-manager-read-model.js \
  backend/src/routes/relationship-manager.js \
  backend/src/routes/portfolios.js \
  backend/server.js \
  backend/test/relationship-manager-route.test.js \
  backend/test/documents-security.test.js \
  backend/test/portfolio-request-boundaries.test.js
git commit -m "feat(relationship-manager): show assigned portfolio workspace"
```

Expected: one commit enables read-only assignment access without changing chat membership yet.

---

### Task 8: Enforce Assignment and Automatic Lifecycle in Conversation Membership

**Files:**
- Modify: `backend/src/services/managed-conversation-workflow.js`
- Modify: `backend/src/routes/relationship-manager.js`
- Modify: `backend/test/managed-conversation-workflow.test.js`
- Modify: `backend/test/managed-conversation-lifecycle.test.js`
- Modify: `backend/test/relationship-manager-route.test.js`
- Modify: `backend/test/group-message-workflow.test.js`

**Interfaces:**
- Consumes: assigned-only authorization from Task 7.
- Produces:

```js
async function removeManagedInvestor({
  database,
  managerId,
  conversationId,
  investorId,
})

async function reconcileConversationAfterApproval(
  connection,
  portfolioId,
  actorId
)
```

The existing `createManagedConversation()`, `addManagedInvestors()`, `archiveConversationForPortfolio()`, and `withdrawInvestorInterest()` remain public with corrected behavior. `archiveManagedConversation()` and `reopenManagedConversation()` are removed.

- [ ] **Step 1: Write lifecycle tests for the final state machine**

Add behavior tests:

```js
test('only the portfolio assignment can create its one chat', async () => {
  await assert.rejects(
    createManagedConversation({
      database,
      managerId: 8,
      portfolioId: 20,
      interestIds: [31],
    }),
    error => error.status === 403 && error.code === 'NOT_ASSIGNED_MANAGER'
  );
  assert.equal(database.conversationCount(20), 0);
});

test('manual removal preserves interest and messages', async () => {
  await removeManagedInvestor({
    database,
    managerId: 7,
    conversationId: 40,
    investorId: 11,
  });
  assert.equal(database.member(40, 11).membership_status, 'removed');
  assert.equal(database.hasInterest(20, 11), true);
  assert.deepEqual(database.messageIds(40), [101, 102, 103]);
  assert.deepEqual(database.notificationRecipientIds(), [9, 11]);
});

test('re-added investor starts after the latest message', async () => {
  await addManagedInvestors({
    database,
    managerId: 7,
    conversationId: 40,
    interestIds: [31],
  });
  assert.equal(database.member(40, 11).visible_after_message_id, 103);
});
```

Also cover one/multiple investors at creation, duplicate/concurrent creation, removal no-op, last-investor `no_active_investors` archive, add-driven reactivation, withdrawal with immediate `403`, old-manager `403`, active participant filtering, and full-history manager boundary `0`.

- [ ] **Step 2: Run the lifecycle suite against current manual controls**

Run:

```bash
node --test \
  backend/test/managed-conversation-workflow.test.js \
  backend/test/managed-conversation-lifecycle.test.js \
  backend/test/relationship-manager-route.test.js \
  backend/test/group-message-workflow.test.js
```

Expected: failures show missing assignment verification/removal, notification deletion on withdrawal, no add-driven reactivation, and obsolete manual archive/reopen behavior.

- [ ] **Step 3: Correct chat creation and add-investor invariants**

In `createManagedConversation()`, lock the portfolio first and require:

```js
if (Number(portfolio.relationship_manager_id) !== managerId) {
  throw workflowError(403, 'This portfolio is assigned to another manager', 'NOT_ASSIGNED_MANAGER');
}
if (portfolio.status !== 'approved') {
  throw workflowError(409, 'Portfolio must be approved before creating a chat', 'PORTFOLIO_NOT_APPROVED');
}
```

Reject an existing conversation before inserts. Lock all distinct `interest_ids`, require each to belong to the same portfolio, insert the assigned manager with `visible_after_message_id=0`, auto-add the owner, and add selected investors with the latest-message boundary used by the existing service.

In `addManagedInvestors()`, revalidate the canonical assignment and current interests. If the room is archived as `no_active_investors` and the portfolio is approved, set:

```sql
UPDATE conversations
SET status='active',archived_reason=NULL
WHERE id=? AND status='archived' AND archived_reason='no_active_investors';
```

Conversation creation notifies the owner and every selected investor. Addition
notifies each added investor and every other active participant except the
acting manager. Deduplicate recipients before inserting, and emit nothing for
an idempotent membership no-op.

- [ ] **Step 4: Implement idempotent manual investor removal**

Lock portfolio, conversation, acting manager, target membership, current interest, and remaining active investors in portfolio-first order. If already removed, return:

```js
{ changed: false, investor_id: investorId, archived: conversation.status === 'archived' }
```

Otherwise:

```sql
UPDATE conversation_members
SET membership_status='removed',left_at=CURRENT_TIMESTAMP
WHERE conversation_id=? AND user_id=? AND member_role='investor'
  AND membership_status='active';
```

Do not delete the interest, messages, or existing notifications. Notify the removed investor with `related_portfolio_id` and `related_conversation_id=NULL`; notify the active owner with the conversation link. If no active investor with a current interest remains, archive as `no_active_investors`.

- [ ] **Step 5: Correct withdrawal and automatic archive precedence**

`withdrawInvestorInterest()` must update membership, delete the one current interest row, count active investors joined to current interests, archive if that count reaches zero, and notify the assigned RM plus owner in the same transaction. Remove any statement that deletes prior notifications.

Use this precedence:

```js
const ARCHIVE_PRIORITY = {
  manual: 0,
  no_active_investors: 1,
  portfolio_unapproved: 2,
  portfolio_deleted: 3,
};

function shouldReplaceArchiveReason(current, next) {
  return !current || ARCHIVE_PRIORITY[next] > ARCHIVE_PRIORITY[current];
}
```

This ensures portfolio status dominates investor count and preserves the stronger deletion reason.

- [ ] **Step 6: Remove manual archive/reopen APIs**

Delete:

```text
PUT /api/relationship-manager/conversations/:id/archive
PUT /api/relationship-manager/conversations/:id/reopen
```

and remove `archiveManagedConversation`/`reopenManagedConversation` exports. Add:

```text
DELETE /api/relationship-manager/conversations/:conversationId/investors/:investorId
```

with positive safe integer validation and the same stable workflow error mapper.

- [ ] **Step 7: Implement approval reconciliation for Task 9**

`reconcileConversationAfterApproval(connection, portfolioId, actorId)` locks the conversation and counts active investors that still have a current interest. It returns `null` when no conversation exists. Otherwise:

```js
const next = activeEligibleInvestorCount > 0
  ? { status: 'active', archived_reason: null }
  : { status: 'archived', archived_reason: 'no_active_investors' };
```

Update only when state changes. Archival emits `conversation_archived` to active
members other than the actor; reactivation emits no invented notification type,
because the final enum has no conversation-reopened event.

- [ ] **Step 8: Run the full membership lifecycle suite**

Run:

```bash
node --test \
  backend/test/managed-conversation-workflow.test.js \
  backend/test/managed-conversation-lifecycle.test.js \
  backend/test/relationship-manager-route.test.js \
  backend/test/group-message-workflow.test.js
```

Expected: all creation/add/remove/withdraw/archive/reactivation/history/access tests pass and no manual lifecycle endpoint remains.

- [ ] **Step 9: Commit conversation lifecycle behavior**

Run:

```bash
git add \
  backend/src/services/managed-conversation-workflow.js \
  backend/src/routes/relationship-manager.js \
  backend/test/managed-conversation-workflow.test.js \
  backend/test/managed-conversation-lifecycle.test.js \
  backend/test/relationship-manager-route.test.js \
  backend/test/group-message-workflow.test.js
git commit -m "feat(messages): enforce assigned group-chat lifecycle"
```

Expected: one commit owns conversation and membership state transitions.

---

### Task 9: Integrate Interest, Moderation, Notifications, and Archive Restoration

**Files:**
- Modify: `backend/src/services/workflow.js`
- Modify: `backend/src/routes/interests.js`
- Modify: `backend/src/routes/notifications.js`
- Modify: `backend/src/routes/admin.js`
- Modify: `backend/test/workflow-transactions.test.js`
- Modify: `backend/test/managed-conversation-lifecycle.test.js`
- Modify: `backend/test/dashboard-schema-contract.test.js`

**Interfaces:**
- Consumes: `withdrawInvestorInterest()`, `archiveConversationForPortfolio()`, and `reconcileConversationAfterApproval()` from Task 8.
- Produces: transactional interest/moderation flows with exact recipients and history-safe notification visibility.

- [ ] **Step 1: Write cross-workflow recipient and restoration tests**

Add:

```js
test('new interest notifies owner and assigned manager', { concurrency: false }, async (t) => {
  const connection = workflowHarness({ assignedManagerId: 7 });
  useConnection(t, connection);
  await expressInterest({
    portfolioId: 20,
    investorId: 11,
    investorName: 'Investor',
  });
  assert.deepEqual(connection.notificationRecipientIds(), [7, 9]);
  assert.deepEqual(connection.notificationTypes(), ['new_interest', 'new_interest']);
});

test('approval restores only a room with an active current investor', { concurrency: false }, async (t) => {
  const connection = workflowHarness({
    conversationStatus: 'archived',
    archivedReason: 'portfolio_unapproved',
    activeEligibleInvestorIds: [11],
  });
  useConnection(t, connection);
  await moderatePortfolio({
    portfolioId: 20,
    adminId: 5,
    action: 'approve',
    reason: null,
  });
  assert.deepEqual(connection.conversationState(20), {
    status: 'active',
    archived_reason: null,
  });
});
```

Add owner-only notification for unassigned interest, withdrawal notifications to owner+assigned RM, rejection and editable approved changes retaining assignment, approval with zero eligible investors remaining archived, malformed route ID `400`, and rollback preserving audit/notification/primary writes.

- [ ] **Step 2: Run focused workflow tests**

Run:

```bash
node --test \
  backend/test/workflow-transactions.test.js \
  backend/test/managed-conversation-lifecycle.test.js \
  backend/test/dashboard-schema-contract.test.js
```

Expected: failures show owner-only interest notification, no approval reconciliation, and old notification-visibility assumptions.

- [ ] **Step 3: Include assignment in the interest transaction**

Lock and select:

```sql
SELECT p.id,p.name,p.owner_id,p.status,p.relationship_manager_id,
       owner.name AS owner_name
FROM portfolios p
JOIN users owner ON owner.id=p.owner_id
WHERE p.id=?
FOR UPDATE;
```

After inserting a new interest, build:

```js
const recipients = [portfolio.owner_id];
if (portfolio.relationship_manager_id) {
  recipients.push(portfolio.relationship_manager_id);
}
```

Deduplicate and insert both `new_interest` notifications in the same transaction. Repeated interest remains a no-op with no duplicate notification.

- [ ] **Step 4: Reconcile chat status inside admin moderation**

After the admin changes the portfolio to approved, call:

```js
await reconcileConversationAfterApproval(connection, portfolioId, adminId);
```

before audit/notification commit. Rejection calls `archiveConversationForPortfolio(connection, portfolioId, 'portfolio_unapproved', adminId)` without clearing assignment or membership. Approved portfolio edits, submission, document upload, and document deletion continue to archive with `portfolio_unapproved` and retain assignment.

- [ ] **Step 5: Tighten changed route boundaries**

Validate every changed `:id`/`:portfolioId` with:

```js
const id = Number(req.params.portfolioId ?? req.params.id);
if (!Number.isSafeInteger(id) || id <= 0) {
  return res.status(400).json({ error: 'A positive portfolio ID is required' });
}
```

Perform this check before SQL. Keep admin moderation behind `requireRole('admin')` and interest mutation behind `requireRole('investor')`.

- [ ] **Step 6: Preserve notification isolation without hiding revocation notices**

Retain the rule that ordinary notifications containing a `related_conversation_id` are visible only to active members. For recipients who just lost access—the old manager on reassignment and removed investor on removal—the writers from Tasks 4 and 8 must set `related_conversation_id=NULL` and retain `related_portfolio_id`. Add a notification-query regression test proving:

```js
assert.equal(removedInvestorNotifications[0].type, 'conversation_member_removed');
assert.equal(removedInvestorNotifications[0].related_conversation_id, null);
assert.equal(removedInvestorNotifications[0].related_portfolio_id, 20);
```

Do not broaden the query to reveal arbitrary chat-linked notifications to historical members.

- [ ] **Step 7: Run workflow and notification tests**

Run:

```bash
node --test \
  backend/test/workflow-transactions.test.js \
  backend/test/managed-conversation-lifecycle.test.js \
  backend/test/dashboard-schema-contract.test.js
```

Expected: exact recipient, no-op, archive/restoration, malformed-ID, notification-isolation, and rollback cases pass.

- [ ] **Step 8: Commit the cross-workflow integration**

Run:

```bash
git add \
  backend/src/services/workflow.js \
  backend/src/routes/interests.js \
  backend/src/routes/notifications.js \
  backend/src/routes/admin.js \
  backend/test/workflow-transactions.test.js \
  backend/test/managed-conversation-lifecycle.test.js \
  backend/test/dashboard-schema-contract.test.js
git commit -m "feat(workflow): connect moderation interest and chat state"
```

Expected: one commit connects existing domain services without mixing frontend work.

---

### Task 10: Establish Shared Five-Role Browser Routing and Final API Methods

**Files:**
- Modify: `js/api.js`
- Modify: `js/messages.js`
- Modify: `js/script.js`
- Modify: `index.html`
- Modify: `signin.html`
- Modify: `signup.html`
- Modify: `audit-logs.html`
- Modify: `browse.html`
- Modify: `businessownerdashboard.html`
- Modify: `createportfolio.html`
- Modify: `investordashboard.html`
- Modify: `messages.html`
- Modify: `moderatordashboard.html`
- Modify: `my-interests.html`
- Modify: `mybusinesses.html`
- Modify: `relationshipmanagerdashboard.html`
- Modify: `assignments.html`
- Modify: `superadmindashboard.html`
- Modify: `css/style.css`
- Modify: `backend/test/api-client.test.js`
- Modify: `backend/test/frontend-origin.test.js`
- Modify: `backend/test/frontend-flow-contract.test.js`

**Interfaces:**
- Consumes: final APIs from Tasks 6–9.
- Produces: `dashboardForRole()`, `requirePageRole()`, and these browser API methods:

```js
API.getSuperadminStats()
API.getPortfolioAssignments()
API.getAssignableRelationshipManagers()
API.getStaff()
API.createStaff(payload)
API.assignPortfolioManager(portfolioId, relationshipManagerId)
API.unassignPortfolioManager(portfolioId)
API.getSuperadminAuditLogs(page, limit)
API.getAssignedPortfolio(portfolioId)
API.removeManagedInvestor(conversationId, investorId)
```

- [ ] **Step 1: Write failing five-role client-contract tests**

Extend the dashboard map test:

```js
for (const [role, dashboard] of Object.entries({
  business_owner: 'businessownerdashboard.html',
  investor: 'investordashboard.html',
  relationship_manager: 'relationshipmanagerdashboard.html',
  admin: 'moderatordashboard.html',
  superadmin: 'superadmindashboard.html',
})) {
  test(`wrong-role ${role} redirects to ${dashboard}`, async () => {
    const client = clientHarness();
    client.run(`API.getCurrentUser = async () => ({ id: 2, role: '${role}' })`);
    assert.equal(await client.run("requirePageRole('different_role')"), null);
    assert.equal(client.context.window.location.href, dashboard);
  });
}
```

Assert the exact HTTP methods/paths for every API method above. Assert no browser source calls `/admin/relationship-managers`, `/assign`, `/archive`, or `/reopen`. Assert the homepage exposes five sign-in cards while signup still exposes only owner/investor.

- [ ] **Step 2: Run the shared frontend contract tests**

Run:

```bash
node --test \
  backend/test/api-client.test.js \
  backend/test/frontend-origin.test.js \
  backend/test/frontend-flow-contract.test.js
```

Expected: failures show incomplete five-role routing, obsolete admin/manual-lifecycle calls, unpinned incoming pages, and the incoming portfolio-editor role-menu regressions.

- [ ] **Step 3: Define the final role map and API methods**

Use:

```js
const ROLE_DASHBOARDS = Object.freeze({
  business_owner: 'businessownerdashboard.html',
  investor: 'investordashboard.html',
  relationship_manager: 'relationshipmanagerdashboard.html',
  admin: 'moderatordashboard.html',
  superadmin: 'superadmindashboard.html',
});
```

Add:

```js
getSuperadminStats: () => apiFetch('/superadmin/stats'),
getPortfolioAssignments: () => apiFetch('/superadmin/portfolio-assignments'),
getAssignableRelationshipManagers: () => apiFetch('/superadmin/relationship-managers'),
getStaff: () => apiFetch('/superadmin/staff'),
createStaff: (payload) =>
  apiFetch('/superadmin/staff', { method: 'POST', body: JSON.stringify(payload) }),
assignPortfolioManager: (portfolioId, relationshipManagerId) =>
  apiFetch(`/superadmin/portfolios/${portfolioId}/assignment`, {
    method: 'PUT',
    body: JSON.stringify({ relationship_manager_id: relationshipManagerId }),
  }),
unassignPortfolioManager: (portfolioId) =>
  apiFetch(`/superadmin/portfolios/${portfolioId}/assignment`, { method: 'DELETE' }),
getSuperadminAuditLogs: (page = 1, limit = 50) =>
  apiFetch(`/superadmin/audit-logs?page=${page}&limit=${limit}`),
getAssignedPortfolio: (portfolioId) =>
  apiFetch(`/relationship-manager/portfolios/${portfolioId}`),
removeManagedInvestor: (conversationId, investorId) =>
  apiFetch(
    `/relationship-manager/conversations/${conversationId}/investors/${investorId}`,
    { method: 'DELETE' },
  ),
```

Remove `getRelationshipManagers`, `createRelationshipManager`, `archiveManagedConversation`, and `reopenManagedConversation`.

- [ ] **Step 4: Make entry controls represent all five roles without enabling staff signup**

Add a Superadmin sign-in card to `index.html` that selects `superadmin` and links to `signin.html`. Keep `signup.html` and the registration branch in `js/script.js` limited to:

```js
const PUBLIC_REGISTRATION_ROLES = new Set(['business_owner', 'investor']);
```

The signin path accepts all five selected role labels but the server remains the source of truth after login; route using the returned `user.role`, never the selected card alone. Guard optional role-menu DOM lookup so pages without that menu do not throw:

```js
const roleMenu = document.getElementById('role-menu');
if (roleMenu) {
  initializeRoleMenu(roleMenu);
}
```

This fixes the nine incoming portfolio-editor failures.

- [ ] **Step 5: Add shared hidden and responsive role-grid rules**

In `css/style.css`, include:

```css
[hidden] {
  display: none !important;
}

.role-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
}

@media (max-width: 980px) {
  .role-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 520px) {
  .role-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
```

Retain the teammate's score-circle selectors and account-menu/modal selectors unchanged.

- [ ] **Step 6: Pin shared assets to one release key**

For every HTML file that references `css/style.css`, `js/api.js`, or a
page-specific local script, set all of those local asset queries to the same
key:

```html
<link rel="stylesheet" href="css/style.css?v=20260727.1">
<script src="js/api.js?v=20260727.1"></script>
<script src="js/messages.js?v=20260727.1"></script>
```

Pin incoming icon imports to `@tabler/icons-webfont@3.0.0`. Update `MESSAGES_API_SCRIPT_SRC` in `js/messages.js` to the same API URL. Do not leave mixed cache keys.

- [ ] **Step 7: Re-run shared browser contracts**

Run:

```bash
node --test \
  backend/test/api-client.test.js \
  backend/test/frontend-origin.test.js \
  backend/test/frontend-flow-contract.test.js
```

Expected: all five-role maps, same-origin paths, registration limits, pinned dependency, optional DOM, release-key, and preserved teammate-style tests pass.

- [ ] **Step 8: Commit the shared browser contract**

Run:

```bash
git add \
  js/api.js \
  js/messages.js \
  js/script.js \
  index.html \
  signin.html \
  signup.html \
  audit-logs.html \
  browse.html \
  businessownerdashboard.html \
  createportfolio.html \
  investordashboard.html \
  messages.html \
  moderatordashboard.html \
  my-interests.html \
  mybusinesses.html \
  relationshipmanagerdashboard.html \
  assignments.html \
  superadmindashboard.html \
  css/style.css \
  backend/test/api-client.test.js \
  backend/test/frontend-origin.test.js \
  backend/test/frontend-flow-contract.test.js
git commit -m "feat(frontend): route all five platform roles"
```

Expected: one coordinated release-key commit; inspect `git diff --cached --stat` before committing to ensure no unrelated file entered the wildcard.

---

### Task 11: Build the Protected Superadmin Dashboard and Assignment Workspace

**Files:**
- Modify: `superadmindashboard.html`
- Modify: `assignments.html`
- Modify: `js/superadmindashboard.js`
- Modify: `js/assignments.js`
- Modify: `css/style.css`
- Create: `backend/test/helpers/superadmin-dashboard-harness.js`
- Create: `backend/test/helpers/assignments-harness.js`
- Create: `backend/test/superadmin-client.test.js`
- Create: `backend/test/assignments-client.test.js`

**Interfaces:**
- Consumes: shared API methods and role guard from Task 10.
- Produces: protected superadmin staff/audit/workload UI and safe assign/reassign/unassign UI.

- [ ] **Step 1: Write VM client tests for authorization, single-flight, escaping, and recovery**

Use focused harnesses and add:

```js
test('dashboard verifies superadmin before any data request', async () => {
  const page = superadminHarness({ authenticatedRole: 'admin' });
  await page.initialize();
  assert.deepEqual(page.calls, ['getCurrentUser']);
  assert.equal(page.location.href, 'moderatordashboard.html');
});

test('assignment submit is single-flight and refreshes only after success', async () => {
  const page = assignmentsHarness();
  page.openAssignment({ portfolioId: 20, managerId: null });
  const first = page.submitManager(7);
  const second = page.submitManager(7);
  await Promise.all([first, second]);
  assert.deepEqual(page.mutations, [{ portfolioId: 20, managerId: 7 }]);
  assert.equal(page.assignmentLoads, 2);
});

test('409 keeps a recoverable stale-state message without replaying', async () => {
  const page = assignmentsHarness({ mutationStatus: 409 });
  await page.assign(20, 7);
  assert.match(page.alert.textContent, /changed|refresh/i);
  page.retryButton.click();
  assert.equal(page.mutationCount, 1);
  assert.equal(page.assignmentLoads, 2);
});
```

Cover staff validation/preservation after failure, role restricted to admin/RM, no superadmin option, independent stats/staff/audit retries, pagination, output escaping, same-manager prevention, unassign confirmation, disabled reasons, and wrong-role redirects.

- [ ] **Step 2: Run the new client tests against incoming pages**

Run:

```bash
node --test \
  backend/test/superadmin-client.test.js \
  backend/test/assignments-client.test.js
```

Expected: failures show no page guard, direct `/assign`, missing staff/audit/unassign UI, no single-flight behavior, and no recoverable section states.

- [ ] **Step 3: Build the protected superadmin dashboard structure**

Start `superadmindashboard.html` with a protected shell and these stable regions:

```html
<body class="protected-page">
  <main id="superadmin-main" hidden>
    <section id="superadmin-stats" aria-live="polite"></section>
    <section id="manager-workload" aria-live="polite"></section>
    <form id="staff-form" novalidate>
      <label for="staff-name">Name</label>
      <input id="staff-name" maxlength="100" required>
      <label for="staff-email">Email</label>
      <input id="staff-email" type="email" maxlength="255" required>
      <label for="staff-password">Temporary password</label>
      <input id="staff-password" type="password" minlength="6" maxlength="128" required>
      <label for="staff-role">Role</label>
      <select id="staff-role" required>
        <option value="admin">Admin</option>
        <option value="relationship_manager">Relationship manager</option>
      </select>
      <button id="staff-submit" type="submit">Create staff account</button>
    </form>
    <section id="staff-directory" aria-live="polite"></section>
    <section id="superadmin-audit" aria-live="polite"></section>
  </main>
</body>
```

Include account-menu signout, a link to `assignments.html`, accessible status/retry regions, pinned Tabler `3.0.0`, and release key `20260727.1`.

- [ ] **Step 4: Implement guarded, independently recoverable dashboard loading**

Initialize:

```js
async function initializeSuperadminDashboard() {
  const user = await requirePageRole('superadmin');
  if (!user) return;
  document.getElementById('superadmin-main').hidden = false;
  await Promise.allSettled([
    loadStatsAndWorkload(),
    loadStaffDirectory(),
    loadAuditPage(1),
  ]);
}
```

Each loader owns its own busy flag, error region, and data-only Retry. Render database strings through the existing `escapeHtml()`. Staff submit validates the Task 5 limits, disables only its submit button while active, preserves fields after failure, clears password after success, and then reloads only staff/stats/audit data.

- [ ] **Step 5: Build the accessible assignment workspace**

`assignments.html` contains:

```html
<main id="assignments-main" hidden>
  <div class="table-scroll" tabindex="0" aria-label="Portfolio assignments">
    <table>
      <thead>
        <tr>
          <th>Portfolio</th><th>Status</th><th>Owner</th>
          <th>Relationship manager</th><th>Chat</th><th>Actions</th>
        </tr>
      </thead>
      <tbody id="assignment-rows"></tbody>
    </table>
  </div>
  <div id="assignment-dialog" role="dialog" aria-modal="true" hidden></div>
  <div id="assignment-status" role="status" aria-live="polite"></div>
</main>
```

Unavailable actions remain visible as disabled buttons with a nearby reason. The dialog supports assign/reassign; unassign uses a separate explicit confirmation and is absent as an enabled action after chat creation.

- [ ] **Step 6: Implement delegated, stale-safe assignment behavior**

Guard with `requirePageRole('superadmin')`, normalize all dataset IDs as positive safe integers, and use a single event listener on `assignment-rows`. Track:

```js
const assignmentState = {
  items: [],
  managers: [],
  loading: false,
  mutatingPortfolioId: null,
};
```

Reject same-manager submission locally. Disable all actions for the mutating portfolio until the one mutation finishes. On success, close the modal and refetch data. On `409`, keep the modal/context, show the server message, and make Retry call `loadAssignments()` only—never replay the mutation.

- [ ] **Step 7: Add responsive, accessible styles**

Keep table overflow inside `.table-scroll`, dialogs within viewport, visible focus rings, disabled reason text, and:

```css
.table-scroll {
  max-width: 100%;
  overflow-x: auto;
}

.action-disabled-reason {
  max-width: 28ch;
  color: var(--muted-text);
  font-size: 0.8125rem;
}

@media (max-width: 390px) {
  .superadmin-grid,
  .staff-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
```

- [ ] **Step 8: Run superadmin client and shared layout tests**

Run:

```bash
node --test \
  backend/test/superadmin-client.test.js \
  backend/test/assignments-client.test.js \
  backend/test/frontend-flow-contract.test.js \
  backend/test/messages-layout.test.js
```

Expected: protected load, independent recovery, validation, mutation, escaping, pinned asset, and 390-pixel overflow contracts pass.

- [ ] **Step 9: Commit the superadmin workspace**

Run:

```bash
git add \
  superadmindashboard.html \
  assignments.html \
  js/superadmindashboard.js \
  js/assignments.js \
  css/style.css \
  backend/test/helpers/superadmin-dashboard-harness.js \
  backend/test/helpers/assignments-harness.js \
  backend/test/superadmin-client.test.js \
  backend/test/assignments-client.test.js
git commit -m "feat(superadmin): add protected assignment workspace"
```

Expected: incoming visual direction is retained but all unsafe behavior is replaced.

---

### Task 12: Make Admin Moderation-Only and Rebuild the Assigned RM Dashboard

**Files:**
- Modify: `moderatordashboard.html`
- Modify: `js/moderatordashboard.js`
- Modify: `relationshipmanagerdashboard.html`
- Modify: `js/relationshipmanagerdashboard.js`
- Modify: `css/style.css`
- Modify: `backend/test/helpers/admin-dashboard-harness.js`
- Modify: `backend/test/admin-dashboard-client.test.js`
- Modify: `backend/test/relationship-manager-client.test.js`

**Interfaces:**
- Consumes: moderation API, assigned RM read model, and membership API.
- Produces: strict admin UI and an assigned-portfolio RM workspace with read-only details/documents and multi-investor controls.

- [ ] **Step 1: Rewrite client expectations before markup/scripts**

Admin assertions:

```js
test('admin initialization loads moderation only', async () => {
  const page = adminHarness();
  await page.initialize();
  assert.deepEqual(page.apiCalls.sort(), ['getQueue', 'getStats']);
  assert.equal(page.source.includes('createRelationshipManager'), false);
});
```

RM assertions:

```js
test('renders assigned no-interest portfolio with disabled explanation', async () => {
  const page = relationshipManagerHarness(assignedNoInterestResponse);
  await page.initialize();
  assert.match(page.card(20).textContent, /after an investor expresses interest/i);
  assert.equal(page.card(20).createButton.disabled, true);
});

test('removal confirmation calls one DELETE and refreshes', async () => {
  const page = relationshipManagerHarness(activeRoomResponse);
  await page.removeInvestor({ conversationId: 40, investorId: 11 });
  assert.deepEqual(page.removals, [{ conversationId: 40, investorId: 11 }]);
  assert.equal(page.dashboardLoads, 2);
});
```

Cover multiple selected interests, assignment/status disabled reasons, detail/document load, escaped labels, mutation single-flight, stale `409`, removal cancel, and absence of manual archive/reopen.

- [ ] **Step 2: Run the current admin/RM client tests**

Run:

```bash
node --test \
  backend/test/admin-dashboard-client.test.js \
  backend/test/relationship-manager-client.test.js
```

Expected: failures expose admin staff provisioning, unclaimed-portfolio assumptions, no detail/removal UI, and manual archive/reopen controls.

- [ ] **Step 3: Remove staff creation from admin while preserving teammate UI**

Delete the relationship-manager form/directory panel from `moderatordashboard.html`. Remove manager state, validation, submit, directory load, and render functions from `js/moderatordashboard.js`. Initialization must call only moderation stats/queue loaders. Preserve the standardized dropdown sign-out, review modal, concurrency guards, scoped retries, and audit link from teammate commit `c6b71f2`.

- [ ] **Step 4: Render every assigned portfolio and server-provided action**

Replace the “unclaimed portfolios + rooms” split with one assigned portfolio collection. Each card shows owner, portfolio status, chat status/reason, interest candidates, active participants, and buttons driven only by:

```js
const {
  can_create_conversation,
  create_disabled_reason,
  can_add_investors,
  add_disabled_reason,
} = portfolio.actions;
```

The create/add control is a checkbox multi-select over `interest_id` values and submits one or more IDs. Do not enable an action by recomputing looser browser rules.

- [ ] **Step 5: Add read-only details/documents and investor removal**

The detail modal calls `API.getAssignedPortfolio(portfolioId)` and renders every portfolio field as text, never an editable input. Documents call:

```js
API.downloadDocument(document.download_url, document.file_name)
```

Active investor rows include a Remove action. Confirm with the investor and portfolio names, call `API.removeManagedInvestor()`, disable that action during mutation, and refresh on success. A `409` refreshes data without replay. Remove all Archive/Reopen markup and JavaScript.

- [ ] **Step 6: Run client and layout tests**

Run:

```bash
node --test \
  backend/test/admin-dashboard-client.test.js \
  backend/test/relationship-manager-client.test.js \
  backend/test/frontend-flow-contract.test.js \
  backend/test/messages-layout.test.js
```

Expected: admin has moderation only; RM assigned/no-interest/non-approved/read-only/multi-investor/removal flows pass; teammate account UI and responsive contracts remain green.

- [ ] **Step 7: Commit staff-surface separation and RM workspace**

Run:

```bash
git add \
  moderatordashboard.html \
  js/moderatordashboard.js \
  relationshipmanagerdashboard.html \
  js/relationshipmanagerdashboard.js \
  css/style.css \
  backend/test/helpers/admin-dashboard-harness.js \
  backend/test/admin-dashboard-client.test.js \
  backend/test/relationship-manager-client.test.js
git commit -m "feat(workflow): separate admin and manager workspaces"
```

Expected: one UI commit completes strict staff separation and assigned-manager controls.

---

### Task 13: Keep Messaging Stable and Align Owner/Investor Workflow Copy

**Files:**
- Modify: `messages.html`
- Modify: `js/messages.js`
- Modify: `businessownerdashboard.html`
- Modify: `investordashboard.html`
- Modify: `js/investordashboard.js`
- Modify: `mybusinesses.html`
- Modify: `js/mybusinesses.js`
- Modify: `my-interests.html`
- Modify: `js/my-interests.js`
- Modify: `browse.html`
- Modify: `js/browse.js`
- Modify: `css/style.css`
- Modify: `backend/test/managed-messages-client.test.js`
- Modify: `backend/test/messages-client.test.js`
- Modify: `backend/test/messages-layout.test.js`
- Modify: `backend/test/investor-pages-client.test.js`
- Modify: `backend/test/mybusinesses-client.test.js`
- Modify: `backend/test/browse-client.test.js`

**Interfaces:**
- Consumes: existing `/api/messages`, final dashboard fields, and active-membership authorization.
- Produces: unchanged left/right group messaging and coherent owner/investor states.

- [ ] **Step 1: Add regression tests for the user's messaging rules**

Preserve these exact contracts:

```js
test('own messages stay right and every other sender stays left with identity', () => {
  const page = messagesHarness(threadFixture, { currentUserId: 7 });
  assert.equal(page.message(101).classList.contains('message-own'), true);
  assert.equal(page.message(102).classList.contains('message-other'), true);
  assert.match(page.message(102).textContent, /Investor Name/);
  assert.match(page.message(102).textContent, /Investor/);
});

test('sending twice keeps the composer and refresh persistence', async () => {
  const page = messagesHarness(threadFixture, { currentUserId: 7 });
  await page.send('First');
  await page.send('Second');
  assert.equal(page.composer.isConnected, true);
  assert.equal(page.sendCalls.length, 2);
  await page.reloadThread();
  assert.match(page.thread.textContent, /First/);
  assert.match(page.thread.textContent, /Second/);
});
```

Add archived readable/send `409`, active-only participant names, removed-member `403` inbox reconciliation, old-manager `403`, superadmin/admin redirect, hidden navigation before auth, 390-pixel no-overflow, notification escaping, and exact owner/investor state-label tests.

- [ ] **Step 2: Run messaging and owner/investor client tests**

Run:

```bash
node --test \
  backend/test/managed-messages-client.test.js \
  backend/test/messages-client.test.js \
  backend/test/messages-layout.test.js \
  backend/test/investor-pages-client.test.js \
  backend/test/mybusinesses-client.test.js \
  backend/test/browse-client.test.js
```

Expected: the established send/alignment tests stay green while new five-role/revocation/label/notification cases fail.

- [ ] **Step 3: Harden role navigation and revoked-access recovery**

Hide every role-specific navigation block in initial markup. After `requirePageRole`/current-user resolution, reveal only the matching member-role navigation. Admin and superadmin redirect through:

```js
window.location.href = dashboardForRole(currentUser.role);
```

When thread/list calls return membership `403`, clear the selected conversation, refetch the accessible inbox once, and render a stable “You no longer have access to that conversation” notice. Do not clear the login session.

- [ ] **Step 4: Preserve bubble identity and permanent composer behavior**

Keep own/right and other/left class derivation based only on authenticated numeric user ID:

```js
const isOwn = Number(message.sender.id) === Number(currentUser.id);
const bubbleClass = isOwn ? 'message-own' : 'message-other';
```

Render escaped sender name and formatted role on other bubbles, current active participant names in the header, and no removed member in the rail. Sending clears only the textarea after a confirmed success; it must never replace the composer container. Archived rooms leave history visible and disable textarea/send with the archive reason.

- [ ] **Step 5: Correct workflow copy using assignment before interest**

In `js/mybusinesses.js`, use:

```js
function managedChatGuidance(portfolio) {
  if (!portfolio.relationship_manager_id) return 'Awaiting relationship manager assignment';
  if (Number(portfolio.interest_count) === 0) return 'Waiting for investor interest';
  if (!portfolio.conversation_id) return 'Awaiting relationship manager to create the group chat';
  return portfolio.chat_state === 'active' ? 'Open group chat' : 'View archived group chat';
}
```

Apply equivalent distinctions in `js/browse.js` and `js/my-interests.js`: unassigned means awaiting assignment; assigned without a chat means awaiting the manager; an accessible room links to messages; removed/withdrawn access never renders a chat link.

- [ ] **Step 6: Render investor notifications safely**

Use the notifications already returned by the investor dashboard:

```js
function notificationMarkup(notification) {
  const title = escapeHtml(notification.title);
  const body = escapeHtml(notification.body || '');
  const link = notification.related_conversation_id
    ? `<a href="messages.html?conversation=${Number(notification.related_conversation_id)}">Open chat</a>`
    : '';
  return `<article class="notification-card"><h3>${title}</h3><p>${body}</p>${link}</article>`;
}
```

Do not link a removal notice or any notification lacking current conversation access. Preserve the teammate's investor score circle.

- [ ] **Step 7: Run messaging and workflow-copy tests**

Run:

```bash
node --test \
  backend/test/managed-messages-client.test.js \
  backend/test/messages-client.test.js \
  backend/test/messages-layout.test.js \
  backend/test/investor-pages-client.test.js \
  backend/test/mybusinesses-client.test.js \
  backend/test/browse-client.test.js
```

Expected: own/right, others/left with identities, two-send composer persistence, refresh persistence, archived/revoked access, active participants, notifications, correct labels, and mobile layout all pass.

- [ ] **Step 8: Commit coherent participant-facing UI**

Run:

```bash
git add \
  messages.html \
  js/messages.js \
  businessownerdashboard.html \
  investordashboard.html \
  js/investordashboard.js \
  mybusinesses.html \
  js/mybusinesses.js \
  my-interests.html \
  js/my-interests.js \
  browse.html \
  js/browse.js \
  css/style.css \
  backend/test/managed-messages-client.test.js \
  backend/test/messages-client.test.js \
  backend/test/messages-layout.test.js \
  backend/test/investor-pages-client.test.js \
  backend/test/mybusinesses-client.test.js \
  backend/test/browse-client.test.js
git commit -m "feat(frontend): align five-role participant journeys"
```

Expected: one commit preserves messaging semantics and aligns workflow guidance.

---

### Task 14: Close Seed, Live Smoke, Runtime Manifest, and Dependency Packaging

**Files:**
- Modify: `backend/scripts/seed-managed-chat.js`
- Modify: `backend/test/managed-chat-seed.test.js`
- Rename: `backend/scripts/live-four-role-smoke.js` to `backend/scripts/live-five-role-smoke.js`
- Modify: `backend/test/live-smoke-contract.test.js`
- Modify: `backend/deploy/runtime-manifest.txt`
- Modify: `backend/test/messages-deployment-files.test.js`
- Modify: `backend/package.json`
- Modify: `backend/package-lock.json` only if `npm install --package-lock-only` changes script metadata

**Interfaces:**
- Consumes: all final backend APIs and frontend assets.
- Produces: `npm run smoke:live`, an exact release allowlist, and a seed that cannot bypass superadmin assignment audit.

- [ ] **Step 1: Write failing seed, smoke-contract, and manifest-closure tests**

Add:

```js
test('managed seed refuses an unaudited or mismatched assignment', async () => {
  await assert.rejects(
    seedManagedChat(seedDatabase({ portfolioManagerId: null, selectedManagerId: 7 })),
    /must already be assigned/i
  );
  assert.equal(seedDatabase.writeCount, 0);
});

test('runtime manifest contains every reachable backend require', () => {
  const manifest = new Set(readManifest());
  for (const dependency of staticRequiresReachableFrom('backend/server.js')) {
    assert.ok(manifest.has(dependency), `missing runtime dependency: ${dependency}`);
  }
});
```

The smoke source contract must assert all five role names, final superadmin routes, multi-investor create, removal/re-add/withdrawal, reassignment, archive/restoration, strict denials, `superadmin_audit_logs` cleanup, UUID-scoped cleanup, and absence of embedded emails/passwords/tokens.

- [ ] **Step 2: Run the focused release-contract tests**

Run:

```bash
node --test \
  backend/test/managed-chat-seed.test.js \
  backend/test/live-smoke-contract.test.js \
  backend/test/messages-deployment-files.test.js
```

Expected: failures show the seed can bypass assignment, smoke is four-role, and incoming superadmin/new service files are missing from the manifest.

- [ ] **Step 3: Require an existing audited assignment in the seed**

Before any seed chat write, load:

```sql
SELECT p.id,p.status,p.relationship_manager_id,
       u.role AS manager_role
FROM portfolios p
LEFT JOIN users u ON u.id=p.relationship_manager_id
WHERE p.id=?
FOR UPDATE;
```

Require `status='approved'`, `relationship_manager_id === selectedManager.id`, and `manager_role='relationship_manager'`. If not, throw before writes. The seed must never silently set `relationship_manager_id`, because that would bypass superadmin audit and notifications.

- [ ] **Step 4: Replace the smoke with a self-cleaning five-role journey**

Rename the script and use a UUID prefix:

```js
const runId = `smoke-${crypto.randomUUID()}`;
const created = {
  userIds: [],
  portfolioIds: [],
  interestIds: [],
  conversationIds: [],
  messageIds: [],
  notificationIds: [],
  moderationAuditIds: [],
  superadminAuditIds: [],
};
```

Directly seed only one temporary `superadmin` fixture because production exposes no superadmin-creation API. Through supported HTTP flows:

1. Create one admin and two RMs through `POST /api/superadmin/staff`.
2. Register one owner and two investors through public registration.
3. Submit and admin-approve one complete portfolio.
4. Assign, pre-chat unassign, and assign again.
5. Verify RM detail/document access and disabled chat creation before interest.
6. Express both interests and verify owner+RM notifications.
7. Create one multi-investor chat; send and reload messages.
8. Remove/re-add one investor and verify the join boundary.
9. Withdraw the other investor and verify immediate `403`.
10. Reassign the chat, verify old-manager `403`, new-manager full history, and unchanged message IDs.
11. Reject/reapprove and verify archive/restoration.
12. Verify admin/superadmin cross-role `403`, both audit tables, and exact notification recipients.

Store credentials only in process memory. Accept only loopback origins whose URL
matches `/^http:\/\/127\.0\.0\.1:\d+$/` or exact public origin
`http://35.212.144.149`.

- [ ] **Step 5: Implement ID-scoped cleanup and reconciliation**

In `finally`, delete only rows connected to the recorded IDs/run prefix in FK-safe order. Remove temporary `superadmin_audit_logs` and `audit_logs` before temporary users; remove notifications, messages, memberships, conversations, interests, documents, portfolios, then users. Never issue an unqualified delete.

After cleanup, run count queries by recorded IDs and `email LIKE ?` with `${runId}%`; require every count to be zero. Compare non-temporary message/member/portfolio counts captured before and after the smoke and fail if any differ.

- [ ] **Step 6: Publish the final package commands**

Set:

```json
{
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js",
    "test": "node --test test/*.test.js",
    "migrate:five-role-workflow": "node migrate.js",
    "seed:managed-chat": "node scripts/seed-managed-chat.js",
    "smoke:live": "node scripts/live-five-role-smoke.js"
  }
}
```

Ensure the removed `migrate:managed-chat` and `live-four-role-smoke.js` names do not appear in package metadata.

- [ ] **Step 7: Make the runtime manifest exact**

Retain every existing needed runtime entry and add at least:

```text
assignments.html
superadmindashboard.html
js/assignments.js
js/superadmindashboard.js
backend/migrate.js
backend/scripts/migrate-five-role-workflow.js
backend/scripts/live-five-role-smoke.js
backend/src/routes/superadmin.js
backend/src/services/superadmin-assignment-workflow.js
backend/src/services/staff-provisioning-workflow.js
backend/src/services/superadmin-read-model.js
backend/src/services/relationship-manager-read-model.js
```

Remove `backend/scripts/live-four-role-smoke.js`. Include every additional static `require()` reachable from `backend/server.js`. Do not include `.env`, uploads, tests, docs, local dependencies, editor settings, or the deleted reset migration.

- [ ] **Step 8: Run focused packaging tests**

Run:

```bash
node --test \
  backend/test/managed-chat-seed.test.js \
  backend/test/live-smoke-contract.test.js \
  backend/test/messages-deployment-files.test.js
```

Expected: assignment-safe seed, five-role smoke source, local-file existence, dependency closure, forbidden-file, and exact manifest tests all pass.

- [ ] **Step 9: Commit release closure**

Run:

```bash
git add \
  backend/scripts/seed-managed-chat.js \
  backend/scripts/live-four-role-smoke.js \
  backend/scripts/live-five-role-smoke.js \
  backend/test/managed-chat-seed.test.js \
  backend/test/live-smoke-contract.test.js \
  backend/deploy/runtime-manifest.txt \
  backend/test/messages-deployment-files.test.js \
  backend/package.json \
  backend/package-lock.json
git commit -m "test(release): add five-role smoke and runtime closure"
```

Expected: Git records the smoke rename and exact allowlist; no credentials or generated data are committed.

---

### Task 15: Run the Complete Local Gate and Review Against the Approved Design

**Files:**
- Verify: all changed source, tests, HTML, CSS, scripts, specification, and this plan
- Modify only if a failing gate identifies an in-scope defect

**Interfaces:**
- Consumes: Tasks 1–14.
- Produces: a clean, reviewable `main` commit ready for reversible production release.

- [ ] **Step 1: Run the full automated suite from the supported package entry**

Run:

```bash
npm --prefix backend test
```

Expected: every test passes with zero skipped, cancelled, or failed tests. Record the final pass count; do not rely on the earlier 336-test baseline because this plan adds coverage.

- [ ] **Step 2: Parse-check every released JavaScript file**

Run:

```bash
for release_script in js/*.js backend/server.js backend/migrate.js backend/scripts/*.js backend/src/routes/*.js backend/src/services/*.js; do
  node --check "$release_script"
done
```

Expected: every file exits `0` with no syntax output.

- [ ] **Step 3: Run static safety scans**

Run:

```bash
git diff origin/main...HEAD --check
! git diff origin/main...HEAD | rg -n \
  'DROP TABLE (messages|conversation_members|conversations)|TRUNCATE|superadmin.+SET.+admin'
! git diff origin/main...HEAD | rg -ni \
  'victor@lumilabs\.com|biztest@lumilabs\.com|invtest@lumilabs\.com|rsmanager@lumilabs\.com'
! rg -n 'localhost|127\.0\.0\.1|:3000|:3001' --glob '*.html' --glob 'js/*.js'
```

Expected: no whitespace error, destructive SQL, embedded password, superadmin conversion, or browser-facing localhost/old-port reference. Loopback remains allowed only in backend server/deploy/smoke code.

- [ ] **Step 4: Inspect commit scope and teammate preservation**

Run:

```bash
git status --short --branch
git diff --stat origin/main...HEAD
git merge-base --is-ancestor c6b71f2 HEAD
git merge-base --is-ancestor 012b3f4 HEAD
rg -n 'score-circle|account-menu|signOut' css/style.css investordashboard.html moderatordashboard.html
```

Expected: clean worktree; only approved workflow/docs/tests/runtime files changed; both teammate commits remain ancestors; score circle and account menu/signout remain present.

- [ ] **Step 5: Perform a spec-compliance code review**

Use `superpowers:requesting-code-review` with the approved specification and review the diff for:

```text
five exact roles
strict admin/superadmin separation
approved-only assign/reassign
pre-chat-only unassign
post-chat manager invariant
assigned-only RM reads/documents
multiple interested investors
manual remove versus withdrawal
join-boundary versus full-manager history
automatic archive/restoration
exact notifications and immutable audits
no destructive migration
runtime dependency closure
```

Expected: no critical or important finding. Fix each valid in-scope finding with
a failing regression test, rerun its focused suite, and use a precise commit
message such as `fix(workflow): preserve reassigned manager history`.

- [ ] **Step 6: Re-run the final gate after review fixes**

Run:

```bash
npm --prefix backend test
git diff --check
git status --short --branch
```

Expected: all tests pass and the worktree is clean.

- [ ] **Step 7: Ensure the remote did not advance before release**

Run:

```bash
git fetch origin main
git rev-list --left-right --count origin/main...HEAD
```

Expected: `0 N`, where `N` is the number of local specification/feature commits. If the left count is not zero, stop, rebase onto the new remote tip, rerun Steps 1–6, and do not deploy the stale commit.

---

### Task 16: Back Up, Verify, Deploy Backend-First, Walk All Five Roles, and Push Git

**Files:**
- Deploy only: committed paths in `backend/deploy/runtime-manifest.txt`
- Preserve remotely: `/var/www/lumilabs-backend/.env`, `/var/www/lumilabs-backend/uploads`, dependencies, Apache configuration, and systemd unit
- Back up remotely: exact preimages and database dump under the
  `/home/user/lumilabs-five-role-${release_short}` directory defined in Step 1

**Interfaces:**
- Consumes: clean verified local `main`, current SFTP/SSH access, live MySQL, and existing role-test credentials supplied out of source.
- Produces: matching Git `main`, deployed frontend/backend, healthy live database/API, preserved existing data, and signed-in evidence for all five roles.

- [ ] **Step 1: Open one hidden-prompt SSH control connection and name exact release paths**

Run:

```bash
release_ssh_dir=$(mktemp -d)
release_socket="$release_ssh_dir/control"
release_host='user@35.212.144.149'
release_frontend_root='/var/www/html'
release_backend_root='/var/www/lumilabs-backend'
release_commit=$(git rev-parse HEAD)
release_short=$(git rev-parse --short=12 HEAD)
release_backup="/home/user/lumilabs-five-role-$release_short"
ssh -M -S "$release_socket" -o ControlPersist=600 -fnNT "$release_host"
```

Expected: one password prompt with hidden input, then a reusable control connection. Never include the password in any argument or environment assignment.

- [ ] **Step 2: Capture exact remote preimages and inventory**

Over the control connection, create `$release_backup` mode `0700`. For every manifest path, map:

```text
backend/${relative_path} -> /var/www/lumilabs-backend/${relative_path}
${frontend_path} -> /var/www/html/${frontend_path}
```

Record target path, existence, mode, owner/group, size, and raw SHA-256 in `preimages.tsv`. Copy every existing target into `$release_backup/preimages/` mode `0600`; record absent targets in `absent-paths.txt`. Preserve raw CRLF files exactly even when normalized content matches Git. Expected: every existing manifest target has one verified backup or one explicit absent record, never both.

Also inventory and back up these two exact retired backend paths:

```text
/var/www/lumilabs-backend/scripts/migrate-managed-chat.js
/var/www/lumilabs-backend/scripts/live-four-role-smoke.js
```

No other non-manifest path is in cleanup scope.

- [ ] **Step 3: Create and verify a full live database backup**

On the server, load connection names from the private backend `.env` without printing them, then run `mysqldump` with a hidden `-p` prompt:

```bash
cd /var/www/lumilabs-backend
set -a
. ./.env
set +a
unset DB_PASSWORD
mysqldump \
  --host="$DB_HOST" \
  --port="${DB_PORT:-3306}" \
  --user="$DB_USER" \
  -p \
  --single-transaction \
  --quick \
  --hex-blob \
  --routines \
  --triggers \
  --events \
  lumi5_labs > "$release_backup/lumi5_labs.sql"
chmod 0600 "$release_backup/lumi5_labs.sql"
sha256sum "$release_backup/lumi5_labs.sql" > "$release_backup/lumi5_labs.sql.sha256"
```

Expected: hidden SQL-password prompt; non-empty dump; `CREATE TABLE` definitions for all ten application tables; verified checksum; a separate recorded count for users, portfolios, interests, documents, conversations, members, messages, notifications, moderation audits, and superadmin audits.

- [ ] **Step 4: Build an archive from the exact committed manifest and upload through SFTP**

Run locally:

```bash
release_stage=$(mktemp -d)
release_archive="$release_stage/lumilabs-five-role-$release_short.tar.gz"
git archive "$release_commit" $(sed '/^[[:space:]]*$/d' backend/deploy/runtime-manifest.txt) \
  | tar -x -C "$release_stage"
tar -czf "$release_archive" -C "$release_stage" \
  $(sed '/^[[:space:]]*$/d' backend/deploy/runtime-manifest.txt)
git show \
  --output="$release_stage/runtime-manifest.txt" \
  "$release_commit:backend/deploy/runtime-manifest.txt"
```

Upload using the already authenticated control socket:

```bash
printf 'put %s %s\n' \
  "$release_archive" \
  "/home/user/lumilabs-five-role-$release_short.tar.gz" \
  | sftp -o "ControlPath=$release_socket" "$release_host"
```

Expected: exactly one archive upload succeeds; the archive contains exactly the manifest paths from the verified commit and no `.env`, uploads, tests, docs, or dependencies.

- [ ] **Step 5: Stage and hash-verify every backend file**

Extract the archive into `$release_backup/staged`. For each `backend/` manifest path, install a same-directory temporary file:

```text
/var/www/lumilabs-backend/${relative_path}.release-${release_short}.tmp
```

Set source/script files to `0644`, preserve directories at `0755`, and compare each staged SHA-256 to:

```bash
git show "$release_commit:$release_path" | shasum -a 256
```

Expected: every backend hash matches before any live rename. Stop on the first mismatch.

- [ ] **Step 6: Atomically install backend files and run the migration verifier**

Rename each verified backend temporary file over its target; do not touch `.env`,
`uploads`, or `node_modules`. Move the two exact retired scripts from Step 2
into `$release_backup/retired/` when they exist, then prove both old live paths
are absent and `package.json` exposes neither old command. Then run:

```bash
cd /var/www/lumilabs-backend
WORKFLOW_BACKUP_VERIFIED=BACKUP_AND_RESTORE_COMMAND_VERIFIED \
CONFIRM_FIVE_ROLE_WORKFLOW_MIGRATION=APPLY_LUMILABS_FIVE_ROLE_WORKFLOW_20260727 \
/opt/lumilabs-messaging/current/bin/node migrate.js
```

Expected on the already migrated live database:

```json
{"changed":[],"backfilled_assignments":0}
```

The before/after protected counts must match. Any reported mutation, conflict, role mismatch, singleton mismatch, or count change is unexpected: stop before restart/frontend cutover and restore exact backend preimages.

- [ ] **Step 7: Restart only the backend and require healthy loopback**

Run remotely:

```bash
sudo systemctl restart lumilabs-backend.service
sudo systemctl is-active lumilabs-backend.service
curl -fsS http://127.0.0.1:3100/api/health
curl -fsS http://127.0.0.1:3100/api/ready
sudo journalctl -u lumilabs-backend.service -n 100 --no-pager
```

Expected: `active`, `{"status":"ok"}`, `{"status":"ready"}`, and no new error/stack trace. Do not reload Apache or daemon-reload systemd.

- [ ] **Step 8: Run the self-cleaning five-role smoke before exposing frontend**

Run remotely:

```bash
cd /var/www/lumilabs-backend
LUMILABS_E2E_ORIGIN=http://127.0.0.1:3100 \
  /opt/lumilabs-messaging/current/bin/npm run smoke:live
```

Expected: all 12 workflow stages pass, unchanged pre-existing data counts/identities reconcile, and zero UUID-scoped rows remain. Stop and restore backend preimages on any failure.

- [ ] **Step 9: Stage frontend assets, then HTML, with exact hashes**

For each non-`backend/` manifest path, stage:

```text
/var/www/html/${relative_path}.release-${release_short}.tmp
```

Verify raw SHA-256 against the committed blob. Atomically rename CSS and JavaScript first; verify they return `200` with the new content/hash; then rename HTML. This guarantees pages never reference a missing `20260727.1` asset. Do not delete or clean any non-manifest webroot file in this feature release.

- [ ] **Step 10: Run public health, authorization, asset, and hash gates**

Run:

```bash
curl -fsS http://35.212.144.149/api/health
curl -fsS http://35.212.144.149/api/ready
curl -sS -o /dev/null -w '%{http_code}\n' \
  http://35.212.144.149/api/superadmin/stats
```

Expected: health/ready both `200` with `ok`/`ready`; unauthenticated superadmin API `401`. Require every frontend manifest path to return `200`, every deployed raw hash to match the release commit, wrong-role API checks to return `403`, and service logs to remain clean.

- [ ] **Step 11: Perform signed-in desktop and 390-pixel walkthroughs**

Use `browser:control-in-app-browser` and the supplied credentials without storing them in files. Require a valid test credential for each of the five roles before starting; if the superadmin credential is not available, stop and ask for it rather than changing an existing user's role.

Verify in order:

1. Owner submits a portfolio.
2. Admin approves it and cannot see assignment/staff controls.
3. Superadmin assigns it and can create only admin/RM accounts.
4. Assigned RM reads details/document but cannot edit; Create chat is disabled before interest.
5. Investors express interest; owner and RM notifications appear.
6. RM creates the one multi-investor chat.
7. Own messages render right; all others left with names/roles; two sends persist after refresh.
8. Manual removal and withdrawal revoke access while preserving old messages.
9. Reassignment removes old-RM access and gives new RM full history.
10. Rejection makes chat read-only; reapproval restores it when eligible.
11. Every wrong-role page redirects and protected API denies.
12. Desktop and 390-pixel pages have no horizontal overflow, console error, or missing asset.

Expected: all steps pass. Clean up only the test records created during this walkthrough, leaving pre-existing production data untouched.

- [ ] **Step 12: Re-run local gates and check for a remote Git race**

Run locally:

```bash
npm --prefix backend test
git fetch origin main
git rev-list --left-right --count origin/main...HEAD
git status --short --branch
```

Expected: all tests pass, left count `0`, and clean worktree. If `origin/main` advanced after deployment, do not force-push or leave Git/live divergent: restore frontend HTML then assets and backend preimages, restart/recheck the service, rebase the new remote work, retest, and redeploy.

- [ ] **Step 13: Push verified `main` without force and prove Git/live agreement**

Run:

```bash
git push origin main
git rev-parse HEAD
git ls-remote origin refs/heads/main
git status --short --branch
```

Expected: fast-forward push; local and remote hashes are identical; branch is clean and not ahead/behind. Record that same hash in the remote release backup metadata and verify deployed file hashes against it.

- [ ] **Step 14: Retain recovery evidence and close the control connection**

Keep the database dump, checksum, preimages, absent-path inventory, row counts,
release manifest, and deployment hashes under the mode-`0700` backup directory
until teammate acceptance. Remove only temporary files whose suffix is
`.release-${release_short}.tmp` and the uploaded archive after success. Close:

```bash
ssh -S "$release_socket" -O exit "$release_host"
rmdir "$release_ssh_dir"
```

Expected: control socket closes; no staging file remains; production backup remains recoverable.

### Rollback Sequence

If a backend check fails before frontend cutover:

1. restore only backend targets from `preimages/`;
2. delete a newly introduced backend target only when `absent-paths.txt` says it was absent;
3. restore the two retired script preimages if they existed before release;
4. restart only `lumilabs-backend.service`;
5. verify service status, health, and logs; and
6. retain the failed release plus database backup for diagnosis.

If a frontend check fails:

1. restore HTML preimages first;
2. restore CSS/JavaScript and other assets;
3. verify public hashes and status codes; and
4. then follow the backend rollback if the backend also changed.

The known pre-release backend currently has `/api/health=200` and `/api/ready=503`; restoring it returns to that known readiness state. That is why the release must not expose the new frontend until the new backend returns ready and the five-role smoke passes.

---

## Final Acceptance Checklist

- [ ] Source schema, contract, fixture, and live database agree on all ten tables and five roles.
- [ ] No destructive reset or role-conversion path remains reachable.
- [ ] Admin and superadmin capabilities are separate at UI and API layers.
- [ ] Assignment/reassignment/unassignment and staff creation are transactional and audited.
- [ ] RM views only assigned portfolios and reads their documents without editing.
- [ ] One portfolio has one chat with owner, assigned manager, and one or more interested investors.
- [ ] Removal, withdrawal, re-add, archive/restoration, and reassignment preserve messages and enforce access immediately.
- [ ] Own messages are right; others are left with name/role; composer persists through repeated sends and refresh.
- [ ] Automated, live API, signed-in desktop, and 390-pixel checks all pass.
- [ ] `/api/health` and `/api/ready` both return `200`.
- [ ] Existing production messages and all other protected records remain present.
- [ ] Local `main`, `origin/main`, deployed runtime hashes, and release metadata identify the same commit.
