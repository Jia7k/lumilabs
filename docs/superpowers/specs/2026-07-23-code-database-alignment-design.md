# Code-to-Database Alignment Design

**Date:** 2026-07-23  
**Status:** Approved  
**Scope:** Repository-only alignment with the current production MySQL schema

## Context

The production application is operationally database-backed:

- every deployed browser API call resolves to a mounted backend route;
- every production SQL table and column reference exists in MySQL;
- the deployed runtime matches the pushed `main` branch for all 46 allowlisted files;
- the live database has the expected nine base tables;
- the current repository schema verifier passes against production;
- 15 additional relationship, role, room, status, and nullability checks return
  zero live violations;
- a read-only four-role sweep returns valid JSON for all 35 authenticated GET
  endpoints, 13 authorized portfolio details, and three authorized message
  threads.

The audit also found that `backend/schema.sql` is not an exact description of
the live database, `backend/src/schema-contract.js` verifies only part of the
runtime-critical schema, some request validators permit values that MySQL can
reject or truncate, and several UI labels overstate or misidentify the
database-derived value being displayed.

The user selected repository-only alignment. Production MySQL, its rows, and
its table definitions must not be changed by this project.

## Goals

1. Make `backend/schema.sql` accurately describe the current production
   database.
2. Make `/api/ready` verify the database invariants on which current runtime
   workflows rely.
3. Reject user input at the HTTP boundary when it cannot fit the corresponding
   MySQL column.
4. Give browser inputs the same limits and choices as the backend.
5. Correct labels and fallback behavior so the UI accurately describes
   database-backed and computed values.
6. Preserve all current business workflows and production data.
7. Leave a clear boundary for the separately approved notification UI project.

## Non-Goals

- No `ALTER TABLE`, data update, seed, account change, or other MySQL write.
- No change to the current behavior where deleting an editable rejected
  portfolio cascades its linked audit rows. This behavior is accepted and must
  be documented in the schema.
- No notification center, unread-count wiring, or mark-as-read UI in this
  project. That is the next independent project.
- Existing owner-subpage message badges that have no data source will be
  removed rather than left as permanently hidden controls. The later
  notification project may add a new shared, data-backed indicator.
- No audit-log pagination or all-time aggregation. The current latest-100
  behavior will instead be labelled accurately.
- No new relationship-manager activation field.
- No change to readiness-score calculation, recommendation scoring, message
  persistence, managed-conversation membership, or role authorization.
- No unrelated refactor or dependency addition.

## Canonical Schema Direction

Production MySQL is the metadata source for this repository-only alignment.
`backend/schema.sql` will be updated to describe the live definitions rather
than attempting to mutate the live database toward older declarations.

The known declaration differences to reconcile are:

1. `audit_logs.action` is exactly `ENUM('approved','rejected')`.
   `requested_changes` has no runtime writer and is not present in production.
2. `portfolios.readiness_score` is nullable, defaults to `0`, and has no
   database `CHECK` constraint. Application code continues to clamp calculated
   scores to `0..100`.
3. `portfolios.mvp_status` is `NOT NULL` without a database default.
4. `portfolios.funding_goal` is `DECIMAL(15,2) NOT NULL` without a database
   default.
5. `users.created_at` and `users.updated_at` are nullable timestamp columns
   with their current generated defaults and update behavior.
6. `notifications.created_at` is nullable and defaults to
   `CURRENT_TIMESTAMP`.
7. Notification indexes retain the live legacy names `user_id`,
   `related_portfolio_id`, and `related_user_id`; the conversation and message
   index names already match the repository.
8. Notification foreign keys retain the live legacy names
   `notifications_ibfk_1`, `notifications_ibfk_2`, and
   `notifications_ibfk_3` for user, portfolio, and related-user references.
   Conversation and message foreign-key names already match.
9. The `portfolios` declaration uses the live physical column order, where
   readiness/review lifecycle columns precede the later traction, market,
   advisor, and finance columns. Runtime SQL names columns explicitly, but a
   fresh schema should still reproduce current metadata.
10. Every table declaration will explicitly state `ENGINE=InnoDB` and the live
   `utf8mb4_0900_ai_ci` collation so a fresh database cannot silently select a
   non-transactional engine or different text behavior.

The schema will include a comment that the current `audit_logs.portfolio_id`
foreign key deliberately uses `ON DELETE CASCADE`, matching the accepted
portfolio-deletion behavior.

Both the schema-source test and the runtime schema-contract test must name and
require this exact cascade. A future change to `SET NULL`, `RESTRICT`, or
another rule must fail until the product decision and schema are changed
together.

## Runtime Schema Contract

`backend/src/schema-contract.js` will remain the one readiness contract used by
`GET /api/ready`. It will be expanded without becoming a raw schema dump.

It will require:

- all nine current base tables;
- every production column used by runtime code;
- runtime-critical column type, nullability, default, auto-increment, timestamp,
  generated-column, and unsigned properties;
- exact enum values and ordering for:
  - `users.role`;
  - `portfolios.mvp_status`;
  - `portfolios.status`;
  - `conversations.status`;
  - `conversations.archived_reason`;
  - `conversation_members.member_role`;
  - `conversation_members.membership_status`;
  - `notifications.type`;
  - `audit_logs.action`;
- `InnoDB` for every application table;
- primary and unique keys needed by runtime behavior, especially:
  - unique user email;
  - unique investor interest per investor and portfolio;
  - one conversation per non-null portfolio;
  - one membership per user and conversation;
  - one manager and one owner singleton per conversation;
- indexes required by message and notification access patterns;
- every application foreign key, including referenced columns and
  `ON DELETE`/`ON UPDATE` rules;
- the exact functional purpose of `conversation_members.singleton_role`,
  including that it is a stored generated column derived from
  `member_role`;
- non-null zero defaults for membership visibility/read cursors.

Equivalent non-unique index and foreign-key constraint names are accepted when
their columns, order, referenced columns, and rules match. Names in
`schema.sql` still reproduce production for fresh databases. Extra
non-conflicting indexes are accepted. Extra enum values, missing uniqueness,
wrong foreign-key deletion behavior, a non-InnoDB table, or a changed
generated-column expression make readiness return `503`.

Metadata comparison is semantic rather than raw-string comparison:

- numeric defaults such as `0` and `'0'` normalize to the same value;
- `CURRENT_TIMESTAMP` spelling and casing variants normalize;
- `EXTRA` tokens normalize for casing and order;
- generated expressions normalize insignificant whitespace, identifier
  backticks, and redundant outer parentheses;
- foreign keys match by local columns, referenced table and columns, and
  update/delete rules rather than constraint name;
- unique indexes require the exact ordered columns;
- non-unique access indexes may contain additional trailing columns when the
  required ordered columns are a left prefix; and
- invisible indexes do not satisfy the readiness contract.

The metadata queries will add:

- `information_schema.tables` for engine and collation;
- `generation_expression` and defaults in
  `information_schema.columns`;
- `information_schema.referential_constraints` for update/delete rules.

Tests will use complete metadata fixtures in both lower- and upper-case MySQL
driver key forms. The accepted fixture is an independent, audited production
metadata snapshot rather than data generated from the contract constants.

No disposable MySQL service is introduced in this project. This leaves a
documented limitation: unit tests do not execute `schema.sql` from scratch.
The release gate compensates with the independent metadata fixture plus a
read-only production `verifySchema` run. A future CI environment with
disposable MySQL 8 may add an executable-DDL integration gate.

The managed-chat migration must run a non-destructive preserved-core schema
preflight before its first `DELETE`, `DROP`, or `ALTER`. The preflight checks
the users, portfolio, document, interest, audit, and unrelated notification
invariants expected before chat migration. The complete post-migration
verifier remains the final gate.

## Shared Boundary Module

Database-facing limits and canonical sector values will live in one focused
CommonJS module under `backend/src/validation/`. Authentication, portfolio,
and upload routes consume it rather than duplicating numeric or string rules.

Because this is a new production dependency, its path must be added to both:

- `backend/deploy/runtime-manifest.txt`; and
- the exact runtime allowlist asserted by
  `backend/test/messages-deployment-files.test.js`.

Pure helpers from this module make scalar, scale, range, UTF-8 byte-length, and
filename rules testable without acquiring the hard-wired database singleton.

## Request-to-Column Boundaries

The backend will reject invalid input with HTTP `400` before acquiring a
transaction or issuing a data query.

### User accounts

- name: at most 100 characters;
- email: valid email and at most 255 characters;
- public account roles remain only `business_owner` and `investor`;
- relationship-manager provisioning retains its administrator-only flow and
  the same database limits.

### Portfolios

- name: required, at most 255 characters;
- sector: required, at most 100 characters, selected from the shared canonical
  sector list;
- MVP status: exactly `Idea`, `Prototype`, `Beta`, or `Launched`;
- funding goal, monthly revenue, and burn rate:
  `0..9999999999999.99`, matching `DECIMAL(15,2)`, with at most two
  fractional digits;
- growth rate: `0..999.99`, matching `DECIMAL(5,2)`, with at most two
  fractional digits;
- team size, user count, and runway months:
  `0..2147483647`, matching signed MySQL `INT`;
- founded year: `1901..2100`; `1900` is no longer accepted because normal
  MySQL `YEAR` does not represent it reliably;
- location: at most 255 characters;
- website: at most 500 characters and, when present, an absolute `http` or
  `https` URL;
- market size and advisor names: at most 500 characters;
- description and competitor analysis: at most 65,535 UTF-8 bytes, matching
  MySQL `TEXT`. Validation uses `Buffer.byteLength(value, 'utf8')`, not a
  JavaScript character count.

Numeric validation accepts only finite scalar numbers or numeric strings.
`null`, an empty string, booleans, arrays, objects, non-finite values, excess
fractional scale, and range overflow are rejected rather than coerced.
Portfolio creation requires a present, non-null funding goal because the live
column is `NOT NULL` without a default. Partial portfolio updates may omit a
field, but a supplied field follows the same scalar, scale, and range rules.

The Create Portfolio page will mirror these constraints with `required`,
`maxlength`, `min`, `max`, and `step` attributes where HTML supports them.
For `TEXT`, browser `maxlength` is advisory because it counts UTF-16 code units
rather than encoded bytes. Backend validation remains authoritative.

The JSON parser limit will be set explicitly to `256kb`, enough for both valid
`TEXT` fields and the rest of one portfolio payload. A request exceeding that
aggregate limit returns JSON HTTP `413`; it must not fall through to the
generic `500` handler.

### Portfolio documents

An uploaded original filename longer than 255 characters will be rejected by
the upload filter before a file is written or a transaction inserts
`portfolio_documents.file_name`. Existing MIME, extension, size, and
five-document limits remain unchanged.

## Canonical Sector List

Create Portfolio and Browse will use the same list:

1. SaaS
2. Fintech
3. Healthtech
4. Edtech
5. AI / ML
6. Clean Energy
7. E-commerce
8. Logistics
9. Other

The backend will validate against this list so browser and API callers cannot
create values that the Browse filter cannot select.

The casing preserves the values already stored in production. The live
read-only inventory currently contains `AI / ML`, `Edtech`, `Fintech`,
`Healthtech`, and `Logistics`; all remain accepted and selectable without a
data migration. Regression coverage must hydrate and resave every observed
production sector value unchanged.

## UI Accuracy

The following copy and rendering changes are required:

- `Complete history` becomes `Latest 100 actions`.
- Audit count labels are exactly `Actions in latest 100`,
  `Approved in latest 100`, and `Rejected in latest 100`.
- `Active relationship managers` becomes `Relationship managers`, because the
  `users` table has no activation-status column.
- `Total Matches` becomes `Investor Interests`, because the query counts
  `investor_interests`.
- `Search messages` becomes `Search conversations`, because filtering covers
  room title, participants, and latest-message preview rather than full thread
  history.
- The document hint lists PDF, PPT, PPTX, DOC, and DOCX.
- Admin review renders stored team size `0` as `0`, not as missing data.
- Owner subpages remove permanently hidden unread-message badges that have no
  request or rendering path.
- The shared approval client removes its unused `notes` argument because the
  backend neither accepts nor stores approval notes.

No new database column will be invented to preserve an inaccurate label.

## Recommendation Failure and Deep Linking

Browse continues to load approved portfolios even if recommendations fail.
The initial page has two state boundaries:

1. portfolios plus the current investor's interests form one coherent
   workspace snapshot because interest state controls card actions;
2. recommendations are an independent optional enhancement with their own
   status region, request version, and Retry.

Within those boundaries:

1. workspace success renders usable cards with authoritative interest state;
2. recommendation success adds AI scores and enables the `AI Ranked` label;
3. recommendation failure shows a visible warning, uses
   `readiness_score`, and labels the ordering `Readiness Score`;
4. a data-only Retry requests recommendations again without discarding
   portfolios or sending a mutation;
5. a successful Retry clears the warning, reinstalls AI scores, and restores
   the `AI Ranked` label and ordering.

Workspace and recommendation failures cannot overwrite each other's status.
Recommendation requests are latest-response-wins and Retry is single-flight.
A failure after an earlier recommendation success clears stale AI scores
before falling back. Both the sort control and every card label switch between
`AI Score` and `Readiness Score` together.

Investor recommendation and recent-portfolio links include
`browse.html?portfolioId=<id>`. Browse normalizes the ID as a positive integer,
finds only a portfolio returned by the authorized API, highlights it, and
scrolls it into view. A missing or unauthorized ID does not select a different
portfolio or expose information.

## Asset Coherence

Every HTML page changed by this project will use one new release key for its
changed CSS, `js/api.js`, and page-specific JavaScript. Pages that share a
changed client must not mix versioned and unversioned dependencies.

If a shared asset changes, every deployed HTML consumer of that asset receives
the same key even when no other markup on that page changes.

Every floating Tabler Icons `@latest` URL in a touched or deployed page will be
pinned to the repository's existing `3.0.0` version. External Tabler assets
are not governed by the local release query key, so a floating version is not
considered release-coherent.

The release key provides coherent assets after the HTML document is fetched.
It cannot evict an already cached HTML document, so release notes will retain a
one-time hard-refresh instruction.

## Error Handling

- Schema mismatch: `/api/ready` returns `503` and logs a precise invariant name.
- Invalid API input: return `400` with validation details; do not issue a data
  query.
- Invalid browser input: preserve entered values and show a field-relevant
  message.
- Recommendation failure: keep portfolios visible, show a warning and Retry,
  and use an honestly labelled readiness fallback.
- Invalid deep-link ID: ignore the selection without redirecting or selecting a
  different card.
- A nullable or malformed `readiness_score` is normalized to numeric `0`
  everywhere it is calculated, sorted, or rendered: recommendations, Browse,
  investor dashboard, owner pages, and moderator details. This matches the
  live column's default and prevents `null/100` or `NaN`.
- Existing authentication and authorization behavior remains unchanged.

## Testing Strategy

All behavior changes use red-green-refactor.

### Schema tests

- load a complete production-shaped metadata fixture;
- accept MySQL driver key casing variants;
- reject wrong engines, enum values, nullability, defaults, generated
  expressions, unique keys, foreign-key targets, and deletion rules;
- prove the unique-interest and unique-email constraints are required;
- accept semantic metadata formatting variants and renamed-equivalent
  constraints and indexes while rejecting invisible or structurally wrong
  indexes;
- assert `backend/schema.sql` contains the live declarations and explicit
  InnoDB/collation for every table;
- use an independent audited production snapshot fixture rather than deriving
  accepted metadata from the contract constants;
- prove managed-chat migration preflight rejects a malformed preserved schema
  before any `DELETE`, `DROP`, or `ALTER`.

### Request-boundary tests

- overlong user and portfolio strings return `400`;
- year `1900` returns `400`, while `1901` and `2100` pass validation;
- decimal and integer overflow, excess decimal scale, and non-scalar coercion
  inputs return `400`;
- funding-goal null, empty, boolean, and array inputs are rejected on create;
- exact numeric maxima pass while one-cent overflow fails;
- malformed or non-HTTP(S) website values return `400`;
- an overlong document name is rejected before a file is written or a
  transaction is acquired;
- ASCII and multibyte emoji/CJK `TEXT` values are accepted or rejected by
  encoded UTF-8 byte length;
- a JSON body over `256kb` returns JSON HTTP `413`;
- valid boundary values still reach the existing handler.

### Frontend tests

- creation and browsing expose the same sector values;
- accurate labels replace the misleading copy;
- team size zero renders as zero;
- recommendation failure displays the warning and readiness fallback;
- recommendation Retry is read-only and single-flight;
- simultaneous workspace and recommendation failures render independently;
- stale or out-of-order recommendation responses cannot overwrite newer state;
- successful recommendation Retry clears the warning and restores AI scores,
  label, and ordering;
- nullable readiness values render and sort as numeric zero across every
  consumer;
- portfolio deep links normalize IDs and select only an authorized returned
  card;
- observed production sector values hydrate and resave unchanged;
- dead owner-subpage message badges and the unused approval-notes parameter are
  absent;
- every HTML consumer of a modified shared asset uses the synchronized key.

### Final verification

- focused schema, portfolio, upload, browse, dashboard, and flow tests;
- complete backend test suite;
- syntax check for every browser JavaScript file;
- `git diff --check` and exact scope review;
- read-only production `/api/ready`;
- read-only four-role GET sweep;
- read-only comparison of production metadata with the new repository
  contract;
- explicit confirmation that no MySQL row or table definition changed.

## Release Boundary

Implementation, Git publication, and SFTP deployment are separate actions.
After local verification, the user must explicitly authorize Git push and SFTP
deployment. Deployment includes only allowlisted runtime files and does not run
`schema.sql`, a migration, a seed, or any mutating smoke test.

If authorized later, backend files are uploaded as one adjacent staged set,
atomically replaced, and followed by one `lumilabs-backend.service` restart
plus `/api/health` and `/api/ready`. Changed CSS and JavaScript are staged
before HTML exposes the new release key. `backend/schema.sql` remains Git-only
and is never copied over the running database.

## Acceptance Criteria

The project is complete when:

1. `backend/schema.sql` describes the current production schema differences
   identified by the audit.
2. `/api/ready` verifies every runtime-critical database invariant described
   above and still returns `200` against production.
3. request values that cannot fit their MySQL columns return `400` before a
   data query;
4. browser limits, sector choices, labels, and fallbacks agree with backend and
   database behavior;
5. recommendation failures never masquerade readiness as AI scoring;
6. recommendation links preserve the selected portfolio;
7. the full test suite and read-only production verification pass;
8. no production database mutation occurs; and
9. notification UI work remains isolated for the next specification.
