# Strict User Role Schema Design

**Date:** 2026-07-25
**Status:** Approved
**Scope:** Align the repository and production `users.role` column with the
approved four-role policy

## Context

Production readiness currently returns HTTP `503` because the live
`users.role` metadata and the repository schema contract disagree.

The live column allows:

```sql
ENUM(
  'business_owner',
  'investor',
  'relationship_manager',
  'admin',
  'superadmin'
) NOT NULL
```

It has no explicit default. The repository instead requires the same enum
without `superadmin`, but incorrectly requires
`DEFAULT 'business_owner'`.

The approved product rule is:

- the only user roles are `business_owner`, `investor`,
  `relationship_manager`, and `admin`;
- `superadmin` is not a separate role and any such value must become `admin`;
- every user-creation path must explicitly supply a role; and
- the database must not silently assign a role when one is omitted.

An earlier production audit found no `superadmin` rows, but the final
pre-migration preflight found one. The user explicitly authorized converting
every stored `superadmin` value to `admin`. Existing supported accounts,
including administrators, must otherwise remain unchanged.

## Goals

1. Make the final production role column exactly:

   ```sql
   ENUM('business_owner','investor','relationship_manager','admin') NOT NULL
   ```

2. Remove the implicit `business_owner` default from every canonical or
   post-migration schema declaration.
3. Treat any existing `superadmin` row as `admin` before narrowing the enum.
4. Keep all existing `admin` accounts and administrator behavior unchanged.
5. Restore HTTP `200 {"status":"ready"}` from `/api/ready`.
6. Change only schema, migration, schema-contract, and directly related test
   or deployment files.

## Non-Goals

- No new role or permission level.
- No change to administrator routes, dashboards, or authorization behavior.
- No public `admin` or `relationship_manager` registration.
- No change to messages, portfolios, interests, notifications, or unrelated
  frontend files.
- No account deletion, password change, seed reset, or unrelated data cleanup.
- No default fallback when application code omits a user role.

## Repository Alignment

The canonical schema, complete runtime contract, production metadata fixture,
and managed-chat migration must all describe the final four-value enum with
no default.

The application already supplies a role in every production insert:

- public registration validates and inserts either `business_owner` or
  `investor`;
- administrator provisioning inserts `relationship_manager`; and
- the controlled four-role smoke setup inserts `admin`.

Tests will require those explicit insert values to remain in place.

The documented preserved-core inputs used before the managed-chat migration
are these three metadata states:

- the historical three-role enum with `DEFAULT 'business_owner'`;
- the final four-role enum with no default; and
- the audited, migration-only five-role enum
  `ENUM('business_owner','investor','relationship_manager','admin','superadmin')
  NOT NULL` with `COLUMN_DEFAULT = NULL`.

The five-role tuple is accepted only so the migration can retire
`superadmin`; it is not a valid final contract. The complete post-migration
contract remains strict and accepts only the four-role enum with no default.

An exhaustive repository search will verify that no source, test, fixture,
documentation used as an executable contract, or deployment artifact still
defines or authorizes `superadmin`.

## Production Migration

Before changing the column, the deployment will:

1. capture the current `SHOW CREATE TABLE users` definition and aggregate role
   counts as forensic pre-change evidence without exporting emails or password
   hashes;
2. verify every stored role is one of the four supported values or
   `superadmin`;
3. acquire a `WRITE` lock on `users`, count the stored `superadmin` rows,
   convert them to `admin`, and require the affected-row count to match;
4. re-query stored roles under the lock and verify that zero unsupported,
   `superadmin`, empty, or null values remain; and
5. narrow the enum before releasing the lock in cleanup.

The column will then be narrowed with:

```sql
ALTER TABLE users
  MODIFY role ENUM(
    'business_owner',
    'investor',
    'relationship_manager',
    'admin'
  ) NOT NULL;
```

The migration must abort before `ALTER TABLE` if an unexpected role value is
found. Existing rows with the four supported roles are not rewritten.

The captured `SHOW CREATE TABLE users` output is evidence of the pre-change
state. It is not directly executable restoration for an existing table and
must not be presented as a rollback command.

The executable compatibility rollback is:

1. restore the previous runtime-compatible database shape:

   ```sql
   ALTER TABLE users
     MODIFY role ENUM(
       'business_owner',
       'investor',
       'relationship_manager',
       'admin'
     ) NOT NULL DEFAULT 'business_owner';
   ```

2. restore the backed-up pre-change `schema-contract.js`;
3. restart only the backend service; and
4. require an active service plus successful `/api/health` and `/api/ready`
   checks from loopback and the public origin.

This compatibility rollback has been documented but was not rehearsed in
production. The `superadmin` to `admin` data conversion is intentional and
permanent: no account-identity mapping was retained, so a full semantic
reversal is unsupported. Only the aggregate converted-row count is recorded;
account identities and credentials are not exposed.

## Error Handling and Safety

- Run all metadata and count checks through the production backend
  environment without printing database credentials.
- Do not expose user emails, password hashes, tokens, or environment values.
- Do not run the enum-narrowing `ALTER` until unsupported-value checks pass.
- Keep the existing backend and frontend rollback release intact.
- Stop if the repository is dirty in overlapping files or if production
  metadata differs from the audited starting state.
- Do not alter any table other than `users`.

## Testing and Verification

The implementation follows a red-green test cycle:

1. update or add schema-contract tests that require no final role default and
   fail against the current contract;
2. add coverage that the preserved migration preflight accepts its documented
   historical, final, and audited five-role/no-default tuples while rejecting
   other defaults;
3. update schema-source and migration-source tests to require the four-value
   enum with no `DEFAULT` clause;
4. add route-level coverage that successful public registration passes its
   approved role to an explicit `role` insert and source coverage that the
   controlled smoke insert explicitly supplies `admin`;
5. add a conversion-count mismatch test proving the migration unlocks and
   stops before role narrowing or chat mutation;
6. implement the smallest schema-related changes needed to pass those tests;
7. run the complete backend test suite; and
8. confirm the diff contains only approved files.

Production verification will require:

- `users.role` has exactly the four enum values, is `NOT NULL`, and has no
  default;
- role counts contain no `superadmin` or empty enum values;
- existing `admin` account count is preserved;
- `/api/health` returns HTTP `200`;
- `/api/ready` returns HTTP `200` with `{"status":"ready"}`;
- the backend service remains active; and
- authenticated role checks for the four supported roles remain successful.
