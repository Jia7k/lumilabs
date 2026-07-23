# Code-to-Database Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the repository describe and enforce the current production MySQL contract, and make every affected browser workflow render and submit values consistently with that contract, without changing production MySQL.

**Architecture:** Keep `backend/schema.sql` as the Git-only canonical DDL, expand the existing readiness verifier around an independent production metadata fixture, and place reusable request limits in one pure CommonJS boundary module. Apply those boundaries at Express/Multer entry points, mirror them in the portfolio editor, normalize nullable readiness values at backend and browser consumption points, and separate Browse workspace state from optional recommendation state.

**Tech Stack:** Node.js 22 test runner, Express 4, express-validator 7, Multer 2, mysql2, JWT, plain HTML/CSS/JavaScript, VM-based browser unit harnesses, MySQL 8 metadata.

## Global Constraints

- Production MySQL is read-only for this project. Do not run `schema.sql`, migrations, seeds, `INSERT`, `UPDATE`, `DELETE`, `ALTER`, `DROP`, or mutating smoke tests against it.
- Do not push Git or deploy through SFTP during implementation. Those remain separately authorized release actions.
- Do not implement notification UI, unread handling, audit pagination, activation state, new columns, or unrelated refactors.
- Preserve the accepted `audit_logs.portfolio_id ... ON DELETE CASCADE` behavior and test it explicitly.
- Keep authentication, role authorization, readiness calculation, recommendation weights, managed-chat membership, and message persistence behavior unchanged.
- Use red-green-refactor for every behavior change: add a focused failing test, run it and observe the intended failure, implement only enough production code, rerun the focus set, then commit.
- Execute every multi-line verification block with fail-fast shell semantics
  (`set -e` or individually checked commands); never let a later success mask
  an earlier failure.
- Tests that stub route-level singleton modules must use `{ concurrency: false }`.
- Never put credentials, JWTs, `.env` contents, or production application-data
  rows into tests, fixtures, commits, terminal output, or documentation. The
  audited `information_schema` metadata fixture is intentionally allowed.
- `backend/schema.sql` is Git-only and must not be added to `backend/deploy/runtime-manifest.txt`.
- Any new production JavaScript dependency must be added to both the runtime manifest and its exact allowlist test in the same commit.
- Preserve unrelated working-tree changes. Stage only the files named by the current task.

---

## Task 1: Make the canonical DDL reproduce audited production metadata

**Files:**

- Modify: `backend/schema.sql`
- Modify: `backend/test/managed-chat-schema.test.js`

**Interface:** `backend/schema.sql` remains a fresh-database schema source only. It is never executed by this task.

- [ ] **Step 1: Add failing source-contract tests**

Add tests named:

```js
test('schema source reproduces audited live column declarations and portfolio order', () => {});
test('every application table pins the live engine and collation', () => {});
test('notification names reproduce audited production metadata', () => {});
test('audit action and portfolio cascade reproduce accepted production behavior', () => {});
```

The assertions must require all of the following:

```text
users.created_at              TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP
users.updated_at              TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
portfolios.mvp_status         ENUM('Idea','Prototype','Beta','Launched') NOT NULL, no DEFAULT
portfolios.funding_goal       DECIMAL(15,2) NOT NULL, no DEFAULT
portfolios.readiness_score    INT NULL DEFAULT 0, no CHECK
notifications.created_at      TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP
audit_logs.action             ENUM('approved','rejected') NOT NULL
```

Require this exact physical `portfolios` order:

```text
id, owner_id, name, sector, description, mvp_status, funding_goal,
team_size, founded_year, location, website, readiness_score, status,
rejection_reason, submitted_at, created_at, updated_at, monthly_revenue,
user_count, growth_rate, market_size, competitor_analysis, advisor_names,
burn_rate, runway_months
```

Require all nine tables to end with:

```sql
ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
```

Require the live notification names:

```text
Indexes: user_id, related_portfolio_id, idx_notifications_conversation,
         idx_notifications_message, related_user_id
FKs:     notifications_ibfk_1, notifications_ibfk_2,
         fk_notifications_conversation, fk_notifications_message,
         notifications_ibfk_3
```

Require a schema comment documenting the accepted cascade and require:

```sql
FOREIGN KEY (portfolio_id) REFERENCES portfolios(id) ON DELETE CASCADE
```

- [ ] **Step 2: Run the source test and observe RED**

Run:

```bash
node --test backend/test/managed-chat-schema.test.js
```

Expected: the new assertions fail on the current timestamp nullability, portfolio defaults/order/check, notification names, audit enum, and missing explicit table options.

- [ ] **Step 3: Update only the audited DDL declarations**

Make the schema declarations match production. The two most error-prone blocks should have this shape:

```sql
CREATE TABLE IF NOT EXISTS portfolios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  owner_id INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  sector VARCHAR(100) NOT NULL,
  description TEXT,
  mvp_status ENUM('Idea','Prototype','Beta','Launched') NOT NULL,
  funding_goal DECIMAL(15,2) NOT NULL,
  team_size INT,
  founded_year YEAR,
  location VARCHAR(255),
  website VARCHAR(500),
  readiness_score INT NULL DEFAULT 0,
  status ENUM('draft','pending','approved','rejected') NOT NULL DEFAULT 'draft',
  rejection_reason TEXT,
  submitted_at TIMESTAMP NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  monthly_revenue DECIMAL(15,2),
  user_count INT,
  growth_rate DECIMAL(5,2),
  market_size VARCHAR(500),
  competitor_analysis TEXT,
  advisor_names VARCHAR(500),
  burn_rate DECIMAL(15,2),
  runway_months INT,
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```

```sql
-- Accepted product behavior: deleting an editable portfolio also deletes its audit rows.
CREATE TABLE IF NOT EXISTS audit_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  admin_id INT NOT NULL,
  action ENUM('approved','rejected') NOT NULL,
  portfolio_id INT NOT NULL,
  reason TEXT,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (portfolio_id) REFERENCES portfolios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```

Preserve the live notification FK rules: user `CASCADE`; portfolio, conversation, message, and related user `SET NULL`; every `ON UPDATE` remains MySQL's `NO ACTION`.

- [ ] **Step 4: Run GREEN verification**

Run:

```bash
node --test backend/test/managed-chat-schema.test.js
node --check backend/scripts/migrate-managed-chat.js
git diff --check
```

Expected: all schema-source tests pass; syntax and diff checks are silent.

- [ ] **Step 5: Commit**

```bash
git add backend/schema.sql backend/test/managed-chat-schema.test.js
git commit -m "fix(schema): align canonical DDL with production"
```

---

## Task 2: Build an independent production metadata fixture and verify tables/columns

**Files:**

- Create: `backend/test/fixtures/production-schema-metadata.json`
- Create: `backend/test/helpers/schema-metadata-harness.js`
- Modify: `backend/test/schema-contract.test.js`
- Modify: `backend/src/schema-contract.js`

**Production interfaces:**

```text
verifySchema(database) -> Promise<true>; otherwise throws one aggregate Error
CommonJS exports -> { verifySchema }
```

Task 4 adds `verifyPreservedCoreSchema`. Do not export an empty implementation
or weaken `verifySchema` in the interim. Do not export `REQUIRED_*` constants.
The accepted fixture must be a literal audited snapshot and must not import,
call, or derive from production contract constants.

**Test helper interfaces:**

```js
cloneProductionSchemaMetadata({ keyCase = 'lower' } = {});
createSchemaMetadataDatabase(metadata);
// => { database: { query(sql) }, queries: string[] }
```

- [ ] **Step 1: Add the literal fixture and harness**

Use these four fixture sections:

```json
{
  "tables": [],
  "columns": [],
  "indexes": [],
  "foreignKeys": []
}
```

All four arrays must be populated in this task. Use the exact index and FK
matrices in Task 3 when transcribing those literal rows, so the existing
relational checks remain active between commits. Task 3 changes how those rows
are matched; it does not introduce them for the first time.

Each table row must contain:

```text
table_name, table_type='BASE TABLE', engine='InnoDB',
table_collation='utf8mb4_0900_ai_ci'
```

The nine literal table names are:

```text
users, portfolios, portfolio_documents, investor_interests,
conversations, conversation_members, messages, notifications, audit_logs
```

Each column row must contain:

```text
table_name, column_name, ordinal_position, column_type, is_nullable,
column_default, extra, generation_expression
```

Transcribe the audited snapshot exactly. This compact matrix is authoritative;
`NULL` means JSON `null`, and blank means `""`:

```text
users:
  id int NO NULL auto_increment
  email varchar(255) NO NULL
  password_hash varchar(255) NO NULL
  name varchar(100) NO NULL
  role enum('business_owner','investor','relationship_manager','admin') NO business_owner
  created_at timestamp YES CURRENT_TIMESTAMP DEFAULT_GENERATED
  updated_at timestamp YES CURRENT_TIMESTAMP "DEFAULT_GENERATED on update CURRENT_TIMESTAMP"

portfolios, in exact ordinal order:
  id int NO NULL auto_increment
  owner_id int NO NULL
  name varchar(255) NO NULL
  sector varchar(100) NO NULL
  description text YES NULL
  mvp_status enum('Idea','Prototype','Beta','Launched') NO NULL
  funding_goal decimal(15,2) NO NULL
  team_size int YES NULL
  founded_year year YES NULL
  location varchar(255) YES NULL
  website varchar(500) YES NULL
  readiness_score int YES 0
  status enum('draft','pending','approved','rejected') NO draft
  rejection_reason text YES NULL
  submitted_at timestamp YES NULL
  created_at timestamp YES CURRENT_TIMESTAMP DEFAULT_GENERATED
  updated_at timestamp YES CURRENT_TIMESTAMP "DEFAULT_GENERATED on update CURRENT_TIMESTAMP"
  monthly_revenue decimal(15,2) YES NULL
  user_count int YES NULL
  growth_rate decimal(5,2) YES NULL
  market_size varchar(500) YES NULL
  competitor_analysis text YES NULL
  advisor_names varchar(500) YES NULL
  burn_rate decimal(15,2) YES NULL
  runway_months int YES NULL

portfolio_documents:
  id int NO NULL auto_increment
  portfolio_id int NO NULL
  file_name varchar(255) NO NULL
  file_url varchar(500) NO NULL
  file_type varchar(50) YES NULL
  uploaded_at timestamp YES CURRENT_TIMESTAMP DEFAULT_GENERATED

investor_interests:
  id int NO NULL auto_increment
  investor_id int NO NULL
  portfolio_id int NO NULL
  created_at timestamp YES CURRENT_TIMESTAMP DEFAULT_GENERATED

conversations:
  id int NO NULL auto_increment
  portfolio_id int YES NULL
  relationship_manager_id int NO NULL
  title varchar(255) NO NULL
  status enum('active','archived') NO active
  archived_reason enum('manual','no_active_investors','portfolio_unapproved','portfolio_deleted') YES NULL
  created_at timestamp NO CURRENT_TIMESTAMP DEFAULT_GENERATED
  updated_at timestamp NO CURRENT_TIMESTAMP "DEFAULT_GENERATED on update CURRENT_TIMESTAMP"

conversation_members:
  conversation_id int NO NULL
  user_id int NO NULL
  member_role enum('relationship_manager','business_owner','investor') NO NULL
  singleton_role varchar(24) YES NULL "STORED GENERATED"
  membership_status enum('active','removed') NO active
  joined_at timestamp NO CURRENT_TIMESTAMP DEFAULT_GENERATED
  left_at timestamp YES NULL
  visible_after_message_id "bigint unsigned" NO 0
  last_read_message_id "bigint unsigned" NO 0

messages:
  id int NO NULL auto_increment
  conversation_id int NO NULL
  sender_id int NO NULL
  content text NO NULL
  created_at timestamp NO CURRENT_TIMESTAMP DEFAULT_GENERATED

notifications:
  id int NO NULL auto_increment
  user_id int NO NULL
  type enum('new_message','new_interest','portfolio_approved','portfolio_rejected','portfolio_needs_changes','portfolio_submitted','conversation_created','conversation_member_added','conversation_archived') NO NULL
  title varchar(255) NO NULL
  body text YES NULL
  related_portfolio_id int YES NULL
  related_conversation_id int YES NULL
  related_message_id int YES NULL
  related_user_id int YES NULL
  read_at timestamp YES NULL
  created_at timestamp YES CURRENT_TIMESTAMP DEFAULT_GENERATED

audit_logs:
  id int NO NULL auto_increment
  admin_id int NO NULL
  action enum('approved','rejected') NO NULL
  portfolio_id int NO NULL
  reason text YES NULL
  created_at timestamp YES CURRENT_TIMESTAMP DEFAULT_GENERATED
```

For `conversation_members.singleton_role`, store the audited expression
literally in the fixture:

```text
(case when (`member_role` in (_utf8mb4'relationship_manager',_utf8mb4'business_owner')) then `member_role` else NULL end)
```

When this value is placed inside the JSON fixture's double-quoted string,
leave the SQL single quotes unescaped; `\'` is not a legal JSON escape.

The harness must deep-clone the JSON, optionally uppercase row keys only, route
queries by `information_schema.tables`, `.columns`, `.statistics`, and the FK
join, record every SQL string, and throw on an unexpected query.

- [ ] **Step 2: Replace tautological tests with fixture mutations**

Add failing cases that clone and mutate the literal fixture:

```text
accept lower-case driver keys
accept upper-case driver keys
reject missing/non-base table
reject wrong engine or collation
reject wrong type, nullability, default, auto_increment, timestamp EXTRA,
       unsigned cursor definition, enum value/order, or generated expression
reject retired messages.receiver_id, messages.portfolio_id, messages.read_at
accept numeric 0 versus '0'
accept CURRENT_TIMESTAMP case and optional parentheses
accept EXTRA token case/order variations
accept generated-expression whitespace, backticks, and redundant outer parentheses
```

The semantic normalizer must not uppercase string literals or strip meaningful
inner parentheses.

- [ ] **Step 3: Run RED**

```bash
node --test backend/test/schema-contract.test.js
```

Expected: current code incorrectly accepts at least the engine, collation,
default, and generated-expression mutations.

- [ ] **Step 4: Implement four-query metadata collection and semantic checks**

The production verifier must issue only read-only `information_schema` queries:

```sql
SELECT TABLE_NAME AS table_name, TABLE_TYPE AS table_type,
       ENGINE AS engine, TABLE_COLLATION AS table_collation
FROM information_schema.tables
WHERE table_schema = DATABASE();
```

```sql
SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name,
       ORDINAL_POSITION AS ordinal_position, COLUMN_TYPE AS column_type,
       IS_NULLABLE AS is_nullable, COLUMN_DEFAULT AS column_default,
       EXTRA AS extra, GENERATION_EXPRESSION AS generation_expression
FROM information_schema.columns
WHERE table_schema = DATABASE();
```

Retain the existing index and FK queries/checks in this intermediate commit;
Task 3 replaces their name-based matching. Keep a hand-authored private column
contract. Accumulate issue labels and throw:

```js
throw new Error(`Missing schema invariants: ${issues.join(', ')}`);
```

Examples of precise labels:

```text
portfolios.funding_goal type must be decimal(15,2)
users.created_at nullability must be YES
conversation_members.singleton_role generation expression changed
notifications.created_at default must be CURRENT_TIMESTAMP
```

- [ ] **Step 5: Run GREEN verification**

```bash
node --test backend/test/schema-contract.test.js
node --check backend/src/schema-contract.js
git diff --check
```

Expected: all lower/upper-case, mutation, and semantic-normalization cases pass.

- [ ] **Step 6: Commit**

```bash
git add backend/src/schema-contract.js \
  backend/test/schema-contract.test.js \
  backend/test/fixtures/production-schema-metadata.json \
  backend/test/helpers/schema-metadata-harness.js
git commit -m "feat(schema): verify production table and column metadata"
```

---

## Task 3: Verify structural indexes and foreign-key rules

**Files:**

- Modify: `backend/src/schema-contract.js`
- Modify: `backend/test/schema-contract.test.js`
- Modify: `backend/test/messages-server.test.js`
- Verify: `backend/test/fixtures/production-schema-metadata.json`
- Modify if query routing requires it:
  `backend/test/helpers/schema-metadata-harness.js`

**Matching rules:**

- Primary keys require the actual name `PRIMARY` and exact ordered columns.
- Other unique indexes require exact ordered columns.
- A required non-unique access index may be renamed and may have trailing
  columns, but its required columns must be a visible left prefix.
- Invisible indexes never satisfy a requirement.
- Foreign keys match structurally by ordered local columns, referenced table,
  ordered referenced columns, `DELETE_RULE`, and `UPDATE_RULE`; names are
  cosmetic.

- [ ] **Step 1: Audit the already-populated literal index and FK fixture**

Every index row must contain:

```text
table_name, index_name, non_unique (0/1), seq_in_index,
column_name, index_type='BTREE', is_visible='YES'
```

Use these exact production groups:

```text
users:                 PRIMARY(id), UNIQUE email(email)
portfolios:            PRIMARY(id), owner_id(owner_id)
portfolio_documents:   PRIMARY(id), portfolio_id(portfolio_id)
investor_interests:    PRIMARY(id), UNIQUE unique_interest(investor_id,portfolio_id),
                       portfolio_id(portfolio_id)
conversations:         PRIMARY(id), UNIQUE unique_conversation_portfolio(portfolio_id),
                       fk_conversations_manager(relationship_manager_id)
conversation_members:  PRIMARY(conversation_id,user_id),
                       UNIQUE unique_conversation_singleton(conversation_id,singleton_role),
                       idx_members_user_status(user_id,membership_status)
messages:              PRIMARY(id), idx_messages_conversation_id(conversation_id,id),
                       fk_messages_member(conversation_id,sender_id)
notifications:         PRIMARY(id), user_id(user_id),
                       related_portfolio_id(related_portfolio_id),
                       idx_notifications_conversation(related_conversation_id),
                       idx_notifications_message(related_message_id),
                       related_user_id(related_user_id)
audit_logs:            PRIMARY(id), admin_id(admin_id), portfolio_id(portfolio_id)
```

Every FK row must contain local/ref table and column, ordinal position,
constraint name, update rule, and delete rule. Use these 16 groups:

```text
portfolios_ibfk_1:
  portfolios.owner_id -> users.id                         CASCADE / NO ACTION
portfolio_documents_ibfk_1:
  portfolio_documents.portfolio_id -> portfolios.id       CASCADE / NO ACTION
investor_interests_ibfk_1:
  investor_interests.investor_id -> users.id              CASCADE / NO ACTION
investor_interests_ibfk_2:
  investor_interests.portfolio_id -> portfolios.id        CASCADE / NO ACTION
fk_conversations_portfolio:
  conversations.portfolio_id -> portfolios.id             SET NULL / NO ACTION
fk_conversations_manager:
  conversations.relationship_manager_id -> users.id       RESTRICT / NO ACTION
fk_members_conversation:
  conversation_members.conversation_id -> conversations.id CASCADE / NO ACTION
fk_members_user:
  conversation_members.user_id -> users.id                RESTRICT / NO ACTION
fk_messages_member:
  messages.(conversation_id,sender_id)
    -> conversation_members.(conversation_id,user_id)     RESTRICT / NO ACTION
notifications_ibfk_1:
  notifications.user_id -> users.id                       CASCADE / NO ACTION
notifications_ibfk_2:
  notifications.related_portfolio_id -> portfolios.id     SET NULL / NO ACTION
fk_notifications_conversation:
  notifications.related_conversation_id -> conversations.id SET NULL / NO ACTION
fk_notifications_message:
  notifications.related_message_id -> messages.id         SET NULL / NO ACTION
notifications_ibfk_3:
  notifications.related_user_id -> users.id               SET NULL / NO ACTION
audit_logs_ibfk_1:
  audit_logs.admin_id -> users.id                          CASCADE / NO ACTION
audit_logs_ibfk_2:
  audit_logs.portfolio_id -> portfolios.id                 CASCADE / NO ACTION
```

- [ ] **Step 2: Add failing structural tests**

Cover:

```text
missing unique users.email fails
missing unique investor_interests(investor_id,portfolio_id) fails
wrong primary/unique ordered columns fail
renamed equivalent non-unique left-prefix index passes
invisible or wrong-prefix index fails
extra non-conflicting and automatic FK-support indexes pass
renamed equivalent FK passes
wrong local/ref column order, target, DELETE, or UPDATE rule fails
audit_logs.portfolio_id changing from CASCADE fails with a named invariant
```

- [ ] **Step 3: Lock the readiness endpoint behavior**

Using `createApp({ database, verifySchema })`, require:

```text
SELECT 1 plus successful verifySchema -> 200 {"status":"ready"}
verifySchema throwing "Missing schema invariants: audit_logs.portfolio_id ..."
  -> 503 {"status":"not ready"}
console error includes the precise invariant text
```

- [ ] **Step 4: Run RED**

```bash
node --test \
  backend/test/schema-contract.test.js \
  backend/test/messages-server.test.js
```

Expected: current name-based/no-rule behavior cannot satisfy the renamed
equivalent and referential-action tests.

- [ ] **Step 5: Implement structural grouping and matching**

The FK query must join referential constraints:

```sql
SELECT k.TABLE_NAME AS table_name,
       k.CONSTRAINT_NAME AS constraint_name,
       k.COLUMN_NAME AS column_name,
       k.REFERENCED_TABLE_NAME AS referenced_table_name,
       k.REFERENCED_COLUMN_NAME AS referenced_column_name,
       k.ORDINAL_POSITION AS ordinal_position,
       r.UPDATE_RULE AS update_rule,
       r.DELETE_RULE AS delete_rule
FROM information_schema.key_column_usage k
JOIN information_schema.referential_constraints r
  ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA
 AND r.TABLE_NAME = k.TABLE_NAME
 AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
WHERE k.TABLE_SCHEMA = DATABASE()
  AND k.REFERENCED_TABLE_NAME IS NOT NULL;
```

The index query must include `INDEX_TYPE` and `IS_VISIBLE`. Normalize
referential rules to uppercase, but do not treat `RESTRICT` as equivalent to
`NO ACTION`.

- [ ] **Step 6: Run GREEN and regression verification**

```bash
node --test \
  backend/test/schema-contract.test.js \
  backend/test/messages-server.test.js
npm --prefix backend test
git diff --check
```

Expected: focused and full backend suites pass with zero failures.

- [ ] **Step 7: Commit**

```bash
git add backend/src/schema-contract.js \
  backend/test/schema-contract.test.js \
  backend/test/messages-server.test.js \
  backend/test/fixtures/production-schema-metadata.json \
  backend/test/helpers/schema-metadata-harness.js
git commit -m "feat(schema): enforce relational database invariants"
```

---

## Task 4: Stop managed-chat migration before destructive DDL on malformed core schemas

**Files:**

- Modify: `backend/src/schema-contract.js`
- Modify: `backend/scripts/migrate-managed-chat.js`
- Modify: `backend/test/schema-contract.test.js`
- Modify: `backend/test/managed-chat-schema.test.js`

**Interface:**

```text
verifyPreservedCoreSchema(database) -> Promise<true>;
otherwise throws before the migration issues any write or DDL
```

The preserved scope is `users`, `portfolios`, `portfolio_documents`,
`investor_interests`, core notification fields/relationships, and
`audit_logs`. It excludes migration-owned chat tables and the optional chat
notification columns/FKs.

- [ ] **Step 1: Add preserved-core contract tests**

Build a legacy fixture by cloning the production fixture and removing:

```text
conversations
conversation_members
messages
notifications.related_conversation_id
notifications.related_message_id
their indexes and foreign keys
```

Allow only these two exact migration-owned enum shapes:

```text
users.role legacy: business_owner, investor, admin
users.role target: business_owner, investor, relationship_manager, admin

notifications.type legacy:
  new_message, new_interest, portfolio_approved, portfolio_rejected,
  portfolio_needs_changes, portfolio_submitted
notifications.type target:
  the same six plus conversation_created, conversation_member_added,
  conversation_archived
```

Reject reordered values, unknown values, missing core columns, wrong
`audit_logs` cascade, missing unique email/interest, or wrong core notification
FKs.

- [ ] **Step 2: Add a failing no-mutation migration test**

Run `migrateManagedChat` with valid guard strings and a metadata fixture whose
audit portfolio FK uses the wrong delete rule. Record every SQL statement and
build a migration-aware fake database:

1. Delegate the four complete `information_schema` metadata queries to
   `createSchemaMetadataDatabase`.
2. Return the allowed user roles for `SELECT DISTINCT role FROM users`.
3. Return the target notification columns/types for the migration's narrower
   notification metadata SELECT.
4. Return no stored notification types for
   `SELECT DISTINCT type FROM notifications`.
5. Return `{ count: 0 }` for every protected-count SELECT.
6. Return `[]` for unrelated-notification identity SELECTs.
7. Record every SQL string.
8. If any non-SELECT is attempted, throw
   `new Error('FIRST_MUTATION_ATTEMPTED')` instead of executing it.
9. Throw on every other unexpected SELECT so the fake cannot conceal a new
   preflight dependency.

Then assert:

```js
await assert.rejects(
  migrateManagedChat(database, validGuards),
  /audit_logs.*portfolio.*CASCADE/i,
);
assert.equal(
  queries.every((sql) => /^\s*SELECT\b/i.test(sql)),
  true,
);
assert.equal(
  queries.some((sql) => /\b(DELETE|DROP|ALTER|INSERT|UPDATE|CREATE)\b/i.test(sql)),
  false,
);
```

Before `verifyPreservedCoreSchema` is implemented, this new assertion must
fail because the fake records the attempted `DELETE` and throws the sentinel.
After implementation, the malformed FK is rejected during metadata SELECTs
and the sentinel is never reached.

- [ ] **Step 3: Run RED**

```bash
node --test \
  backend/test/schema-contract.test.js \
  backend/test/managed-chat-schema.test.js
```

Expected: current migration reaches its first `DELETE` because it has no
complete preserved-core metadata gate.

- [ ] **Step 4: Call the preflight immediately after guard validation**

At the top of the migration:

```js
const {
  verifyPreservedCoreSchema,
  verifySchema,
} = require('../src/schema-contract');
```

At the start of `migrateManagedChat`:

```js
assertMigrationGuards(environment);
await verifyPreservedCoreSchema(database);
```

This call must precede every existing table/role/count read that eventually
leads to the first `DELETE`, and therefore precede all destructive statements.
Keep the complete post-migration `verifySchema(database)` gate.

- [ ] **Step 5: Run GREEN and full regression**

```bash
node --test \
  backend/test/schema-contract.test.js \
  backend/test/managed-chat-schema.test.js
npm --prefix backend test
node --check backend/scripts/migrate-managed-chat.js
git diff --check
```

Expected: malformed preserved metadata is rejected after SELECTs only; all
existing migration guards and the full backend suite pass.

- [ ] **Step 6: Commit**

```bash
git add backend/src/schema-contract.js \
  backend/scripts/migrate-managed-chat.js \
  backend/test/schema-contract.test.js \
  backend/test/managed-chat-schema.test.js
git commit -m "fix(migration): verify preserved schema before chat reset"
```

---

## Task 5: Centralize database boundary rules and allowlist the runtime module

**Files:**

- Create: `backend/src/validation/database-boundaries.js`
- Create: `backend/test/database-boundaries.test.js`
- Modify: `backend/deploy/runtime-manifest.txt`
- Modify: `backend/test/messages-deployment-files.test.js`

**Pure CommonJS interface:**

```js
module.exports = {
  CANONICAL_SECTORS,
  MVP_STATUSES,
  DB_LIMITS,
  hasMaxCharacters,
  hasMaxUtf8Bytes,
  isBoundedInteger,
  isBoundedDecimal,
  isAbsoluteHttpUrl,
  isValidDocumentFilename,
  normalizeReadinessScore,
};
```

- [ ] **Step 1: Write the failing pure-helper tests**

Require these exact constants:

```js
const CANONICAL_SECTORS = Object.freeze([
  'SaaS',
  'Fintech',
  'Healthtech',
  'Edtech',
  'AI / ML',
  'Clean Energy',
  'E-commerce',
  'Logistics',
  'Other',
]);

const MVP_STATUSES = Object.freeze(['Idea', 'Prototype', 'Beta', 'Launched']);

const DB_LIMITS = Object.freeze({
  USER_NAME_CHARS: 100,
  USER_EMAIL_CHARS: 255,
  PORTFOLIO_NAME_CHARS: 255,
  SECTOR_CHARS: 100,
  LOCATION_CHARS: 255,
  WEBSITE_CHARS: 500,
  MARKET_SIZE_CHARS: 500,
  ADVISOR_NAMES_CHARS: 500,
  TEXT_BYTES: 65535,
  DOCUMENT_NAME_CHARS: 255,
  SIGNED_INT_MAX: 2147483647,
  YEAR_MIN: 1901,
  YEAR_MAX: 2100,
  DECIMAL_15_2_MAX: '9999999999999.99',
  DECIMAL_5_2_MAX: '999.99',
  JSON_LIMIT: '256kb',
});
```

Table-test these boundaries:

```text
DECIMAL(15,2): 9999999999999.99 passes; 10000000000000.00 fails
DECIMAL(5,2):  999.99 passes; 1000.00 fails
scale:         0.01 and 0 pass; 0.001 fails
INT:           2147483647 passes; 2147483648 and 1.5 fail
YEAR:          1901 and 2100 pass; 1900 and 2101 fail
```

Every numeric helper must reject `null`, `''`, whitespace, booleans, arrays,
objects, `NaN`, infinities, and sign-only strings. Numeric exponent strings are
allowed when they resolve exactly within the requested range and scale:
`1e3`, `1.2e2`, and `1e-2` pass the relevant decimal helper, while `1e-3`
fails a two-decimal scale and an exponent-driven overflow fails the range.
`isBoundedInteger('1e3')` passes, while `isBoundedInteger('1e-1')` fails.

Also test:

```text
65,535 ASCII bytes pass; 65,536 fail
CJK/emoji are measured with Buffer.byteLength(value, 'utf8')
http/https absolute URLs pass; relative, ftp, and malformed URLs fail
255 Unicode-code-point filenames pass; 256 fail, including astral characters
readiness null/malformed/negative -> 0; 88/'88' -> 88; values above 100 -> 100
readiness booleans, arrays, objects, and whitespace-only strings -> 0
```

- [ ] **Step 2: Add a failing manifest assertion**

Insert the new production path immediately after
`backend/src/schema-contract.js` in both exact lists:

```text
backend/src/validation/database-boundaries.js
```

Run:

```bash
node --test \
  backend/test/database-boundaries.test.js \
  backend/test/messages-deployment-files.test.js
```

Expected RED: module-not-found first, then an exact manifest mismatch until
both lists are updated.

- [ ] **Step 3: Implement strict helpers without floating-point rounding**

`isBoundedDecimal` must validate decimal syntax, pad the fractional portion to
the requested scale, and compare scaled `BigInt` values. Support an optional
base-10 exponent by combining coefficient digits, fractional digits, and the
exponent into an effective decimal scale; remove insignificant trailing zeroes
before enforcing the maximum scale. Reuse that exact parser for integer
validation and require effective scale zero there. Do not call `parseFloat` or
round.

Use code-point character length and UTF-8 byte length:

```js
function hasMaxCharacters(value, max) {
  return typeof value === 'string' && Array.from(value).length <= max;
}

function hasMaxUtf8Bytes(value, max) {
  return typeof value === 'string'
    && Buffer.byteLength(value, 'utf8') <= max;
}
```

Use this readiness semantic:

```js
function normalizeReadinessScore(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return 0;
  if (typeof value === 'string' && value.trim() === '') return 0;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(100, Math.max(0, numeric));
}
```

- [ ] **Step 4: Run GREEN verification**

```bash
node --test \
  backend/test/database-boundaries.test.js \
  backend/test/messages-deployment-files.test.js
node --check backend/src/validation/database-boundaries.js
git diff --check
```

Expected: all pure boundary vectors pass and the runtime manifest is exact.

- [ ] **Step 5: Commit**

```bash
git add backend/src/validation/database-boundaries.js \
  backend/test/database-boundaries.test.js \
  backend/deploy/runtime-manifest.txt \
  backend/test/messages-deployment-files.test.js
git commit -m "feat: centralize database boundary rules"
```

---

## Task 6: Align the portfolio editor and Browse sectors before strict backend validation

**Files:**

- Modify: `createportfolio.html`
- Modify: `browse.html`
- Modify: `js/createportfolio.js`
- Modify: `js/browse.js`
- Modify: `backend/test/createportfolio-client.test.js`
- Modify: `backend/test/frontend-flow-contract.test.js`

**Browser interfaces:**

```text
const CANONICAL_SECTORS = Object.freeze([
  'SaaS', 'Fintech', 'Healthtech', 'Edtech', 'AI / ML',
  'Clean Energy', 'E-commerce', 'Logistics', 'Other',
]);
function utf8ByteLength(value);
function validatePortfolioPayload(payload);
function buildPortfolioPayload();
```

`buildPortfolioPayload()` must keep required funding as an exact decimal
string and omit blank optional numeric keys. It must never serialize blank
optional numeric inputs as `null`.

- [ ] **Step 1: Add failing HTML contract tests**

Require Create Portfolio and Browse to expose this exact shared order:

```text
SaaS, Fintech, Healthtech, Edtech, AI / ML,
Clean Energy, E-commerce, Logistics, Other
```

Require exact HTML constraints:

```text
f-name              required maxlength=255
f-sector            required
f-mvp_status        required
f-funding_goal      required min=0 max=9999999999999.99 step=0.01
f-description       maxlength=65535
f-team_size         min=0 max=2147483647 step=1
f-founded_year      min=1901 max=2100 step=1
f-location          maxlength=255
f-website           maxlength=500
f-advisor_names     maxlength=500
f-monthly_revenue   min=0 max=9999999999999.99 step=0.01
f-user_count        min=0 max=2147483647 step=1
f-growth_rate       min=0 max=999.99 step=0.01
f-market_size       maxlength=500
f-competitor_analysis maxlength=65535
f-burn_rate         min=0 max=9999999999999.99 step=0.01
f-runway_months     min=0 max=2147483647 step=1
```

The browser `maxlength` for `TEXT` is advisory; backend byte validation remains
authoritative.

Require the upload hint to be exactly:

```text
Accepted: PDF, PPT, PPTX, DOC, and DOCX • Max size: 10MB
```

- [ ] **Step 2: Add failing editor behavior tests**

Update invalid lowercase fixture values from `beta` to `Beta`, then prove:

```text
observed live sectors AI / ML, Edtech, Fintech, Healthtech, Logistics
  hydrate and serialize unchanged
blank optional numerics are omitted
numeric zeroes are preserved as accepted exact strings
year 1900 is rejected; 1901 and 2100 pass
decimal/int overflow and excess scale are rejected
invalid sector/MVP and non-http(s) website are rejected
TEXT byte overflow using CJK/emoji is rejected
invalid input preserves field values and causes zero API calls
```

- [ ] **Step 3: Run RED**

```bash
node --test \
  backend/test/createportfolio-client.test.js \
  backend/test/frontend-flow-contract.test.js
```

Expected: sector order, limits, optional numeric omission, year 1900, and
byte-aware validation fail.

- [ ] **Step 4: Implement exact client serialization and validation**

Use `TextEncoder` for browser byte length:

```js
function utf8ByteLength(value) {
  return new TextEncoder().encode(String(value)).length;
}
```

Expose `TextEncoder` in the VM test harness. Use the same strict
regex-plus-scaled-`BigInt` approach as the backend helper for decimal strings;
do not round through `Number` before testing scale or maxima.

Read numeric inputs as trimmed strings so the decimal boundary is not rounded
through JavaScript `Number`. Add optional numeric keys only when nonblank:

```js
function assignIfPresent(payload, key, elementId) {
  const value = document.getElementById(elementId).value.trim();
  if (value !== '') payload[key] = value;
}
```

`validatePortfolioPayload` must return either `{ valid: true }` or:

```js
{ valid: false, field: 'f-growth_rate', message: 'Growth Rate must be between 0 and 999.99 with at most 2 decimal places.' }
```

Use a field-relevant message, focus the invalid field, keep all current
values, and return before `API.createPortfolio`/`API.updatePortfolio`.

Change Browse sector matching from substring matching to exact matching:

```js
const sector = document.getElementById('sector-filter').value;
const matchSector = !sector || p.sector === sector;
```

- [ ] **Step 5: Run GREEN verification**

```bash
node --test \
  backend/test/createportfolio-client.test.js \
  backend/test/frontend-flow-contract.test.js
node --check js/createportfolio.js
node --check js/browse.js
git diff --check
```

Expected: both sector lists, observed live values, payload omission, and all
client boundaries pass.

- [ ] **Step 6: Commit**

```bash
git add createportfolio.html browse.html js/createportfolio.js js/browse.js \
  backend/test/createportfolio-client.test.js \
  backend/test/frontend-flow-contract.test.js
git commit -m "feat: align portfolio form with database limits"
```

---

## Task 7: Enforce user-column limits on public and administrator account creation

**Files:**

- Create: `backend/test/auth-request-boundaries.test.js`
- Create: `backend/test/auth-client-boundaries.test.js`
- Modify: `backend/src/routes/auth.js`
- Modify: `backend/src/routes/admin.js`
- Modify: `signup.html`
- Modify: `signin.html`
- Modify: `js/script.js`
- Modify: `backend/test/frontend-flow-contract.test.js`
- Regression: `backend/test/relationship-manager-admin.test.js`

**Interfaces:** Route-local `registrationValidation`, `loginValidation`, and
`relationshipManagerValidation` arrays of express-validator chains.

- [ ] **Step 1: Add failing route-level tests**

Start `createApp()`, sign test JWTs where required, stub the DB singleton, and
assert:

```text
register: 101-character name -> 400, zero DB calls
register: >255-character valid-shaped email -> 400 with the explicit
          "Email must be at most 255 characters" error, zero DB calls
register: exact 100-character name + ordinary email reaches duplicate lookup
register: relationship_manager role remains 400
login: >255-character email -> the same explicit max-length 400, zero DB calls
admin manager creation: name/email overflow -> explicit max-length 400,
                        zero DB calls
validation responses never include the submitted password
```

- [ ] **Step 2: Add failing browser account-boundary tests**

Require:

```text
signup su-name required maxlength=100
signup su-email required maxlength=255
signin si-email required maxlength=255
an overlong signup name shows the name-field error, preserves values,
  and performs zero fetch calls
an overlong signup email shows the email-field error and performs zero fetch calls
an overlong signin email shows the email-field error and performs zero fetch calls
an exact 100-character name with an ordinary valid email proceeds to the
  existing apiPost path
```

Use a VM harness for `js/script.js` with real form submit dispatch. Do not
assert only source text: prove invalid browser input stops before `fetch`.

- [ ] **Step 3: Run RED**

```bash
node --test \
  backend/test/auth-request-boundaries.test.js \
  backend/test/auth-client-boundaries.test.js \
  backend/test/frontend-flow-contract.test.js \
  backend/test/relationship-manager-admin.test.js
```

Expected: public registration currently reaches the DB with overlong
name/email values.

- [ ] **Step 4: Consume shared constants in both backend routes**

Every string chain must reject non-strings before sanitizing:

```js
body('name')
  .isString().bail()
  .trim()
  .notEmpty().bail()
  .isLength({ max: DB_LIMITS.USER_NAME_CHARS });

body('email')
  .isString().bail()
  .normalizeEmail()
  .isLength({ max: DB_LIMITS.USER_EMAIL_CHARS })
  .withMessage('Email must be at most 255 characters').bail()
  .isEmail();
```

Keep public roles exactly:

```js
body('role').isIn(['business_owner', 'investor']);
```

Keep the administrator password bounds at `6..128` and preserve the existing
safe validation-error projection.

The explicit max-length message/order is intentional: the old `isEmail()`
already rejects many RFC-overlong addresses, so a status-only email test would
not be a reliable RED test for the database boundary.

- [ ] **Step 5: Mirror the account limits in the browser**

Add `required` and `maxlength` attributes named by Step 2. In
`initSignupPage` and `initSigninPage`, check trimmed name/email length before
calling `apiPost`, use the existing field-error elements, preserve the typed
values, and keep public role behavior unchanged.

- [ ] **Step 6: Run GREEN verification**

```bash
node --test \
  backend/test/auth-request-boundaries.test.js \
  backend/test/auth-client-boundaries.test.js \
  backend/test/frontend-flow-contract.test.js \
  backend/test/relationship-manager-admin.test.js
node --check backend/src/routes/auth.js
node --check backend/src/routes/admin.js
node --check js/script.js
git diff --check
```

Expected: all overflows stop at HTTP 400 with no query, while valid boundaries
reach the existing handlers.

- [ ] **Step 7: Commit**

```bash
git add backend/src/routes/auth.js backend/src/routes/admin.js \
  signup.html signin.html js/script.js \
  backend/test/auth-request-boundaries.test.js \
  backend/test/auth-client-boundaries.test.js \
  backend/test/frontend-flow-contract.test.js
git commit -m "fix: enforce user column boundaries"
```

---

## Task 8: Enforce exact portfolio boundaries before any data query or transaction

**Files:**

- Create: `backend/test/portfolio-request-boundaries.test.js`
- Modify: `backend/src/routes/portfolios.js`
- Regression: `backend/test/portfolio-state.test.js`
- Regression: `backend/test/workflow-transactions.test.js`
- Regression: `backend/test/document-workflow.test.js`

**Interfaces:** Route-local `portfolioCreateValidation` and
`portfolioUpdateValidation` arrays of express-validator chains.

Remove `optFloat` and `optInt`.

- [ ] **Step 1: Add a route harness and failing table-driven tests**

Use a signed business-owner JWT. Stub both `db.query` and `db.getConnection`.
For invalid requests, assert HTTP 400 and zero calls to either one.

Cover create and supplied update values for:

```text
name required and <=255
sector exact CANONICAL_SECTORS member
mvp_status exact MVP_STATUSES member
funding_goal required, non-null, nonblank
funding_goal/monthly_revenue/burn_rate 0..9999999999999.99, scale <=2
growth_rate 0..999.99, scale <=2
team_size/user_count/runway_months 0..2147483647 integers
founded_year 1901..2100
location <=255
website <=500 and absolute http/https when nonblank
market_size/advisor_names <=500
description/competitor_analysis <=65,535 UTF-8 bytes
```

Numeric cases must include `null`, empty string, whitespace, boolean, array,
object, accepted in-range exponent notation, exponent-driven scale/range
failure, non-finite values, fractional integers, exact maxima, and
one-cent/one-unit overflow.

Add positive tests proving:

```text
valid create reaches INSERT and returns 201
valid partial update reaches the existing workflow
omitted optional numeric fields pass
1901 and 2100 pass
ASCII and multibyte TEXT exact byte boundaries pass
```

- [ ] **Step 2: Run RED**

```bash
node --test backend/test/portfolio-request-boundaries.test.js
```

Expected: coercible, over-scale, overlong, and year-1900 inputs currently reach
the handler.

- [ ] **Step 3: Build validation arrays from the pure boundary module**

For optional numerics, skip only `undefined`; explicit `null` and empty values
must reach the custom validator and fail:

```js
body(field)
  .optional({ values: 'undefined' })
  .custom((value) => isBoundedDecimal(value, {
    min: '0',
    max: DB_LIMITS.DECIMAL_15_2_MAX,
    scale: 2,
  }));
```

For nullable/blank optional strings, allow omission, `null`, or `''`, but
require actual strings and the relevant limit for every nonblank value.
Website additionally calls `isAbsoluteHttpUrl`.

For `TEXT`, do not call `.trim()` before byte validation; trimming would make
the request boundary differ from the value the user submitted. The handler
may retain existing normalization only after validation.

Remove the create-handler default:

```js
// Before
description = '', funding_goal = 0,

// After
description = '', funding_goal,
```

Validation must finish before the create `db.query` or update workflow call.

- [ ] **Step 4: Run GREEN and transaction regressions**

```bash
node --test \
  backend/test/portfolio-request-boundaries.test.js \
  backend/test/portfolio-state.test.js \
  backend/test/workflow-transactions.test.js \
  backend/test/document-workflow.test.js
node --check backend/src/routes/portfolios.js
git diff --check
```

Expected: invalid inputs return 400 without a data query/transaction and all
existing workflow tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/portfolios.js \
  backend/test/portfolio-request-boundaries.test.js
git commit -m "fix: validate portfolio database boundaries"
```

---

## Task 9: Reject overlong original document names before storage

**Files:**

- Modify: `backend/src/middleware/upload.js`
- Modify: `backend/test/documents-security.test.js`
- Regression: `backend/test/document-workflow.test.js`

- [ ] **Step 1: Add failing direct and multipart tests**

Test direct `fileFilter` callbacks:

```text
255-code-point complete filename + matching MIME/extension passes
256-code-point complete filename fails with multer.MulterError
multibyte/astral 255 passes and 256 fails
existing MIME/extension mismatch still fails
```

Add an integration request against `createApp()`:

1. Stub the ownership query to return an editable portfolio.
2. Snapshot `backend/uploads/portfolio-documents`.
3. Submit a valid MIME Blob whose original filename exceeds 255 characters.
4. Assert HTTP 400 JSON.
5. Assert the upload directory is unchanged.
6. Assert `db.getConnection` was never called.

The ownership SELECT is allowed; no file write or transaction is allowed.

- [ ] **Step 2: Run RED**

```bash
node --test \
  backend/test/documents-security.test.js \
  backend/test/document-workflow.test.js
```

Expected: the current filter accepts the overlong matching filename.

- [ ] **Step 3: Check the filename first in `fileFilter`**

```js
function fileFilter(req, file, cb) {
  if (!isValidDocumentFilename(file.originalname)) {
    return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'documents'));
  }
  // Existing MIME and extension checks follow unchanged.
}
```

- [ ] **Step 4: Run GREEN verification**

```bash
node --test \
  backend/test/documents-security.test.js \
  backend/test/document-workflow.test.js
node --check backend/src/middleware/upload.js
git diff --check
```

Expected: overlong names return 400 before storage and all existing upload
limits still pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/middleware/upload.js \
  backend/test/documents-security.test.js
git commit -m "fix: reject oversized document names before storage"
```

---

## Task 10: Make the JSON body limit explicit and return JSON 413

**Files:**

- Modify: `backend/server.js`
- Modify: `backend/test/messages-server.test.js`

- [ ] **Step 1: Add failing integration tests**

POST a JSON body larger than `256 * 1024` bytes to `/api/auth/register` and
assert:

```text
status: 413
content-type: application/json
body: {"error":"Request body too large"}
DB calls: 0
```

Add a below-limit request that reaches ordinary route validation rather than
413. Keep health, ready injection, unknown-route, and Multer error tests.

- [ ] **Step 2: Run RED**

```bash
node --test backend/test/messages-server.test.js
```

Expected: the oversized body does not yet return the required safe JSON 413.

- [ ] **Step 3: Configure the parser and map its error before generic 500**

```js
const { DB_LIMITS } = require('./src/validation/database-boundaries');

app.use(express.json({ limit: DB_LIMITS.JSON_LIMIT }));
```

After the Multer branch and before the generic error handler:

```js
if (error?.type === 'entity.too.large' || error?.status === 413) {
  return res.status(413).json({ error: 'Request body too large' });
}
```

Do not log the request body or let this error reach the generic 500 handler.

- [ ] **Step 4: Run GREEN verification**

```bash
node --test backend/test/messages-server.test.js
node --check backend/server.js
git diff --check
```

Expected: oversized JSON returns the exact 413 response; existing server tests
pass.

- [ ] **Step 5: Commit**

```bash
git add backend/server.js backend/test/messages-server.test.js
git commit -m "fix: bound JSON request bodies"
```

---

## Task 11: Normalize nullable readiness scores across backend and browser consumers

**Files:**

- Modify: `backend/src/routes/recommendations.js`
- Create: `backend/test/recommendations-readiness.test.js`
- Modify: `js/api.js`
- Modify: `js/browse.js`
- Modify: `js/investordashboard.js`
- Modify: `js/my-interests.js`
- Modify: `js/mybusinesses.js`
- Modify: `js/createportfolio.js`
- Modify: `js/moderatordashboard.js`
- Modify: `businessownerdashboard.html`
- Modify: `backend/test/api-client.test.js`
- Modify: `backend/test/browse-client.test.js`
- Modify: `backend/test/investor-pages-client.test.js`
- Modify: `backend/test/mybusinesses-client.test.js`
- Modify: `backend/test/createportfolio-client.test.js`
- Modify: `backend/test/admin-dashboard-client.test.js`
- Modify: `backend/test/frontend-flow-contract.test.js`

**Shared browser interface:**

```text
normalizeReadinessScore(value) -> number in the inclusive range 0..100
```

It must use the same semantics as the backend helper from Task 5.

- [ ] **Step 1: Add failing backend recommendation tests**

Stub recommendation queries with `readiness_score` values:

```text
null, undefined, 'not-a-score', -1, '88', 101
```

Require returned `readiness_score`, `ai_score`, and `is_high_potential` to be
finite and based on normalized `0..100`. Keep the existing recommendation
weights unchanged.

- [ ] **Step 2: Add failing browser tests**

Prove that `null` and malformed readiness render/sort as numeric `0` in:

```text
Browse card, threshold/filter, high-potential check, and fallback sort
Investor recent cards
My Interests
My Businesses
Create/Edit summary
Moderator queue/review details
Business Owner recent portfolio inline renderer
```

Add direct API-helper vectors for `normalizeReadinessScore`.
Those vectors must include `true`, `[88]`, `{}`, and whitespace-only strings
and require numeric `0`, preventing JavaScript coercion from becoming a score.

- [ ] **Step 3: Run RED**

```bash
node --test \
  backend/test/recommendations-readiness.test.js \
  backend/test/api-client.test.js \
  backend/test/browse-client.test.js \
  backend/test/investor-pages-client.test.js \
  backend/test/mybusinesses-client.test.js \
  backend/test/createportfolio-client.test.js \
  backend/test/admin-dashboard-client.test.js \
  backend/test/frontend-flow-contract.test.js
```

Expected: current consumers render `null/100`, malformed values, or `NaN`.

- [ ] **Step 4: Normalize at every calculation/render boundary**

In recommendations, normalize before calculating or spreading the row:

```js
const readinessScore = normalizeReadinessScore(p.readiness_score);
return {
  ...p,
  readiness_score: readinessScore,
  ai_score: computeScore(
    { ...p, readiness_score: readinessScore },
    alreadyInterestedIds,
    maxInterests,
    oldestDate,
  ),
  is_high_potential: readinessScore >= 75,
  already_interested: alreadyInterestedIds.has(p.id),
};
```

In browser files, assign a local normalized value once per portfolio before
comparisons and interpolation. Do not rely on truthiness or repeat raw
`p.readiness_score`.

In moderator review details, use:

```js
const readinessScore = normalizeReadinessScore(full.readiness_score);
const hasTeamSize = full.team_size !== null && full.team_size !== undefined;
```

This task changes no readiness calculation formula and writes nothing to the
database.

- [ ] **Step 5: Run GREEN verification**

```bash
node --test \
  backend/test/recommendations-readiness.test.js \
  backend/test/api-client.test.js \
  backend/test/browse-client.test.js \
  backend/test/investor-pages-client.test.js \
  backend/test/mybusinesses-client.test.js \
  backend/test/createportfolio-client.test.js \
  backend/test/admin-dashboard-client.test.js \
  backend/test/frontend-flow-contract.test.js
for file in js/*.js; do node --check "$file" || exit 1; done
git diff --check
```

Expected: every named consumer displays and compares a numeric `0` for
nullable/malformed values.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/recommendations.js \
  backend/test/recommendations-readiness.test.js \
  js/api.js js/browse.js js/investordashboard.js js/my-interests.js \
  js/mybusinesses.js js/createportfolio.js js/moderatordashboard.js \
  businessownerdashboard.html \
  backend/test/api-client.test.js \
  backend/test/browse-client.test.js \
  backend/test/investor-pages-client.test.js \
  backend/test/mybusinesses-client.test.js \
  backend/test/createportfolio-client.test.js \
  backend/test/admin-dashboard-client.test.js \
  backend/test/frontend-flow-contract.test.js
git commit -m "fix: normalize nullable readiness scores"
```

---

## Task 12: Correct database-derived UI copy and remove unsupported controls

**Files:**

- Modify: `audit-logs.html`
- Modify: `moderatordashboard.html`
- Modify: `messages.html`
- Modify: `mybusinesses.html`
- Modify: `createportfolio.html`
- Modify: `js/api.js`
- Modify: `js/moderatordashboard.js`
- Modify: `backend/test/api-client.test.js`
- Modify: `backend/test/admin-dashboard-client.test.js`
- Modify: `backend/test/frontend-flow-contract.test.js`

- [ ] **Step 1: Add failing copy/control tests**

Require these exact labels:

```text
Latest 100 actions
Actions in latest 100
Approved in latest 100
Rejected in latest 100
Investor Interests
Relationship managers
Search conversations
```

Require team size `0` to render as `0`, not `No team size provided`.

Require:

```text
no nav-msg-badge in mybusinesses.html
no nav-msg-badge in createportfolio.html
Messages navigation remains present in both pages
API.approvePortfolio(id) sends PUT with no notes argument and no body
```

- [ ] **Step 2: Run RED**

```bash
node --test \
  backend/test/api-client.test.js \
  backend/test/admin-dashboard-client.test.js \
  backend/test/frontend-flow-contract.test.js
```

Expected: old labels, dead badges, truthy team-size rendering, and approval
notes contract fail.

- [ ] **Step 3: Make copy-only and dead-control changes**

Do not change admin SQL or add pagination. Change only what the existing data
actually means.

Change the API helper to:

```js
approvePortfolio: (id) =>
  apiFetch(`/admin/portfolios/${id}/approve`, { method: 'PUT' }),
```

Remove only the two permanently hidden owner-subpage badge elements/wrappers;
retain the wired badge on `businessownerdashboard.html` and the messages-page
badge.

- [ ] **Step 4: Run GREEN verification**

```bash
node --test \
  backend/test/api-client.test.js \
  backend/test/admin-dashboard-client.test.js \
  backend/test/frontend-flow-contract.test.js
for file in js/*.js; do node --check "$file" || exit 1; done
git diff --check
```

Expected: accurate labels and zero rendering pass; approval emits no unused
body.

- [ ] **Step 5: Commit**

```bash
git add audit-logs.html moderatordashboard.html messages.html \
  mybusinesses.html createportfolio.html js/api.js js/moderatordashboard.js \
  backend/test/api-client.test.js \
  backend/test/admin-dashboard-client.test.js \
  backend/test/frontend-flow-contract.test.js
git commit -m "fix: align database-backed UI semantics"
```

---

## Task 13: Separate Browse workspace state from retryable recommendations

**Files:**

- Modify: `browse.html`
- Modify: `js/browse.js`
- Modify: `backend/test/browse-client.test.js`

**Interfaces:**

```text
let recommendationState; // 'loading' | 'ready' | 'fallback'
let recommendationRequestVersion;
let recommendationLoadPromise;
function loadRecommendations({ supersede = false } = {});
function retryRecommendations();
function rankingScore(portfolio);
function setRecommendationStatus(message, type, retryable);
function syncRankingUi();
```

The workspace snapshot remains:

```js
Promise.all([API.getAllPortfolios(), API.getMyInterests()])
```

Recommendations are a separate optional request.

- [ ] **Step 1: Expand the browser harness**

Model both independent live regions:

```html
<div id="browse-status"></div>
<div id="recommendation-status"></div>
```

Add deferred-promise support, button click dispatch, class/hidden state, and
card lookup without weakening existing interest-mutation tests.

- [ ] **Step 2: Add failing state-machine tests**

Require:

```text
deferred recommendations do not delay a successful workspace render
workspace failure and recommendation failure render in separate regions
workspace failure remains recoverable through the existing snapshot Retry,
  which refetches portfolios and interests together
recommendation failure keeps successful workspace cards visible
fallback sort and card label use normalized readiness and say Readiness Score
AI Ranked / AI Score appear only after recommendation success
Retry calls only API.getRecommendations
Retry never refetches portfolios/interests and never sends a mutation
double-click Retry is single-flight
an explicit superseding load may start while an older load is pending
failure after prior success clears stale AI scores
successful Retry clears warning and restores AI scores, label, and ordering
stale/out-of-order results cannot overwrite a newer request version
interest reconciliation errors cannot overwrite recommendation status
recommendation errors cannot overwrite interest/workspace status
```

- [ ] **Step 3: Run RED**

```bash
node --test backend/test/browse-client.test.js
```

Expected: recommendation errors are currently silent and readiness is still
labelled as AI.

- [ ] **Step 4: Implement the independent recommendation boundary**

Add a dedicated warning/status region and style it independently:

```html
<div id="recommendation-status"
     role="status"
     aria-live="polite"
     hidden></div>
```

Initial/loading/fallback UI must say `Readiness Score`; only a committed
recommendation success may switch it to `AI Ranked`/`AI Score`.

Use single-flight Retry plus an explicit superseding path:

```js
async function loadRecommendations({ supersede = false } = {}) {
  if (recommendationLoadPromise && !supersede) return recommendationLoadPromise;
  const version = ++recommendationRequestVersion;
  recommendationState = 'loading';
  syncRankingUi();
  applyFilters();

  const request = (async () => {
    try {
      const rows = await API.getRecommendations();
      if (version !== recommendationRequestVersion) return false;
      aiScores = Object.fromEntries(rows.map((row) => [Number(row.id), Number(row.ai_score)]));
      recommendationState = 'ready';
      setRecommendationStatus();
      syncRankingUi();
      applyFilters();
      return true;
    } catch (error) {
      if (version !== recommendationRequestVersion) return false;
      aiScores = {};
      recommendationState = 'fallback';
      setRecommendationStatus(
        `Recommendations are unavailable: ${error.message}`,
        'warning',
        true,
      );
      syncRankingUi();
      applyFilters();
      return false;
    } finally {
      if (version === recommendationRequestVersion) recommendationLoadPromise = null;
    }
  })();
  recommendationLoadPromise = request;
  return request;
}

function retryRecommendations() {
  return loadRecommendations();
}
```

The Retry click path must never pass `supersede: true`, so repeated Retry
clicks share one promise. Use `loadRecommendations({ supersede: true })` only
for an explicit reinitialization/refresh path and in the stale-response test:
start request A, supersede it with request B, resolve B, then resolve A and
prove A cannot overwrite B.

Launch workspace and recommendation loads concurrently, but await/commit the
workspace independently. A workspace is committed only when both portfolios
and interests succeed. On workspace failure, mark its data stale and offer the
existing snapshot Retry; never commit one half of the failed workspace.

- [ ] **Step 5: Run GREEN verification**

```bash
node --test backend/test/browse-client.test.js
node --check js/browse.js
git diff --check
```

Expected: all workspace, fallback, Retry, single-flight, and stale-response
cases pass.

- [ ] **Step 6: Commit**

```bash
git add browse.html js/browse.js backend/test/browse-client.test.js
git commit -m "feat: keep Browse usable without recommendations"
```

---

## Task 14: Preserve selected portfolios through investor deep links

**Files:**

- Modify: `js/investordashboard.js`
- Modify: `js/browse.js`
- Modify: `browse.html`
- Modify: `backend/test/investor-pages-client.test.js`
- Modify: `backend/test/browse-client.test.js`

**Interfaces:**

```text
function browsePortfolioHref(id);
function normalizeRequestedPortfolioId(rawValue);
function focusRequestedPortfolio();
```

- [ ] **Step 1: Add failing dashboard-link tests**

Require both recommended and recently added portfolio cards to navigate to:

```text
browse.html?portfolioId=<positive-id>
```

Do not change managed-conversation links.

- [ ] **Step 2: Add failing Browse authorization-boundary tests**

Accept only positive safe whole-number IDs. For a matching portfolio already
returned by the authorized `getAllPortfolios()` response, require one highlight
and one `scrollIntoView({ block: 'center', behavior: 'smooth' })`.

For missing, malformed, zero, negative, fractional, unsafe, or unauthorized
IDs, require:

```text
no API.getPortfolio detail request
no highlight
no scroll
no redirect
no fallback portfolio selection
```

- [ ] **Step 3: Run RED**

```bash
node --test \
  backend/test/browse-client.test.js \
  backend/test/investor-pages-client.test.js
```

Expected: dashboard links currently discard the selected ID and Browse does
not focus it.

- [ ] **Step 4: Implement selection only against authorized list data**

Normalize with:

```js
function normalizeRequestedPortfolioId(rawValue) {
  if (!/^[1-9]\d*$/.test(String(rawValue || ''))) return null;
  const id = Number(rawValue);
  return Number.isSafeInteger(id) ? id : null;
}
```

Read `portfolioId` once from `window.location.search`, render all normal
workspace cards, and focus only if:

```js
allPortfolios.some((portfolio) => Number(portfolio.id) === requestedPortfolioId)
```

Add a visible `.startup-card--requested` focus/highlight style. Track whether
the initial scroll has happened so re-renders do not repeatedly move the page.

- [ ] **Step 5: Run GREEN verification**

```bash
node --test \
  backend/test/browse-client.test.js \
  backend/test/investor-pages-client.test.js
node --check js/browse.js
node --check js/investordashboard.js
git diff --check
```

Expected: valid returned IDs focus once; every invalid/unauthorized case is a
silent no-op.

- [ ] **Step 6: Commit**

```bash
git add browse.html js/browse.js js/investordashboard.js \
  backend/test/browse-client.test.js \
  backend/test/investor-pages-client.test.js
git commit -m "feat: preserve selected portfolio deep links"
```

---

## Task 15: Synchronize frontend release keys and pin Tabler Icons

Use release key `20260723.5` exactly once, after every shared-client change is
complete.

**Files:**

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
- Modify: `index.html`
- Modify: `signin.html`
- Modify: `signup.html`
- Modify: `js/messages.js`
- Modify: `backend/test/frontend-flow-contract.test.js`
- Modify: `backend/test/managed-messages-client.test.js`

- [ ] **Step 1: Replace brittle version tests with one failing coherence test**

For every HTML consumer of changed `js/api.js` or changed `js/script.js`,
require every local CSS and external page-script URL on that page to use:

```text
?v=20260723.5
```

The exact changed-shared-client pages are:

```text
audit-logs.html
browse.html
businessownerdashboard.html
createportfolio.html
investordashboard.html
messages.html
moderatordashboard.html
my-interests.html
mybusinesses.html
relationshipmanagerdashboard.html
index.html
signin.html
signup.html
```

Require `MESSAGES_API_SCRIPT_SRC` in `js/messages.js` to be:

```js
const MESSAGES_API_SCRIPT_SRC = 'js/api.js?v=20260723.5';
```

Require every deployed page containing Tabler markup to load exactly:

```text
https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.0.0/dist/tabler-icons.min.css
```

Reject every `@latest` reference and the incorrect shortened Tabler path.

- [ ] **Step 2: Run RED**

```bash
node --test \
  backend/test/frontend-flow-contract.test.js \
  backend/test/managed-messages-client.test.js
```

Expected: mixed unversioned, `.2`, `.3`, `.4`, and floating Tabler references
fail.

- [ ] **Step 3: Apply one coherent key and exact Tabler pin**

Update all local asset URLs named by the test, even if a particular asset's
content did not change, so a fetched page cannot combine old shared API code
with new page code.

`index.html`, `signin.html`, and `signup.html` all consume the changed
`js/script.js`, so they must receive the same key even though only the two auth
pages changed account markup.

- [ ] **Step 4: Run GREEN verification**

```bash
node --test \
  backend/test/frontend-flow-contract.test.js \
  backend/test/managed-messages-client.test.js
for file in js/*.js; do node --check "$file" || exit 1; done
git diff --check
```

Expected: all changed shared-asset consumers use `20260723.5`; no deployed HTML
contains `@latest`.

- [ ] **Step 5: Commit**

```bash
git add audit-logs.html browse.html businessownerdashboard.html \
  createportfolio.html investordashboard.html messages.html \
  moderatordashboard.html my-interests.html mybusinesses.html \
  relationshipmanagerdashboard.html index.html signin.html signup.html \
  js/messages.js \
  backend/test/frontend-flow-contract.test.js \
  backend/test/managed-messages-client.test.js
git commit -m "chore: synchronize frontend alignment assets"
```

---

## Task 16: Run complete local and read-only production verification

**Files:**

- Verify only; do not modify production files unless a failing test exposes a
  scoped defect.

- [ ] **Step 1: Run focused contract and boundary gates**

```bash
node --test \
  backend/test/schema-contract.test.js \
  backend/test/managed-chat-schema.test.js \
  backend/test/database-boundaries.test.js \
  backend/test/auth-request-boundaries.test.js \
  backend/test/portfolio-request-boundaries.test.js \
  backend/test/documents-security.test.js \
  backend/test/recommendations-readiness.test.js \
  backend/test/messages-server.test.js \
  backend/test/messages-deployment-files.test.js
```

Expected: exit 0 and zero failed tests.

- [ ] **Step 2: Run focused browser gates**

```bash
node --test \
  backend/test/api-client.test.js \
  backend/test/auth-client-boundaries.test.js \
  backend/test/createportfolio-client.test.js \
  backend/test/browse-client.test.js \
  backend/test/investor-pages-client.test.js \
  backend/test/mybusinesses-client.test.js \
  backend/test/admin-dashboard-client.test.js \
  backend/test/frontend-flow-contract.test.js \
  backend/test/managed-messages-client.test.js
```

Expected: exit 0 and zero failed tests.

- [ ] **Step 3: Run the entire backend suite and syntax checks**

```bash
set -e
npm --prefix backend test
for file in js/*.js; do node --check "$file" || exit 1; done
while IFS= read -r -d '' file; do
  node --check "$file" || exit 1
done < <(find backend/src backend/scripts -name '*.js' -print0)
git diff --check
```

Expected: the full suite passes; every syntax and diff check is silent.

- [ ] **Step 4: Prove the new verifier accepts production metadata read-only**

Use environment variables already configured outside Git. Do not paste
credentials into the command or shell history. Run this from `backend/`:

```bash
node <<'NODE'
require('dotenv').config();
const mysql = require('mysql2/promise');
const { openSshTunnel } = require('./server');
const { verifySchema } = require('./src/schema-contract');

(async () => {
  let tunnel;
  let connection;
  try {
    tunnel = await openSshTunnel(process.env);
    connection = await mysql.createConnection({
      host: process.env.DB_HOST || '127.0.0.1',
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
    });
    await verifySchema(connection);
    console.log('production schema contract: ready');
  } finally {
    if (connection) await connection.end();
    if (tunnel) await tunnel.close();
  }
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
NODE
```

Expected:

```text
production schema contract: ready
```

This command issues only `information_schema` SELECTs.

- [ ] **Step 5: Confirm current public health/readiness without mutation**

```bash
curl --fail --silent --show-error \
  http://35.212.144.149/api/health
curl --fail --silent --show-error \
  http://35.212.144.149/api/ready
```

Expected JSON:

```json
{"status":"ok"}
{"status":"ready"}
```

Do not run `npm run smoke:live`; that script creates and deletes test rows and
is outside this project's read-only production boundary.

- [ ] **Step 6: Rerun the credential-injected read-only four-role GET sweep**

Use the four account emails/passwords supplied out-of-band. Login requests are
authentication reads; after login, issue GET requests only. Cover the same
audited route matrix:

```text
shared: /auth/me, /notifications, /notifications/unread-count,
        /messages/me, /messages/conversations
business owner: /dashboard/business-owner, /portfolios/my, /interests/received
investor: /dashboard/investor, /portfolios, /interests/my, /recommendations
relationship manager: /relationship-manager/dashboard
admin: /dashboard/admin, /admin/queue, /admin/audit-logs,
       /admin/stats, /admin/users, /admin/relationship-managers, /portfolios
dynamic authorized reads: all returned portfolio details and all returned
                          conversation threads
```

Export the eight credential variables without echoing them, then run:

```bash
LUMILABS_E2E_ORIGIN=http://35.212.144.149 node <<'NODE'
const assert = require('node:assert/strict');

const origin = String(process.env.LUMILABS_E2E_ORIGIN || '').replace(/\/$/, '');
assert.equal(origin, 'http://35.212.144.149');

const credentials = {
  admin: {
    email: process.env.LUMILABS_ADMIN_EMAIL,
    password: process.env.LUMILABS_ADMIN_PASSWORD,
  },
  business_owner: {
    email: process.env.LUMILABS_OWNER_EMAIL,
    password: process.env.LUMILABS_OWNER_PASSWORD,
  },
  investor: {
    email: process.env.LUMILABS_INVESTOR_EMAIL,
    password: process.env.LUMILABS_INVESTOR_PASSWORD,
  },
  relationship_manager: {
    email: process.env.LUMILABS_MANAGER_EMAIL,
    password: process.env.LUMILABS_MANAGER_PASSWORD,
  },
};

for (const [role, value] of Object.entries(credentials)) {
  assert.ok(value.email && value.password, `${role} credentials are required`);
}

async function requestJson(path, { token, method = 'GET', body } = {}) {
  assert.ok(method === 'GET' || (method === 'POST' && path === '/auth/login'));
  const response = await fetch(`${origin}/api${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  assert.ok(response.ok, `${method} ${path}: ${response.status} ${text}`);
  assert.match(response.headers.get('content-type') || '', /application\/json/i);
  return JSON.parse(text);
}

async function login(value) {
  const payload = await requestJson('/auth/login', {
    method: 'POST',
    body: value,
  });
  assert.ok(payload.token);
  return payload.token;
}

(async () => {
  const tokens = Object.fromEntries(await Promise.all(
    Object.entries(credentials).map(async ([role, value]) => [role, await login(value)]),
  ));

  const shared = [
    '/auth/me',
    '/notifications',
    '/notifications/unread-count',
    '/messages/me',
    '/messages/conversations',
  ];
  const roleRoutes = {
    business_owner: [
      '/dashboard/business-owner',
      '/portfolios/my',
      '/interests/received',
    ],
    investor: [
      '/dashboard/investor',
      '/portfolios',
      '/interests/my',
      '/recommendations',
    ],
    relationship_manager: [
      '/relationship-manager/dashboard',
    ],
    admin: [
      '/dashboard/admin',
      '/admin/queue',
      '/admin/audit-logs',
      '/admin/stats',
      '/admin/users',
      '/admin/relationship-managers',
      '/portfolios',
    ],
  };

  const payloads = new Map();
  let baseChecks = 0;
  for (const role of Object.keys(credentials)) {
    for (const path of [...shared, ...roleRoutes[role]]) {
      const payload = await requestJson(path, { token: tokens[role] });
      payloads.set(`${role}:${path}`, payload);
      baseChecks += 1;
    }
  }
  assert.equal(baseChecks, 35);

  const portfolioIds = {
    business_owner: new Set(
      payloads.get('business_owner:/portfolios/my').map(({ id }) => Number(id)),
    ),
    investor: new Set(
      payloads.get('investor:/portfolios').map(({ id }) => Number(id)),
    ),
    relationship_manager: new Set(
      payloads.get('relationship_manager:/relationship-manager/dashboard')
        .rooms
        .map(({ portfolio_id: id }) => Number(id))
        .filter((id) => Number.isInteger(id) && id > 0),
    ),
    admin: new Set([
      ...payloads.get('admin:/portfolios').map(({ id }) => Number(id)),
      ...payloads.get('admin:/admin/queue').map(({ id }) => Number(id)),
    ]),
  };

  let detailChecks = 0;
  for (const [role, ids] of Object.entries(portfolioIds)) {
    for (const id of ids) {
      assert.ok(Number.isInteger(id) && id > 0);
      await requestJson(`/portfolios/${id}`, { token: tokens[role] });
      detailChecks += 1;
    }
  }

  let threadChecks = 0;
  for (const role of Object.keys(credentials)) {
    const conversations = payloads.get(`${role}:/messages/conversations`);
    for (const { id: rawId } of conversations) {
      const id = Number(rawId);
      assert.ok(Number.isInteger(id) && id > 0);
      await requestJson(`/messages/conversations/${id}`, { token: tokens[role] });
      threadChecks += 1;
    }
  }

  console.log(
    `read-only GET sweep: ${baseChecks} base, `
      + `${detailChecks} portfolio details, ${threadChecks} threads passed`,
  );
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
NODE
```

Expected: `35 base` and non-negative dynamic detail/thread counts, with exit
code 0. Every response must be successful JSON. The command sends no POST
other than login, no PUT, no DELETE, and no file request.

- [ ] **Step 7: Audit scope and repository state**

```bash
git status --short --branch
git log --oneline --decorate -18
git diff 53642f4..HEAD --check
if rg -n 'TO[D]O|FIX[M]E|PLACE[H]OLDER' \
  backend/schema.sql backend/server.js backend/src \
  backend/scripts/migrate-managed-chat.js js ./*.html; then
  echo "placeholder marker found in deployable source" >&2
  exit 1
fi
if rg -n -e '@latest' -e '20260723\.[234]' js ./*.html; then
  echo "floating dependency or stale release key found" >&2
  exit 1
fi
```

Expected:

- working tree clean;
- only the planned commits follow the plan commit;
- no placeholder markers in changed code;
- no floating Tabler or stale release keys in deployed pages;
- no production MySQL row or table definition changed;
- no Git push and no SFTP deployment occurred.

- [ ] **Step 8: Stop at the release boundary**

Report local verification and read-only production results. Ask separately for
Git push and SFTP deployment authorization. If deployment is later authorized:

1. Upload changed backend runtime files as one staged adjacent set.
2. Atomically replace that set.
3. Restart `lumilabs-backend.service` once.
4. Require `/api/health` and `/api/ready` to return 200.
5. Stage frontend CSS/JavaScript before HTML exposes `20260723.5`.
6. Never deploy or execute `backend/schema.sql`.
7. Never run a migration, seed, or mutating smoke test.
8. Include a one-time hard-refresh instruction because cached HTML cannot be
   evicted by an asset query key.

---

## Acceptance Checklist

- [ ] `backend/schema.sql` matches all audited live declaration differences.
- [ ] The independent metadata fixture is literal and not derived from
  production contract constants.
- [ ] `/api/ready` verifies all nine tables, exact critical columns/enums,
  generated cursor/singleton behavior, engines/collations, uniqueness, access
  indexes, and all 16 FK structures/rules.
- [ ] Managed-chat migration rejects malformed preserved metadata before its
  first destructive statement.
- [ ] Account, portfolio, JSON, and document filename boundaries return 400/413
  before the disallowed query, transaction, or file write.
- [ ] Signup/signin inputs mirror the account-column limits and stop overlong
  values before `fetch`.
- [ ] Create Portfolio and Browse share the approved sector list and preserve
  all observed production sector casing.
- [ ] Nullable/malformed readiness is numeric zero everywhere it is calculated,
  sorted, compared, or rendered.
- [ ] Audit, manager, match, search, upload, and team-zero UI semantics are
  accurate.
- [ ] Recommendation failure is visible, retryable, readiness-labelled, and
  independent of the Browse workspace.
- [ ] Investor deep links focus only portfolios already returned by the
  authorized API.
- [ ] Dead owner-subpage badges and the unused approval-notes client contract
  are gone.
- [ ] All changed shared assets use `20260723.5`; all Tabler links are pinned to
  `3.0.0`.
- [ ] Full local tests, syntax checks, read-only production schema verification,
  `/api/ready`, and the read-only role sweep pass.
- [ ] No production DB mutation, Git push, or SFTP deployment occurs without
  new explicit authorization.
