# Strict User Role Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `users.role` accept exactly four explicitly supplied roles, remove `superadmin`, remove the database default, and restore production readiness.

**Architecture:** The complete schema contract and production fixture remain strict: they accept only the four approved enum values and a missing default. The managed-chat preserved-core preflight intentionally validates three allowed migration enum shapes independently from two safe defaults (`business_owner` and no default), accepting their six-combination cross-product. That migration-only matrix explicitly includes the audited tuple `ENUM('business_owner','investor','relationship_manager','admin','superadmin') NOT NULL` with `COLUMN_DEFAULT = NULL`. After read-only metadata and stored-value checks, the migration locks `users`, converts the legacy stored value to `admin`, verifies the conversion count and final stored roles, and narrows to the strict final form before any chat mutation.

**Tech Stack:** Node.js CommonJS, Node test runner, MySQL 8, Express readiness endpoint, systemd, SSH/SFTP

## Global Constraints

- The only roles are `business_owner`, `investor`, `relationship_manager`, and `admin`.
- `superadmin` is not a separate role; any stored `superadmin` value becomes `admin`.
- `users.role` is `NOT NULL` with no default, so every insert must explicitly supply a role.
- Existing `admin` accounts and administrator behavior remain unchanged.
- Do not change messages, portfolios, interests, notifications, unrelated frontend files, passwords, or seeds.
- Do not print database credentials, password hashes, access tokens, or user emails.
- Stop before `ALTER TABLE` if production contains any role outside the approved four roles plus the convertible `superadmin` value.

---

### Task 1: Make the runtime schema contract require an explicit role

**Files:**
- Modify: `backend/test/fixtures/production-schema-metadata.json:18`
- Modify: `backend/test/schema-contract.test.js:128-170`
- Modify: `backend/test/schema-contract.test.js:380-435`
- Modify: `backend/src/schema-contract.js:22-32`
- Modify: `backend/src/schema-contract.js:577-635`
- Modify: `backend/src/schema-contract.js:770-785`

**Interfaces:**
- Consumes: MySQL `information_schema.columns.COLUMN_DEFAULT` metadata, where `null` means no declared default.
- Produces: `verifySchema(database)` that requires the final four-role enum with no default, and `verifyPreservedCoreSchema(database)` that independently accepts three documented migration enum shapes and two safe defaults, for six allowed pre-migration combinations.

- [ ] **Step 1: Change the independent production fixture to the approved final metadata**

In `backend/test/fixtures/production-schema-metadata.json`, change only the
`users.role` row to:

```json
{ "table_name": "users", "column_name": "role", "ordinal_position": 5, "column_type": "enum('business_owner','investor','relationship_manager','admin')", "is_nullable": "NO", "column_default": null, "extra": "", "generation_expression": "" }
```

- [ ] **Step 2: Add strict final-default and preserved-preflight tests**

In `backend/test/schema-contract.test.js`, add this assertion to
`rejects wrong column type, nullability, default, and physical order`:

```js
  await expectInvariant((metadata) => {
    row(metadata, 'users', 'role').column_default = 'business_owner';
  }, /users\.role default must be NULL/);
```

Make `legacyManagedChatMetadata()` reproduce the historical default:

```js
  row(metadata, 'users', 'role').column_type =
    "enum('business_owner','investor','admin')";
  row(metadata, 'users', 'role').column_default = 'business_owner';
```

Replace the pair-oriented preserved-core acceptance test with a matrix test
that covers every independently allowed enum-shape/default combination:

```js
test('preserved-core verifier accepts all six role type/default combinations', async (t) => {
  const allowedTypes = [
    [
      'historical three-role enum',
      "enum('business_owner','investor','admin')",
    ],
    [
      'final four-role enum',
      "enum('business_owner','investor','relationship_manager','admin')",
    ],
    [
      'audited five-role enum',
      "enum('business_owner','investor','relationship_manager','admin','superadmin')",
    ],
  ];
  const allowedDefaults = [
    ["DEFAULT 'business_owner'", 'business_owner'],
    ['COLUMN_DEFAULT = NULL', null],
  ];

  assert.equal(allowedTypes.length * allowedDefaults.length, 6);
  for (const [typeLabel, columnType] of allowedTypes) {
    for (const [defaultLabel, columnDefault] of allowedDefaults) {
      await t.test(`${typeLabel} with ${defaultLabel}`, async () => {
        const metadata = legacyManagedChatMetadata();
        row(metadata, 'users', 'role').column_type = columnType;
        row(metadata, 'users', 'role').column_default = columnDefault;
        assert.equal(await verifyPreservedMetadata(metadata), true);
      });
    }
  }
});
```

The named subtests must retain explicit coverage of the audited five-role enum
with `COLUMN_DEFAULT = NULL`. The acceptance matrix is migration-only; it must
not loosen `verifySchema`.

Add a rejection test after it:

```js
test('preserved-core verifier rejects an unknown role default', async () => {
  const metadata = legacyManagedChatMetadata();
  row(metadata, 'users', 'role').column_default = 'investor';

  await assert.rejects(
    verifyPreservedMetadata(metadata),
    /users\.role must use an allowed migration default/,
  );
});
```

- [ ] **Step 3: Run the focused test and confirm the red state**

Run:

```bash
node --test backend/test/schema-contract.test.js
```

Expected: failure because the current complete contract still expects
`business_owner`, and the preserved-core verifier has no allowed-default
exception.

- [ ] **Step 4: Change the strict contract and add a preserved-only default exception**

In `backend/src/schema-contract.js`, change the final `users.role` definition
to:

```js
    [
      'role',
      "enum('business_owner','investor','relationship_manager','admin')",
      'NO',
      null,
    ],
```

Extend `appendColumnIssues` options:

```js
  {
    checkOrdinal = () => true,
    allowedTypes = new Map(),
    allowedDefaults = new Map(),
  } = {},
```

Replace the unconditional default comparison with:

```js
      const actualDefault = normalizeDefault(
        property(actual, 'column_default'),
      );
      const acceptedDefaults = allowedDefaults.get(field);
      if (acceptedDefaults) {
        if (!acceptedDefaults.some((
          defaultValue,
        ) => actualDefault === normalizeDefault(defaultValue))) {
          issues.push(`${field} must use an allowed migration default`);
        }
      } else if (actualDefault !== normalizeDefault(expected.defaultValue)) {
        issues.push(columnIssueLabel(
          field,
          'default',
          expected.defaultValue === null ? 'NULL' : expected.defaultValue,
        ));
      }
```

Pass the preserved-only exception from `verifyPreservedCoreSchema`:

```js
    allowedDefaults: new Map([
      ['users.role', [null, 'business_owner']],
    ]),
```

Do not pass `allowedDefaults` from `verifySchema`; the complete readiness
contract must remain strict.

- [ ] **Step 5: Run the focused schema-contract test**

Run:

```bash
node --test backend/test/schema-contract.test.js
```

Expected: all schema-contract tests pass.

- [ ] **Step 6: Commit the runtime-contract change**

Run:

```bash
git add backend/src/schema-contract.js \
  backend/test/schema-contract.test.js \
  backend/test/fixtures/production-schema-metadata.json
git diff --cached --check
git commit -m "fix(schema): require explicit user roles"
```

Expected: one commit containing only the three listed files.

---

### Task 2: Align canonical and migration DDL with the strict role rule

**Files:**
- Modify: `backend/test/managed-chat-schema.test.js`
- Modify: `backend/test/schema-contract.test.js`
- Modify: `backend/schema.sql:13`
- Modify: `backend/scripts/migrate-managed-chat.js:319-322`
- Modify: `backend/src/schema-contract.js`
- Modify: `docs/superpowers/plans/2026-07-25-strict-user-role-schema.md`

**Interfaces:**
- Consumes: the strict final metadata contract from Task 1.
- Produces: canonical and post-migration DDL for `ENUM('business_owner','investor','relationship_manager','admin') NOT NULL` with no default, after converting only stored `superadmin` values to `admin`.

- [ ] **Step 1: Add source-level regression assertions**

In `schema source reproduces audited live column declarations and portfolio
order`, add:

```js
  assert.match(
    users,
    /role ENUM\('business_owner','investor','relationship_manager','admin'\) NOT NULL,/,
  );
  assert.doesNotMatch(
    users,
    /role ENUM\('business_owner','investor','relationship_manager','admin'\)[^,\n]*DEFAULT/,
  );
  assert.doesNotMatch(users, /superadmin/);
```

Add a focused migration-source test:

```js
test('managed chat migration leaves users with four explicit roles', () => {
  const source = fs.readFileSync(migrationPath, 'utf8');
  assert.match(
    source,
    /MODIFY role ENUM\('business_owner','investor','relationship_manager','admin'\)\s+NOT NULL/,
  );
  assert.doesNotMatch(
    source,
    /MODIFY role[\s\S]*?NOT NULL DEFAULT 'business_owner'/,
  );
  assert.match(
    source,
    /UPDATE users SET role='admin' WHERE role='superadmin'/,
  );
});
```

- [ ] **Step 2: Run the schema-source test and confirm the red state**

Run:

```bash
node --test backend/test/managed-chat-schema.test.js
```

Expected: failures because both `backend/schema.sql` and the migration still
declare `DEFAULT 'business_owner'`.

- [ ] **Step 3: Remove the role default from both DDL sources**

Change `backend/schema.sql` to:

```sql
  role ENUM('business_owner','investor','relationship_manager','admin') NOT NULL,
```

Change the managed-chat migration statement to:

```js
  await database.query(
    `ALTER TABLE users
       MODIFY role ENUM('business_owner','investor','relationship_manager','admin')
       NOT NULL`,
  );
```

Extend the preserved-core migration enum allowlist, but not the complete
runtime contract, with exactly:

```js
"enum('business_owner','investor','relationship_manager','admin','superadmin')"
```

Allow stored `superadmin` only during the migration preflight, reject every
other unknown stored role before any mutation, and model the audited
five-role tuple with `column_default = null` explicitly even though preserved
metadata validation accepts the full migration-only type/default
cross-product. After all read-only preflight checks, acquire
`LOCK TABLES users WRITE`, count convertible rows, execute:

```js
await database.query("UPDATE users SET role='admin' WHERE role='superadmin'");
```

Require `affectedRows` to equal the locked count, re-query stored roles, and
reject `superadmin`, empty, null, or any unknown value. Run the final
four-role `ALTER TABLE users ... MODIFY role`, then issue `UNLOCK TABLES` in a
`finally` block. Only after that gate succeeds may notification deletion,
foreign-key removal, or chat-table drops begin. The complete verifier and
production metadata fixture must continue to reject the five-value enum.

- [ ] **Step 4: Run focused and full automated verification**

Run:

```bash
node --test backend/test/managed-chat-schema.test.js
node --test backend/test/schema-contract.test.js
npm --prefix backend test
git diff --check
```

Expected: all focused tests and the complete backend suite pass with zero
failures; the diff check prints nothing.

- [ ] **Step 5: Verify production inserts still specify roles**

Run:

```bash
rg -n "INSERT INTO users" backend/src backend/scripts
rg -n "superadmin" backend --glob '!node_modules/**'
```

Expected:

- public registration inserts its validated `role`;
- administrator provisioning inserts `relationship_manager`;
- the controlled smoke setup inserts `admin`;
- no canonical schema, route, service, complete runtime contract, or
  production metadata fixture authorizes `superadmin`; and
- the reusable migration mentions `superadmin` only in an allowed
  migration-enum shape and to convert it to `admin` before narrowing the enum.

- [ ] **Step 6: Commit canonical and migration DDL**

Run:

```bash
git add backend/schema.sql \
  backend/scripts/migrate-managed-chat.js \
  backend/src/schema-contract.js \
  backend/test/managed-chat-schema.test.js \
  backend/test/schema-contract.test.js \
  docs/superpowers/plans/2026-07-25-strict-user-role-schema.md
git diff --cached --check
git commit -m "fix(schema): convert legacy superadmin roles"
```

Expected: one follow-up commit containing the migration conversion, its strict
preflight exception, regression coverage, and this amended plan.

---

### Task 3: Deploy and migrate the production role column safely

**Files:**
- Deploy: `backend/src/schema-contract.js`
- Production schema mutation: `lumi5_labs.users.role`
- Preserve: `/var/www/lumilabs-backend/.env`
- Preserve: `/var/www/lumilabs-backend/node_modules`
- Preserve: `/var/www/lumilabs-backend/uploads`

**Interfaces:**
- Consumes: the verified Task 1 runtime contract, the Task 2 DDL rule, and the existing protected backend environment.
- Produces: a live four-role/no-default column and HTTP `200 {"status":"ready"}`.

- [ ] **Step 1: Confirm repository and deployment scope**

Run:

```bash
git status --short --branch
git log --oneline -3
git diff origin/main...HEAD --name-only
```

Expected: the working tree is clean; changes are limited to the approved
design, plan, schema contract, schema fixture/tests, canonical schema,
managed-chat migration, and its test.

- [ ] **Step 2: Capture non-sensitive live pre-change evidence**

Over the existing authenticated SSH connection, run a Node process from
`/var/www/lumilabs-backend` that loads `.env` and queries only:

```sql
SHOW CREATE TABLE users;
SELECT role, COUNT(*) AS account_count
FROM users
GROUP BY role
ORDER BY role;
```

Store `SHOW CREATE TABLE users` in a permission-restricted evidence file under
`/home/user/lumilabs-role-schema-backup-20260725/`. This capture is forensic
evidence of the pre-change shape, not an executable restore statement for an
existing table. Print only aggregate role counts, never rows, emails, hashes,
or environment values.

Expected starting metadata:

```text
enum('business_owner','investor','relationship_manager','admin','superadmin')
NOT NULL
no explicit default
```

Expected starting data: zero or more `superadmin` rows and at least one
existing `admin` row. The final pre-migration preflight observed one
`superadmin` row, which the user explicitly authorized converting to
`admin`. Stop only if the metadata differs or a stored role falls outside
the four approved roles plus `superadmin`.

- [ ] **Step 3: Stage and checksum the runtime contract**

Create `/home/user/lumilabs-role-schema-stage-20260725/backend/src/` and upload
only:

```text
backend/src/schema-contract.js
```

Compare local, staged, and current-live SHA-256 hashes. Do not overwrite
`.env`, dependencies, uploads, or any frontend file.

- [ ] **Step 4: Convert the retired value and narrow the enum**

Using the backend's existing MySQL pool in one controlled Node process:

```js
const allowedBefore = new Set([
  'business_owner',
  'investor',
  'relationship_manager',
  'admin',
  'superadmin',
]);

const [before] = await database.query(
  'SELECT role, COUNT(*) AS account_count FROM users GROUP BY role ORDER BY role',
);
if (before.some(({ role }) => !allowedBefore.has(role))) {
  throw new Error('Unexpected production user role; refusing schema change');
}

await database.query('LOCK TABLES users WRITE');
try {
  const [[{ account_count: expectedConversions }]] = await database.query(
    "SELECT COUNT(*) AS account_count FROM users WHERE role='superadmin'",
  );
  const [conversion] = await database.query(
    "UPDATE users SET role='admin' WHERE role='superadmin'",
  );
  if (Number(conversion.affectedRows) !== Number(expectedConversions)) {
    throw new Error('Legacy role conversion count mismatch');
  }

  const [finalRoles] = await database.query(
    'SELECT DISTINCT role FROM users',
  );
  const allowedAfter = new Set([
    'business_owner',
    'investor',
    'relationship_manager',
    'admin',
  ]);
  if (finalRoles.some(({ role }) => !allowedAfter.has(role))) {
    throw new Error('Unsupported role remains after legacy conversion');
  }

  await database.query(
    `ALTER TABLE users
       MODIFY role ENUM(
         'business_owner',
         'investor',
         'relationship_manager',
         'admin'
       ) NOT NULL`,
  );
} finally {
  // ALTER TABLE may release the lock; this remains harmless cleanup.
  await database.query('UNLOCK TABLES');
}
```

Immediately query `information_schema.columns` and aggregate role counts
again. Require:

```text
COLUMN_TYPE = enum('business_owner','investor','relationship_manager','admin')
IS_NULLABLE = NO
COLUMN_DEFAULT = null
unsupported role count = 0
admin count after = admin count before + superadmin count before
total account count unchanged
```

If the `ALTER` fails, stop before deploying the new runtime contract. The
captured `SHOW CREATE TABLE users` is not directly executable restoration.
Use this exact compatibility rollback sequence instead:

1. restore the database shape expected by the pre-change runtime contract:

   ```sql
   ALTER TABLE users
     MODIFY role ENUM(
       'business_owner',
       'investor',
       'relationship_manager',
       'admin'
     ) NOT NULL DEFAULT 'business_owner';
   ```

2. restore
   `/home/user/lumilabs-role-schema-backup-20260725/schema-contract.js.pre-task3`
   to `/var/www/lumilabs-backend/src/schema-contract.js`;
3. restart only `lumilabs-backend.service`; and
4. verify `systemctl is-active lumilabs-backend.service`, then require HTTP
   `200` from both `/api/health` and `/api/ready` on loopback and the public
   origin.

This compatibility rollback is documented but was not rehearsed in
production. The `superadmin` to `admin` conversion is intentionally
permanent. Because no account-identity mapping was retained, full semantic
reversal to the former role values is unsupported. Do not modify another
table.

- [ ] **Step 5: Install the staged contract and restart only the backend**

Back up the current live `schema-contract.js` inside the rollback directory,
install the checksum-verified staged file at:

```text
/var/www/lumilabs-backend/src/schema-contract.js
```

Preserve ownership and mode, then restart only
`lumilabs-backend.service`.

- [ ] **Step 6: Verify service, database, and public readiness**

Run:

```bash
systemctl is-active lumilabs-backend.service
curl -fsS http://127.0.0.1:3100/api/health
curl -fsS http://127.0.0.1:3100/api/ready
curl -fsS http://35.212.144.149/api/health
curl -fsS http://35.212.144.149/api/ready
```

Expected:

```text
active
{"status":"ok"}
{"status":"ready"}
{"status":"ok"}
{"status":"ready"}
```

Re-query role metadata and aggregate counts after the restart. Require the
same four-role/no-default result from Step 4.

- [ ] **Step 7: Perform read-only authentication checks for all four roles**

Using the previously supplied test credentials only in process memory, log in
through `/api/auth/login`, assert the returned role, then call:

```text
business_owner       GET /api/dashboard/business-owner
investor             GET /api/dashboard/investor
relationship_manager GET /api/relationship-manager/dashboard
admin                GET /api/dashboard/admin
```

Expected: every login returns its exact approved role and every matching
dashboard request returns HTTP `200`. Do not persist tokens, send messages, or
mutate portfolio, interest, room, notification, or account data.

- [ ] **Step 8: Run the final local release gate**

Run:

```bash
npm --prefix backend test
git status --short --branch
git diff --check
```

Expected: the complete suite passes with zero failures, the working tree is
clean, and local commits remain ahead of `origin/main` until the user
separately authorizes a Git push.
