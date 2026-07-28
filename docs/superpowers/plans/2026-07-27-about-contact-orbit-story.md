# About and Contact Orbit Story Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add local Orbit Story About and Contact pages, preserve the official Lumi5 Labs public information and real founder portraits, and persist validated Contact submissions to the existing MySQL database.

**Architecture:** The two pages remain static semantic HTML styled through a page-scoped extension to the existing stylesheet. The Contact page calls the existing `/api` client, which posts to one public Express route backed by a focused validation/storage service and a new additive MySQL table; a dedicated idempotent migration keeps production upgrades separate from the guarded five-role migration. Existing authentication, portfolio, messaging, assignment, and dashboard code remains unchanged.

**Tech Stack:** HTML5, scoped CSS, vanilla JavaScript, Node.js 20, Express 4, `express-rate-limit` 8.6.1, MySQL 8 with `mysql2`, Node's built-in test runner.

## Global Constraints

- Do not load, reference, or recreate `ai.webp`, an AI-generated hero, a stock hero, a new font, a new icon framework, or a frontend build system.
- Preserve every user-facing About and Contact fact, paragraph, address, phone number, email address, social destination, founder biography, and version value defined in `docs/superpowers/specs/2026-07-27-about-contact-orbit-story-design.md`.
- Store the official 600×600 WebP portraits locally as `images/raveen.webp` and `images/victor.webp`; these are the only photographic images on the About page.
- Use the exact public routes: Home `index.html`, About `about.html`, Contact `contact.html`, Sign in `signin.html`, Sign up `signup.html`, Portfolio `https://www.lumi5labs.com/portfolio/`, Blog `https://www.lumi5labs.com/blog/`, and FAQ `https://www.lumi5labs.com/faq/`.
- Keep the One Fullerton address as canonical: `1 Fullerton Rd, #02-01 One Fullerton`, `Singapore 049213`.
- Contact Name is a required trimmed string of 1–100 Unicode characters; Email is a required trimmed valid email string of at most 255 Unicode characters; Message is optional and at most 5,000 Unicode characters.
- Store blank or omitted Message as SQL `NULL`; reject supplied non-string values, including `null`, arrays, objects, and numbers.
- `POST /api/contact` returns `201 {"message":"Message received"}` without an ID or submitted personal information.
- A populated `company_website` honeypot returns the same generic `201` response without a database insert.
- Permit five requests per source IP in a 15-minute window; the sixth returns `429 {"error":"Too many requests. Please try again later."}` with standard rate-limit headers.
- Trust exactly one reverse-proxy hop and use `express-rate-limit@8.6.1` with its in-memory store.
- Do not add outbound email, SMTP/provider integration, a contact-submission read route, or a staff inbox.
- Do not change authentication, portfolio, messaging, assignment, role, notification, dashboard, or existing homepage behavior.
- Scope all new visual rules beneath `.public-content-page`; keep the full navigation at 980px and wider, native `details`/`summary` navigation below 980px, and one-column content at 660px and narrower.
- Preserve visible keyboard focus, logical headings, labels and error associations, a polite form-status live region, map fallback, local image dimensions, lazy loading, 44px mobile controls, no horizontal overflow, and static orbit decoration under `prefers-reduced-motion`.

---

## File Map

### Create

- `about.html` — semantic About page, complete source copy, Orbit Story markup, local founder portraits, shared public header/footer.
- `contact.html` — semantic Contact page, contact details/map, accessible database-backed form, shared public header/footer.
- `images/raveen.webp` — official local Raveen Beemsingh portrait.
- `images/victor.webp` — official local Victor Chow portrait.
- `js/contact.js` — client validation, single-flight submission state, accessible feedback, and reset/preservation behavior.
- `backend/src/services/contact-submission-workflow.js` — normalize and validate public input, then perform one parameterized insert.
- `backend/src/routes/contact.js` — public route, honeypot behavior, endpoint limiter, response mapping, and safe error forwarding.
- `backend/scripts/migrate-contact-submissions.js` — idempotent additive table migration with pre/post schema verification.
- `backend/migrate-contact.js` — environment/tunnel-aware CLI entry point for only the Contact migration.
- `backend/test/public-content-pages.test.js` — exact content, links, semantic/accessibility hooks, image, map, and responsive-style contracts.
- `backend/test/contact-client.test.js` — DOM-level Contact form state and validation tests.
- `backend/test/contact-submission-workflow.test.js` — normalization, validation, insert, nullable-message, and safe failure tests.
- `backend/test/contact-route.test.js` — route status/body, honeypot, limiter, proxy-IP, and error tests.
- `backend/test/contact-submissions-migration.test.js` — absent/correct/wrong table and idempotency tests.

### Modify

- `css/style.css` — append only page-scoped public-content and responsive rules.
- `js/api.js` — add `API.submitContact(payload)`.
- `backend/server.js` — trust one proxy hop and mount a factory-created Contact router.
- `backend/schema.sql` — add the canonical `contact_submissions` DDL.
- `backend/src/schema-contract.js` — add the table's column, primary-key, and chronological-index contracts.
- `backend/test/fixtures/production-schema-metadata.json` — add exact MySQL metadata rows for the table.
- `backend/test/schema-contract.test.js` — move the expected complete schema from ten to eleven tables and assert the new shape.
- `backend/test/api-client.test.js` — assert the exact Contact client URL, verb, headers, and body.
- `backend/package.json` and `backend/package-lock.json` — pin `express-rate-limit` and expose the focused migration command.
- `backend/deploy/runtime-manifest.txt` — deploy the pages, portraits, client, route, service, and migration files.
- `backend/test/messages-deployment-files.test.js` — keep the exact runtime allowlist and package-script contracts synchronized.

## Task 1: Contact Table Contract and Additive Migration

**Files:**

- Create: `backend/scripts/migrate-contact-submissions.js`
- Create: `backend/migrate-contact.js`
- Create: `backend/test/contact-submissions-migration.test.js`
- Modify: `backend/schema.sql`
- Modify: `backend/src/schema-contract.js`
- Modify: `backend/test/fixtures/production-schema-metadata.json`
- Modify: `backend/test/schema-contract.test.js`

**Interfaces:**

- Consumes: `verifyPreservedCoreSchema(database): Promise<true>` and `verifySchema(database): Promise<true>` from `backend/src/schema-contract.js`; `requireEnvironment`, `openMigrationTunnel`, and `releaseMigrationResources` from `backend/migrate.js`.
- Produces: `migrateContactSubmissions(connection, options?): Promise<{status: "ready", changed: string[]}>`; complete-schema readiness now requires `contact_submissions`.

- [ ] **Step 1: Write failing schema-contract assertions**

Add the following contract checks to `backend/test/schema-contract.test.js`, using its existing metadata harness:

```js
test('complete schema requires the exact contact submissions table', async () => {
  const metadata = cloneProductionSchemaMetadata();
  assert.equal(metadata.tables.length, 11);

  const columns = metadata.columns
    .filter(({ table_name }) => table_name === 'contact_submissions')
    .map((row) => ({
      name: row.column_name,
      type: row.column_type,
      nullable: row.is_nullable,
      defaultValue: row.column_default,
      extra: row.extra,
    }));

  assert.deepEqual(columns, [
    {
      name: 'id',
      type: 'bigint unsigned',
      nullable: 'NO',
      defaultValue: null,
      extra: 'auto_increment',
    },
    {
      name: 'name',
      type: 'varchar(100)',
      nullable: 'NO',
      defaultValue: null,
      extra: '',
    },
    {
      name: 'email',
      type: 'varchar(255)',
      nullable: 'NO',
      defaultValue: null,
      extra: '',
    },
    {
      name: 'message',
      type: 'text',
      nullable: 'YES',
      defaultValue: null,
      extra: '',
    },
    {
      name: 'created_at',
      type: 'timestamp',
      nullable: 'NO',
      defaultValue: 'CURRENT_TIMESTAMP',
      extra: 'DEFAULT_GENERATED',
    },
  ]);

  assert.equal(
    metadata.indexes.some((row) => (
      row.table_name === 'contact_submissions'
      && row.index_name === 'PRIMARY'
      && row.column_name === 'id'
      && Number(row.non_unique) === 0
    )),
    true,
  );
  assert.equal(
    metadata.indexes.some((row) => (
      row.table_name === 'contact_submissions'
      && row.index_name === 'idx_contact_submissions_created_at'
      && row.column_name === 'created_at'
      && Number(row.non_unique) === 1
    )),
    true,
  );

  const { database } = createSchemaMetadataDatabase(metadata);
  await assert.doesNotReject(verifySchema(database));
});
```

Also add a negative assertion that removing `message` or changing it to non-null makes `verifySchema` reject with `Missing schema invariants`.

- [ ] **Step 2: Write failing migration tests**

Create `backend/test/contact-submissions-migration.test.js` around a small connection fake that records SQL and swaps metadata from the existing ten-table fixture to the eleven-table fixture after `CREATE TABLE`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  migrateContactSubmissions,
} = require('../scripts/migrate-contact-submissions');

test('migration creates the table once and verifies the final schema', async () => {
  const calls = [];
  let exists = false;
  const connection = {
    async query(sql) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      calls.push(normalized);
      if (/information_schema\.tables/i.test(normalized)) {
        return [[{ count: exists ? 1 : 0 }], []];
      }
      if (/^CREATE TABLE IF NOT EXISTS contact_submissions/i.test(normalized)) {
        exists = true;
      }
      return [[], []];
    },
  };
  let beforeChecks = 0;
  let afterChecks = 0;

  const first = await migrateContactSubmissions(connection, {
    verifyBefore: async () => { beforeChecks += 1; return true; },
    verifyAfter: async () => { afterChecks += 1; return true; },
  });
  const second = await migrateContactSubmissions(connection, {
    verifyBefore: async () => true,
    verifyAfter: async () => true,
  });

  assert.deepEqual(first, {
    status: 'ready',
    changed: ['contact_submissions'],
  });
  assert.deepEqual(second, {
    status: 'ready',
    changed: [],
  });
  assert.equal(beforeChecks, 1);
  assert.equal(afterChecks, 1);
  assert.equal(
    calls.filter((sql) => /^CREATE TABLE IF NOT EXISTS contact_submissions/i.test(sql)).length,
    2,
  );
  assert.equal(calls.some((sql) => /\b(DROP|TRUNCATE|DELETE)\b/i.test(sql)), false);
});

test('migration rejects a pre-existing table with the wrong shape', async () => {
  const connection = {
    async query(sql) {
      if (/information_schema\.tables/i.test(sql)) {
        return [[{ count: 1 }], []];
      }
      return [[], []];
    },
  };
  await assert.rejects(
    migrateContactSubmissions(connection, {
      verifyBefore: async () => true,
      verifyAfter: async () => {
        throw new Error('Missing schema invariants: contact_submissions.message');
      },
    }),
    /contact_submissions\.message/,
  );
});
```

The separate wrong-shape test represents a table that already exists, lets `CREATE TABLE IF NOT EXISTS` no-op, and makes the injected final verifier reject its mismatched metadata.

- [ ] **Step 3: Run the focused tests and confirm the red state**

Run:

```bash
node --test backend/test/schema-contract.test.js backend/test/contact-submissions-migration.test.js
```

Expected: FAIL because the fixture and schema contract contain only ten tables and `migrate-contact-submissions.js` does not exist.

- [ ] **Step 4: Add the canonical SQL and complete schema contract**

Append this exact DDL to `backend/schema.sql`:

```sql
-- Public website Contact submissions
CREATE TABLE IF NOT EXISTS contact_submissions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(255) NOT NULL,
  message TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_contact_submissions_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```

Add this entry to `COLUMN_CONTRACT` in `backend/src/schema-contract.js`:

```js
contact_submissions: defineColumns([
  ['id', 'bigint unsigned', 'NO', null, 'auto_increment'],
  ['name', 'varchar(100)', 'NO', null],
  ['email', 'varchar(255)', 'NO', null],
  ['message', 'text', 'YES', null],
  ['created_at', 'timestamp', 'NO', 'CURRENT_TIMESTAMP', 'DEFAULT_GENERATED'],
]),
```

Add `['contact_submissions', ['id']]` to `PRIMARY_INDEX_CONTRACT` and `['contact_submissions', ['created_at']]` to `ACCESS_INDEX_CONTRACT`. Do not add a unique index or foreign key.

Add the fixture rows in ordinal order with `table_collation: "utf8mb4_0900_ai_ci"`, one primary-index row for `id`, and one non-unique `idx_contact_submissions_created_at` row for `created_at`. The complete fixture totals become 11 tables, 110 columns, 46 index rows, and 23 foreign-key rows.

Rename the existing canonical-fixture test to `canonical metadata has eleven tables and the exact final five-role contract` and extend its exact table list:

```js
assert.deepEqual(tableNames, [
  'users',
  'portfolios',
  'portfolio_documents',
  'investor_interests',
  'conversations',
  'conversation_members',
  'messages',
  'notifications',
  'audit_logs',
  'superadmin_audit_logs',
  'contact_submissions',
]);
```

- [ ] **Step 5: Implement the idempotent migration and CLI**

Create `backend/scripts/migrate-contact-submissions.js`:

```js
const {
  verifyPreservedCoreSchema,
  verifySchema,
} = require('../src/schema-contract');

const CREATE_CONTACT_SUBMISSIONS = `
  CREATE TABLE IF NOT EXISTS contact_submissions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL,
    message TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_contact_submissions_created_at (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
`;

async function tableExists(connection) {
  const [rows] = await connection.query(
    `SELECT COUNT(*) AS count
       FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name = 'contact_submissions'`,
  );
  return Number(rows[0]?.count || 0) === 1;
}

async function migrateContactSubmissions(connection, {
  verifyBefore = verifyPreservedCoreSchema,
  verifyAfter = verifySchema,
} = {}) {
  await verifyBefore(connection);
  const existed = await tableExists(connection);
  await connection.query(CREATE_CONTACT_SUBMISSIONS);
  await verifyAfter(connection);
  return {
    status: 'ready',
    changed: existed ? [] : ['contact_submissions'],
  };
}

module.exports = {
  CREATE_CONTACT_SUBMISSIONS,
  migrateContactSubmissions,
};
```

Create `backend/migrate-contact.js` using the existing tunnel helpers:

```js
require('dotenv').config();

const mysql = require('mysql2/promise');
const {
  openMigrationTunnel,
  releaseMigrationResources,
  requireEnvironment,
} = require('./migrate');
const {
  migrateContactSubmissions,
} = require('./scripts/migrate-contact-submissions');

async function main(environment = process.env) {
  requireEnvironment(environment);
  let tunnel;
  let connection;
  try {
    tunnel = await openMigrationTunnel(environment);
    connection = await mysql.createConnection({
      host: tunnel ? '127.0.0.1' : (environment.DB_HOST || '127.0.0.1'),
      port: tunnel ? tunnel.localPort : Number(environment.DB_PORT || 3306),
      user: environment.DB_USER,
      password: environment.DB_PASSWORD,
      database: environment.DB_NAME,
    });
    const result = await migrateContactSubmissions(connection);
    console.log(JSON.stringify(result));
    return result;
  } finally {
    await releaseMigrationResources({ connection, tunnel });
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Contact migration failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { main };
```

- [ ] **Step 6: Run schema and migration tests**

Run:

```bash
node --test backend/test/schema-contract.test.js backend/test/contact-submissions-migration.test.js
```

Expected: PASS, including idempotency, wrong-shape rejection, and absence of destructive SQL.

- [ ] **Step 7: Commit the database slice**

```bash
git add backend/schema.sql backend/src/schema-contract.js backend/test/fixtures/production-schema-metadata.json backend/test/schema-contract.test.js backend/scripts/migrate-contact-submissions.js backend/migrate-contact.js backend/test/contact-submissions-migration.test.js
git commit -m "feat(contact): add submission schema and migration"
```

## Task 2: Validated Public Contact API

**Files:**

- Create: `backend/src/services/contact-submission-workflow.js`
- Create: `backend/src/routes/contact.js`
- Create: `backend/test/contact-submission-workflow.test.js`
- Create: `backend/test/contact-route.test.js`
- Modify: `backend/server.js`
- Modify: `backend/package.json`
- Modify: `backend/package-lock.json`

**Interfaces:**

- Consumes: a `database` object exposing `execute(sql, params): Promise<[result]>`; the global Express JSON limit and error handlers.
- Produces: `ContactSubmissionValidationError`, `normalizeContactSubmission({name,email,message})`, `createContactSubmission({database,name,email,message}): Promise<void>`, `createContactRateLimiter(options?)`, and `createContactRouter({database,workflow?,limiter?})`.

- [ ] **Step 1: Write failing workflow tests**

Create `backend/test/contact-submission-workflow.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ContactSubmissionValidationError,
  createContactSubmission,
  normalizeContactSubmission,
} = require('../src/services/contact-submission-workflow');

test('normalization trims strings and maps a blank optional message to null', () => {
  assert.deepEqual(
    normalizeContactSubmission({
      name: '  Ada Lovelace  ',
      email: '  Ada@Example.com  ',
      message: '   ',
    }),
    {
      name: 'Ada Lovelace',
      email: 'Ada@Example.com',
      message: null,
    },
  );
});

test('workflow performs one parameterized insert without echoing PII', async () => {
  const calls = [];
  const database = {
    async execute(sql, params) {
      calls.push({ sql, params });
      return [{ affectedRows: 1 }];
    },
  };
  const result = await createContactSubmission({
    database,
    name: ' Visitor ',
    email: ' visitor@example.com ',
    message: ' Hello ',
  });

  assert.equal(result, undefined);
  assert.deepEqual(calls, [{
    sql: 'INSERT INTO contact_submissions (name, email, message) VALUES (?, ?, ?)',
    params: ['Visitor', 'visitor@example.com', 'Hello'],
  }]);
});

test('validation reports safe field errors at Unicode boundaries', () => {
  assert.throws(
    () => normalizeContactSubmission({
      name: '🙂'.repeat(101),
      email: 'not-an-email',
      message: '界'.repeat(5001),
    }),
    (error) => {
      assert.equal(error instanceof ContactSubmissionValidationError, true);
      assert.deepEqual(error.fields, {
        name: 'Name must be 100 characters or fewer.',
        email: 'Enter a valid email address.',
        message: 'Message must be 5,000 characters or fewer.',
      });
      assert.doesNotMatch(error.message, /not-an-email|🙂|界/);
      return true;
    },
  );
});

test('workflow rejects a non-insert result with a generic error', async () => {
  const database = { execute: async () => [{ affectedRows: 0 }] };
  await assert.rejects(
    createContactSubmission({
      database,
      name: 'Visitor',
      email: 'visitor@example.com',
      message: '',
    }),
    (error) => {
      assert.equal(error.message, 'Contact submission could not be stored');
      assert.doesNotMatch(error.message, /Visitor|visitor@example\.com/);
      return true;
    },
  );
});
```

Add these exact boundary cases:

```js
test('normalization accepts the exact maximum Unicode lengths', () => {
  const email = `${'a'.repeat(250)}@e.co`;
  assert.equal([...email].length, 255);
  assert.doesNotThrow(() => normalizeContactSubmission({
    name: '🙂'.repeat(100),
    email,
    message: '界'.repeat(5000),
  }));
});

test('normalization rejects missing, oversized and non-string fields safely', () => {
  const valid = {
    name: 'Visitor',
    email: 'visitor@example.com',
    message: 'Hello',
  };
  const cases = [
    [{ ...valid, name: '' }, 'name', 'Enter your name.'],
    [{ ...valid, name: 'a'.repeat(101) }, 'name', 'Name must be 100 characters or fewer.'],
    [{ ...valid, name: null }, 'name', 'Enter your name.'],
    [{ ...valid, email: '' }, 'email', 'Enter your email address.'],
    [{ ...valid, email: `${'a'.repeat(251)}@e.co` }, 'email', 'Email must be 255 characters or fewer.'],
    [{ ...valid, email: {} }, 'email', 'Enter your email address.'],
    [{ ...valid, message: '界'.repeat(5001) }, 'message', 'Message must be 5,000 characters or fewer.'],
    [{ ...valid, message: null }, 'message', 'Message must be text.'],
  ];

  for (const [payload, field, expected] of cases) {
    assert.throws(
      () => normalizeContactSubmission(payload),
      (error) => {
        assert.equal(error.fields[field], expected);
        return true;
      },
    );
  }
});
```

- [ ] **Step 2: Write failing route and limiter tests**

Create `backend/test/contact-route.test.js` with a minimal Express app and this dependency-free HTTP helper:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const {
  createContactRateLimiter,
  createContactRouter,
} = require('../src/routes/contact');
const {
  ContactSubmissionValidationError,
} = require('../src/services/contact-submission-workflow');

const validPayload = {
  name: 'Visitor',
  email: 'visitor@example.com',
  message: 'Hello',
  company_website: '',
};

function contactApp({ workflow }) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use('/', createContactRouter({
    database: {},
    workflow,
    limiter: createContactRateLimiter(),
  }));
  app.use((error, req, res, next) => {
    assert.equal(error.message, 'Contact submission failed');
    res.status(500).json({ error: 'Internal server error' });
  });
  return app;
}

async function requestJson(app, payload, headers = {}, requestPath = '/') {
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const address = server.address();
  try {
    return await new Promise((resolve, reject) => {
      const request = http.request({
        hostname: '127.0.0.1',
        port: address.port,
        path: requestPath,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...headers,
        },
      }, (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve({
          status: response.statusCode,
          headers: response.headers,
          body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
        }));
      });
      request.on('error', reject);
      request.end(JSON.stringify(payload));
    });
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

test('valid input returns only the generic success response', async () => {
  const calls = [];
  const app = contactApp({
    workflow: async (payload) => { calls.push(payload); },
  });
  const response = await requestJson(app, {
    name: ' Visitor ',
    email: ' visitor@example.com ',
    message: ' Hello ',
    company_website: '',
  });

  assert.equal(response.status, 201);
  assert.deepEqual(response.body, { message: 'Message received' });
  assert.equal('id' in response.body, false);
  assert.equal(JSON.stringify(response.body).includes('visitor@example.com'), false);
  assert.equal(calls.length, 1);
});

test('honeypot input returns generic success without calling the workflow', async () => {
  let calls = 0;
  const app = contactApp({ workflow: async () => { calls += 1; } });
  const response = await requestJson(app, {
    name: 'Bot',
    email: 'bot@example.com',
    message: 'Spam',
    company_website: 'https://spam.example',
  });

  assert.equal(response.status, 201);
  assert.deepEqual(response.body, { message: 'Message received' });
  assert.equal(calls, 0);
});

test('sixth request from one address is limited with standard headers', async () => {
  const app = contactApp({ workflow: async () => {} });
  const responses = [];
  for (let attempt = 0; attempt < 6; attempt += 1) {
    responses.push(await requestJson(app, validPayload, {
      'x-forwarded-for': '203.0.113.10',
    }));
  }

  assert.deepEqual(responses.slice(0, 5).map(({ status }) => status), [201, 201, 201, 201, 201]);
  assert.equal(responses[5].status, 429);
  assert.deepEqual(responses[5].body, {
    error: 'Too many requests. Please try again later.',
  });
  assert.match(responses[5].headers['ratelimit-policy'], /5/);
  assert.equal(responses[5].headers['x-ratelimit-limit'], undefined);
});
```

Add these route cases:

```js
test('validation errors become safe field-level 400 responses', async () => {
  const app = contactApp({
    workflow: async () => {
      throw new ContactSubmissionValidationError({
        email: 'Enter a valid email address.',
      });
    },
  });
  const response = await requestJson(app, {
    ...validPayload,
    email: 'invalid',
  });
  assert.equal(response.status, 400);
  assert.deepEqual(response.body, {
    errors: { email: 'Enter a valid email address.' },
  });
});

test('non-string honeypot is rejected before storage', async () => {
  let calls = 0;
  const app = contactApp({ workflow: async () => { calls += 1; } });
  const response = await requestJson(app, {
    ...validPayload,
    company_website: ['not', 'text'],
  });
  assert.equal(response.status, 400);
  assert.deepEqual(response.body, {
    errors: { company_website: 'Invalid form submission.' },
  });
  assert.equal(calls, 0);
});

test('separate forwarded addresses have independent request budgets', async () => {
  const app = contactApp({ workflow: async () => {} });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.equal(
      (await requestJson(app, validPayload, {
        'x-forwarded-for': '203.0.113.20',
      })).status,
      201,
    );
  }
  assert.equal(
    (await requestJson(app, validPayload, {
      'x-forwarded-for': '203.0.113.21',
    })).status,
    201,
  );
});

test('unexpected storage failure returns only the global safe 500', async () => {
  const app = contactApp({
    workflow: async () => {
      throw new Error('database rejected visitor@example.com');
    },
  });
  const response = await requestJson(app, validPayload);
  assert.equal(response.status, 500);
  assert.deepEqual(response.body, { error: 'Internal server error' });
  assert.doesNotMatch(JSON.stringify(response.body), /Visitor|visitor@example\.com|Hello/);
});

test('unified server mounts the public Contact route at /api/contact', async () => {
  const { createApp } = require('../server');
  const inserts = [];
  const database = {
    async execute(sql, params) {
      inserts.push({ sql, params });
      return [{ affectedRows: 1 }];
    },
    async query() {
      return [[], []];
    },
  };
  const app = createApp({
    database,
    verifySchema: async () => true,
    contactLimiter: (req, res, next) => next(),
  });
  const response = await requestJson(app, validPayload, {}, '/api/contact');

  assert.equal(response.status, 201);
  assert.deepEqual(response.body, { message: 'Message received' });
  assert.equal(inserts.length, 1);
});
```

- [ ] **Step 3: Run the focused tests and confirm the red state**

Run:

```bash
node --test backend/test/contact-submission-workflow.test.js backend/test/contact-route.test.js
```

Expected: FAIL because the workflow, router, and rate-limit dependency do not exist.

- [ ] **Step 4: Pin the maintained limiter dependency**

Run from the repository root:

```bash
npm --prefix backend install --save-exact express-rate-limit@8.6.1
```

Expected: `backend/package.json` contains `"express-rate-limit": "8.6.1"` and npm regenerates `backend/package-lock.json`.

- [ ] **Step 5: Implement normalization and storage**

Create `backend/src/services/contact-submission-workflow.js`:

```js
class ContactSubmissionValidationError extends Error {
  constructor(fields) {
    super('Invalid contact submission');
    this.name = 'ContactSubmissionValidationError';
    this.fields = fields;
  }
}

function characterCount(value) {
  return [...value].length;
}

function normalizeContactSubmission({ name, email, message } = {}) {
  const fields = {};
  const normalized = {};

  if (typeof name !== 'string' || !name.trim()) {
    fields.name = 'Enter your name.';
  } else if (characterCount(name.trim()) > 100) {
    fields.name = 'Name must be 100 characters or fewer.';
  } else {
    normalized.name = name.trim();
  }

  if (typeof email !== 'string' || !email.trim()) {
    fields.email = 'Enter your email address.';
  } else if (characterCount(email.trim()) > 255) {
    fields.email = 'Email must be 255 characters or fewer.';
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    fields.email = 'Enter a valid email address.';
  } else {
    normalized.email = email.trim();
  }

  if (message === undefined || (typeof message === 'string' && !message.trim())) {
    normalized.message = null;
  } else if (typeof message !== 'string') {
    fields.message = 'Message must be text.';
  } else if (characterCount(message.trim()) > 5000) {
    fields.message = 'Message must be 5,000 characters or fewer.';
  } else {
    normalized.message = message.trim();
  }

  if (Object.keys(fields).length) {
    throw new ContactSubmissionValidationError(fields);
  }
  return normalized;
}

async function createContactSubmission({ database, name, email, message }) {
  const normalized = normalizeContactSubmission({ name, email, message });
  let result;
  try {
    [result] = await database.execute(
      'INSERT INTO contact_submissions (name, email, message) VALUES (?, ?, ?)',
      [normalized.name, normalized.email, normalized.message],
    );
  } catch {
    throw new Error('Contact submission could not be stored');
  }
  if (Number(result?.affectedRows) !== 1) {
    throw new Error('Contact submission could not be stored');
  }
}

module.exports = {
  ContactSubmissionValidationError,
  createContactSubmission,
  normalizeContactSubmission,
};
```

- [ ] **Step 6: Implement the route factory and mount it**

Create `backend/src/routes/contact.js`:

```js
const express = require('express');
const { rateLimit } = require('express-rate-limit');
const {
  ContactSubmissionValidationError,
  createContactSubmission,
} = require('../services/contact-submission-workflow');

const SUCCESS = { message: 'Message received' };

function createContactRateLimiter({
  windowMs = 15 * 60 * 1000,
  limit = 5,
} = {}) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: {
      error: 'Too many requests. Please try again later.',
    },
  });
}

function createContactRouter({
  database,
  workflow = createContactSubmission,
  limiter = createContactRateLimiter(),
} = {}) {
  if (!database) throw new TypeError('database is required');
  const router = express.Router();

  router.post('/', limiter, async (req, res, next) => {
    const honeypot = req.body?.company_website;
    if (honeypot !== undefined && typeof honeypot !== 'string') {
      return res.status(400).json({
        errors: { company_website: 'Invalid form submission.' },
      });
    }
    if (typeof honeypot === 'string' && honeypot.trim()) {
      return res.status(201).json(SUCCESS);
    }

    try {
      await workflow({
        database,
        name: req.body?.name,
        email: req.body?.email,
        message: req.body?.message,
      });
      return res.status(201).json(SUCCESS);
    } catch (error) {
      if (error instanceof ContactSubmissionValidationError) {
        return res.status(400).json({ errors: error.fields });
      }
      return next(new Error('Contact submission failed'));
    }
  });

  return router;
}

module.exports = {
  createContactRateLimiter,
  createContactRouter,
};
```

In `backend/server.js`, allow limiter injection for tests and mount before the 404 handler:

```js
const {
  createContactRouter,
} = require('./src/routes/contact');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use('/api/contact', createContactRouter({
  database,
  limiter: options.contactLimiter,
}));
```

When `options.contactLimiter` is absent, omit the property or make the router factory replace `undefined` with `createContactRateLimiter()` so production always receives a limiter. Keep the existing safe global error handlers as the only `500` response source.

- [ ] **Step 7: Run API tests and the existing server lifecycle tests**

Run:

```bash
node --test backend/test/contact-submission-workflow.test.js backend/test/contact-route.test.js backend/test/messages-server.test.js
```

Expected: PASS with no authentication requirement, no PII in responses/errors, five allowed requests, and a safe sixth-request rejection.

- [ ] **Step 8: Commit the API slice**

```bash
git add backend/src/services/contact-submission-workflow.js backend/src/routes/contact.js backend/test/contact-submission-workflow.test.js backend/test/contact-route.test.js backend/server.js backend/package.json backend/package-lock.json
git commit -m "feat(contact): add validated public submission API"
```

## Task 3: Complete Semantic About and Contact Pages

**Files:**

- Create: `about.html`
- Create: `contact.html`
- Create: `images/raveen.webp`
- Create: `images/victor.webp`
- Create: `backend/test/public-content-pages.test.js`

**Interfaces:**

- Consumes: the approved literal content and route map in `docs/superpowers/specs/2026-07-27-about-contact-orbit-story-design.md`.
- Produces: stable public-shell classes prefixed `public-`, page classes `about-page` and `contact-page`, Orbit Story elements prefixed `story-orbit-`, and the exact Contact form DOM IDs consumed by Task 5.

- [ ] **Step 1: Write failing public-content contract tests**

Create `backend/test/public-content-pages.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const visibleText = (source) => source
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&#39;|&apos;/g, "'")
  .replace(/\s+/g, ' ')
  .trim();

const publicRoutes = [
  ['Home', 'index.html'],
  ['About', 'about.html'],
  ['Portfolio', 'https://www.lumi5labs.com/portfolio/'],
  ['Blog', 'https://www.lumi5labs.com/blog/'],
  ['FAQ', 'https://www.lumi5labs.com/faq/'],
  ['Contact', 'contact.html'],
  ['Sign in', 'signin.html'],
  ['Sign up', 'signup.html'],
];

const footerFacts = [
  'A venture studio and innovation lab based in Singapore, fueling the growth of technology startups with expert guidance and funding.',
  '1 Fullerton Rd, #02-01 One Fullerton',
  'Singapore 049213',
  'business@lumi5labs.com',
  '+65-6599-1991',
  'Copyright © 2026 LUMI5 LABS',
  'v26.02.13.1',
];

test('both pages expose the exact public shell and one current-page marker', () => {
  for (const file of ['about.html', 'contact.html']) {
    const source = read(file);
    const text = visibleText(source);
    assert.equal((source.match(/<h1\b/gi) || []).length, 1, file);
    assert.match(source, /<details\b[^>]*class="[^"]*\bpublic-menu\b/);
    assert.match(source, /<summary\b[^>]*>[\s\S]*?Menu[\s\S]*?<\/summary>/);
    for (const [label, href] of publicRoutes) {
      assert.match(
        source,
        new RegExp(`href=["']${href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>[\\s\\S]*?${label}`),
        `${file}: ${label}`,
      );
    }
    for (const fact of footerFacts) assert.ok(text.includes(fact), `${file}: ${fact}`);
    assert.equal((source.match(/aria-current=["']page["']/g) || []).length, 2, file);
    assert.doesNotMatch(source, /ai\.webp|artificial intelligence hero/i);
  }
  assert.match(read('about.html'), /href=["']about\.html["'][^>]*aria-current=["']page["']/);
  assert.match(read('contact.html'), /href=["']contact\.html["'][^>]*aria-current=["']page["']/);
});
```

The count is two because the active page appears once in the desktop navigation and once in the native compact menu.

Add exact About copy assertions:

```js
test('About preserves the complete story, vision, leadership and connect copy', () => {
  const source = read('about.html');
  const text = visibleText(source);
  const required = [
    'Ideas grow through connection.',
    'About Lumi5 Labs',
    'Our Inspiring Journey',
    'In a world where innovation knows no bounds, two visionary leaders, Raveen Beemsingh and Victor Chow, embarked on a journey to create something extraordinary. Raveen, the co-founder of Hammerhead, had already made his mark by developing cutting-edge software solutions and mentoring startups through Techstars. Meanwhile, Victor, with his extensive background in SingTel-NCS, Huawei, Fatfish Group, and InspirAsia Fintech Accelerator, had a proven track record of fostering entrepreneurship and growth.',
    'Their paths converged when they decided to establish Lumi5 Labs, a venture studio and innovation lab dedicated to investing in, nurturing, and transforming startups, small businesses, and large corporations. This collaboration was not just about combining their expertise; it was about creating a platform where their collective knowledge could empower others.',
    'Raveen brought his technical prowess and entrepreneurial spirit, while Victor contributed his strategic insights and experience in scaling businesses across diverse regions. Together, they crafted a unique ecosystem where startups could flourish and established companies could innovate. Lumi5 Labs became a beacon for those seeking to disrupt industries and redefine success.',
    'A Legacy of Innovation and Inspiration',
    'Raveen Beemsingh and Victor Chow, founders of Lumi5 Labs, aimed to create a global legacy of innovation and inspiration. Their vision extended beyond startups to a global network of innovation labs, empowering entrepreneurs and businesses.',
    'They are seeking strategic corporate partners to launch the Lumi5 Foundation, offering educational programs and investing in sustainable ventures addressing global challenges.',
    "Quarterly Lumi5 workshops brought together thought leaders and startup founders to share ideas and celebrate innovation. Their mission wasn't just about profits—it was about uplifting communities, driving sustainability, and creating lasting impact.",
    'Raveen and Victor want to transform Lumi5 Labs into a movement, inspiring future generations to innovate and shape a better world.',
    'The Team',
    'CEO & CTO',
    'Raveen Beemsingh is a 2-time exited entrepreneur and technology leader with over two decades of experience in software development and technology ventures. His entrepreneurial journey includes co-founding Hammerhead, a cycling technology company, where he served as Chief Technology Officer and led the company through the TechStars accelerator program. The company was later acquired by SRAM.',
    'Recently Raveen co-founded Lumi5 Labs with Victor, contributing his expertise to innovative projects. Prior to his current role, he was the CTO at Leadzen.ai. He has also co-founded LuminaryLane, an AI brand builder. His expertise spans Hardware, Gen AI and 0-to-1 product building. Raveen actively mentors startups through Techstars.',
    'COO & CMO',
    'Victor Chow is a seasoned entrepreneur and corporate leader with over 30 years of experience in investments, startups, telecommunications, cloud computing and blockchain technologies. He has held C-level positions across general management, strategic planning, and global operations in Asia Pacific, Europe, and North America.',
    "Victor's roles include CEO of Aristagora International, a multi-family office subsidiary of Aristagora Advisors based in Tokyo. He also served as Venture Partner for Fatfish Group. Previously, Victor was the Global COO for Cloud Computing at Huawei Technologies and the Global Business Director for SingTel-NCS Group. His expertise in fintech led him to become the Founding CEO of InspirAsia Fintech Accelerator.",
    "Let's Innovate Together",
    'Connect with us to explore how we can make your vision a reality. Join us in shaping the future.',
  ];
  for (const value of required) assert.ok(text.includes(value), value);

  for (const target of [
    'images/raveen.webp',
    'images/victor.webp',
    'https://www.linkedin.com/in/raveenbeemsingh/',
    'https://x.com/rbmsingh',
    'https://www.instagram.com/raveenb/',
    'https://raveenb.lumi5labs.com/',
    'https://www.linkedin.com/in/victorchowsingapore/',
    'https://victorc.lumi5labs.com/',
  ]) {
    assert.match(source, new RegExp(target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(source, /src=["']images\/raveen\.webp["'][^>]*width=["']600["'][^>]*height=["']600["'][^>]*loading=["']lazy["']/);
  assert.match(source, /src=["']images\/victor\.webp["'][^>]*width=["']600["'][^>]*height=["']600["'][^>]*loading=["']lazy["']/);
});
```

Add exact Contact markup assertions:

```js
test('Contact preserves its details, map fallback and accessible form contract', () => {
  const source = read('contact.html');
  const text = visibleText(source);
  for (const value of [
    'Contact Us',
    'Here is how you can contact us for any questions or concerns.',
    'Get in Touch',
    '1 Fullerton Rd, #02-01 One Fullerton',
    'Singapore 049213',
    '+65-6599-1991',
    'business@lumi5labs.com',
    'Open in Google Maps',
    'Send Message',
  ]) {
    assert.ok(text.includes(value), value);
  }
  assert.match(source, /<form\b[^>]*id=["']contact-form["'][^>]*novalidate/);
  for (const id of [
    'contact-name',
    'contact-email',
    'contact-message',
    'contact-company-website',
    'contact-submit',
    'contact-status',
  ]) {
    assert.match(source, new RegExp(`id=["']${id}["']`), id);
  }
  assert.match(source, /id=["']contact-name["'][^>]*maxlength=["']100["'][^>]*aria-describedby=["']contact-name-error["']/);
  assert.match(source, /id=["']contact-email["'][^>]*maxlength=["']255["'][^>]*aria-describedby=["']contact-email-error["']/);
  assert.match(source, /id=["']contact-message["'][^>]*maxlength=["']5000["'][^>]*aria-describedby=["']contact-message-error["']/);
  assert.match(source, /id=["']contact-company-website["'][^>]*tabindex=["']-1["'][^>]*autocomplete=["']off["'][^>]*aria-hidden=["']true["']/);
  assert.match(source, /id=["']contact-status["'][^>]*role=["']status["'][^>]*aria-live=["']polite["'][^>]*tabindex=["']-1["']/);
  assert.match(source, /title=["']Lumi5 Labs office location at One Fullerton, Singapore["'][^>]*loading=["']lazy["']/);
  assert.match(source, /https:\/\/www\.google\.com\/maps\/search\/\?api=1&amp;query=1%20Fullerton%20Rd%20Singapore%20049213/);
  assert.match(
    source,
    /<script src=["']js\/api\.js\?v=20260727\.2["']><\/script>\s*<script src=["']js\/contact\.js\?v=20260727\.1["']><\/script>/,
  );
});
```

- [ ] **Step 2: Run the page tests and confirm the red state**

Run:

```bash
node --test backend/test/public-content-pages.test.js
```

Expected: FAIL with `ENOENT` for `about.html` and `contact.html`.

- [ ] **Step 3: Download and verify the two official portraits**

Run:

```bash
mkdir -p images
curl -fL https://www.lumi5labs.com/images/raveen.webp -o images/raveen.webp
curl -fL https://www.lumi5labs.com/images/victor.webp -o images/victor.webp
sips -g pixelWidth -g pixelHeight images/raveen.webp images/victor.webp
file images/raveen.webp images/victor.webp
```

Expected: both files are WebP images and both report 600px width and 600px height. Do not download any other image.

- [ ] **Step 4: Create the shared semantic public shell**

Start `about.html` with:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="Discover the story, vision, and leadership behind Lumi5 Labs, a Singapore venture studio and innovation lab.">
  <title>About Lumi5 Labs</title>
  <link rel="stylesheet" href="css/style.css?v=20260727.2">
</head>
<body class="public-content-page about-page">
```

Start `contact.html` with:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="Contact Lumi5 Labs at One Fullerton in Singapore by website message, email, or phone.">
  <title>Contact Lumi5 Labs</title>
  <link rel="stylesheet" href="css/style.css?v=20260727.2">
</head>
<body class="public-content-page contact-page">
```

Use this exact navigation structure in both pages; repeat the links inside `<details class="public-menu">` and put `aria-current="page"` on the current page in both navigation sets:

```html
<header class="public-header">
  <a class="public-brand" href="index.html" aria-label="Lumi5 Labs home">
    <span class="public-brand-mark" aria-hidden="true">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <polyline
          points="2,14 7,9 11,12 18,5"
          stroke="currentColor"
          stroke-width="2.2"
          stroke-linecap="round"
          stroke-linejoin="round">
        </polyline>
        <polyline
          points="14,5 18,5 18,9"
          stroke="currentColor"
          stroke-width="2.2"
          stroke-linecap="round"
          stroke-linejoin="round">
        </polyline>
      </svg>
    </span>
    <span class="public-brand-copy">
      <strong>LUMI5 LABS</strong>
      <span>Inspire, Innovate, Impact</span>
    </span>
  </a>
  <nav class="public-nav" aria-label="Primary navigation">
    <a href="index.html">Home</a>
    <a href="about.html">About</a>
    <a href="https://www.lumi5labs.com/portfolio/">Portfolio</a>
    <a href="https://www.lumi5labs.com/blog/">Blog</a>
    <a href="https://www.lumi5labs.com/faq/">FAQ</a>
    <a href="contact.html">Contact</a>
  </nav>
  <div class="public-auth-actions">
    <a class="public-signin" href="signin.html">Sign in</a>
    <a class="btn btn-primary" href="signup.html">Sign up</a>
  </div>
  <details class="public-menu">
    <summary>Menu</summary>
    <nav aria-label="Compact primary navigation">
      <a href="index.html">Home</a>
      <a href="about.html">About</a>
      <a href="https://www.lumi5labs.com/portfolio/">Portfolio</a>
      <a href="https://www.lumi5labs.com/blog/">Blog</a>
      <a href="https://www.lumi5labs.com/faq/">FAQ</a>
      <a href="contact.html">Contact</a>
      <a href="signin.html">Sign in</a>
      <a href="signup.html">Sign up</a>
    </nav>
  </details>
</header>
```

Use this exact footer information in both pages, then close each document with `</body></html>` after its page scripts:

```html
<footer class="public-footer">
  <div class="public-footer-grid">
    <section>
      <h2>LUMI5 LABS</h2>
      <p>A venture studio and innovation lab based in Singapore, fueling the growth of technology startups with expert guidance and funding.</p>
    </section>
    <nav aria-label="Footer navigation">
      <h2>Navigate</h2>
      <a href="index.html">Home</a>
      <a href="about.html">About</a>
      <a href="https://www.lumi5labs.com/portfolio/">Portfolio</a>
      <a href="https://www.lumi5labs.com/blog/">Blog</a>
      <a href="https://www.lumi5labs.com/faq/">FAQ</a>
      <a href="contact.html">Contact</a>
    </nav>
    <address>
      <h2>Visit &amp; contact</h2>
      <a href="https://www.google.com/maps/search/?api=1&amp;query=1%20Fullerton%20Rd%20Singapore%20049213">1 Fullerton Rd, #02-01 One Fullerton<br>Singapore 049213</a>
      <a href="mailto:business@lumi5labs.com">business@lumi5labs.com</a>
      <a href="tel:+6565991991">+65-6599-1991</a>
    </address>
    <section class="public-socials">
      <h2>Follow</h2>
      <a href="https://www.linkedin.com/company/lumi5-labs/">LinkedIn</a>
      <a href="https://www.instagram.com/lumi5labs/">Instagram</a>
      <a href="https://bsky.app/profile/lumi5labs.bsky.social">Bluesky</a>
      <a href="https://www.facebook.com/profile.php?id=61575224522339">Facebook</a>
    </section>
  </div>
  <div class="public-footer-meta">
    <span>Copyright © 2026 LUMI5 LABS</span>
    <span>v26.02.13.1</span>
  </div>
</footer>
```

- [ ] **Step 5: Create the complete About page**

Create `about.html` with `body class="public-content-page about-page"`, one `<h1>Ideas grow through connection.</h1>`, the shared header/footer, and these five semantic sections:

```html
<main>
  <section class="public-hero about-hero" aria-labelledby="about-title">
    <div class="public-hero-copy">
      <p class="section-eyebrow">01 · Our Story</p>
      <p class="public-kicker">About Lumi5 Labs</p>
      <h1 id="about-title">Ideas grow through connection.</h1>
      <p>Lumi5 Labs is a venture studio and innovation lab connecting visionary founders with strategic guidance, technology, and capital to create meaningful impact.</p>
      <ul class="public-chip-list" aria-label="Lumi5 Labs context">
        <li>Singapore</li>
        <li>Venture building</li>
        <li>Meaningful impact</li>
      </ul>
    </div>
    <figure class="story-orbit" aria-label="Lumi5 Labs connects founders, capital, technology, and meaningful impact.">
      <span class="story-orbit-core" aria-hidden="true">L5</span>
      <span class="story-orbit-ring story-orbit-ring-one" aria-hidden="true"></span>
      <span class="story-orbit-ring story-orbit-ring-two" aria-hidden="true"></span>
      <span class="story-orbit-node node-founders" aria-hidden="true">Founders</span>
      <span class="story-orbit-node node-capital" aria-hidden="true">Capital</span>
      <span class="story-orbit-node node-technology" aria-hidden="true">Technology</span>
      <span class="story-orbit-node node-impact" aria-hidden="true">Impact</span>
    </figure>
  </section>

  <section class="public-section about-journey" aria-labelledby="journey-title">
    <header>
      <p class="section-eyebrow">02 · Journey</p>
      <h2 id="journey-title">Our Inspiring Journey</h2>
    </header>
    <div class="public-prose">
      <p>In a world where innovation knows no bounds, two visionary leaders, Raveen Beemsingh and Victor Chow, embarked on a journey to create something extraordinary. Raveen, the co-founder of Hammerhead, had already made his mark by developing cutting-edge software solutions and mentoring startups through Techstars. Meanwhile, Victor, with his extensive background in SingTel-NCS, Huawei, Fatfish Group, and InspirAsia Fintech Accelerator, had a proven track record of fostering entrepreneurship and growth.</p>
      <p>Their paths converged when they decided to establish Lumi5 Labs, a venture studio and innovation lab dedicated to investing in, nurturing, and transforming startups, small businesses, and large corporations. This collaboration was not just about combining their expertise; it was about creating a platform where their collective knowledge could empower others.</p>
      <p>Raveen brought his technical prowess and entrepreneurial spirit, while Victor contributed his strategic insights and experience in scaling businesses across diverse regions. Together, they crafted a unique ecosystem where startups could flourish and established companies could innovate. Lumi5 Labs became a beacon for those seeking to disrupt industries and redefine success.</p>
    </div>
  </section>
```

Continue the same `<main>` with the complete Vision, Leadership, and Connect sections:

```html
  <section class="public-section about-vision" aria-labelledby="vision-title">
    <header>
      <p class="section-eyebrow">03 · Vision</p>
      <h2 id="vision-title">A Legacy of Innovation and Inspiration</h2>
    </header>
    <div class="vision-grid">
      <article class="vision-card">
        <span aria-hidden="true">01</span>
        <p>Raveen Beemsingh and Victor Chow, founders of Lumi5 Labs, aimed to create a global legacy of innovation and inspiration. Their vision extended beyond startups to a global network of innovation labs, empowering entrepreneurs and businesses.</p>
      </article>
      <article class="vision-card">
        <span aria-hidden="true">02</span>
        <p>They are seeking strategic corporate partners to launch the Lumi5 Foundation, offering educational programs and investing in sustainable ventures addressing global challenges.</p>
      </article>
      <article class="vision-card">
        <span aria-hidden="true">03</span>
        <p>Quarterly Lumi5 workshops brought together thought leaders and startup founders to share ideas and celebrate innovation. Their mission wasn't just about profits—it was about uplifting communities, driving sustainability, and creating lasting impact.</p>
      </article>
      <article class="vision-card">
        <span aria-hidden="true">04</span>
        <p>Raveen and Victor want to transform Lumi5 Labs into a movement, inspiring future generations to innovate and shape a better world.</p>
      </article>
    </div>
  </section>

  <section class="public-section about-leadership" aria-labelledby="leadership-title">
    <header>
      <p class="section-eyebrow">04 · Leadership</p>
      <h2 id="leadership-title">The Team</h2>
    </header>
    <div class="leadership-grid">
      <article class="leader-card">
        <img src="images/raveen.webp" alt="Raveen Beemsingh, CEO and CTO of Lumi5 Labs" width="600" height="600" loading="lazy" decoding="async">
        <div class="leader-copy">
          <h3>Raveen Beemsingh</h3>
          <p class="leader-role">CEO &amp; CTO</p>
          <p>Raveen Beemsingh is a 2-time exited entrepreneur and technology leader with over two decades of experience in software development and technology ventures. His entrepreneurial journey includes co-founding Hammerhead, a cycling technology company, where he served as Chief Technology Officer and led the company through the TechStars accelerator program. The company was later acquired by SRAM.</p>
          <p>Recently Raveen co-founded Lumi5 Labs with Victor, contributing his expertise to innovative projects. Prior to his current role, he was the CTO at Leadzen.ai. He has also co-founded LuminaryLane, an AI brand builder. His expertise spans Hardware, Gen AI and 0-to-1 product building. Raveen actively mentors startups through Techstars.</p>
          <nav class="leader-links" aria-label="Raveen Beemsingh profiles">
            <a href="https://www.linkedin.com/in/raveenbeemsingh/">LinkedIn</a>
            <a href="https://x.com/rbmsingh">X</a>
            <a href="https://www.instagram.com/raveenb/">Instagram</a>
            <a href="https://raveenb.lumi5labs.com/">Personal blog</a>
          </nav>
        </div>
      </article>

      <article class="leader-card">
        <img src="images/victor.webp" alt="Victor Chow, COO and CMO of Lumi5 Labs" width="600" height="600" loading="lazy" decoding="async">
        <div class="leader-copy">
          <h3>Victor Chow</h3>
          <p class="leader-role">COO &amp; CMO</p>
          <p>Victor Chow is a seasoned entrepreneur and corporate leader with over 30 years of experience in investments, startups, telecommunications, cloud computing and blockchain technologies. He has held C-level positions across general management, strategic planning, and global operations in Asia Pacific, Europe, and North America.</p>
          <p>Victor's roles include CEO of Aristagora International, a multi-family office subsidiary of Aristagora Advisors based in Tokyo. He also served as Venture Partner for Fatfish Group. Previously, Victor was the Global COO for Cloud Computing at Huawei Technologies and the Global Business Director for SingTel-NCS Group. His expertise in fintech led him to become the Founding CEO of InspirAsia Fintech Accelerator.</p>
          <nav class="leader-links" aria-label="Victor Chow profiles">
            <a href="https://www.linkedin.com/in/victorchowsingapore/">LinkedIn</a>
            <a href="https://victorc.lumi5labs.com/">Personal blog</a>
          </nav>
        </div>
      </article>
    </div>
  </section>

  <section class="public-section about-connect" aria-labelledby="connect-title">
    <p class="section-eyebrow">05 · Connect</p>
    <h2 id="connect-title">Let's Innovate Together</h2>
    <p>Connect with us to explore how we can make your vision a reality. Join us in shaping the future.</p>
    <a class="btn btn-primary" href="contact.html">Get Started</a>
  </section>
</main>
```

No prose may be shortened; the literal assertions written in Step 1 are the completion checklist.

- [ ] **Step 6: Create the complete Contact page**

Create `contact.html` with `body class="public-content-page contact-page"`, the shared shell, and this structure:

```html
<main>
  <section class="public-hero contact-hero" aria-labelledby="contact-title">
    <div class="public-hero-copy">
      <p class="section-eyebrow">01 · Connect</p>
      <h1 id="contact-title">Contact Us</h1>
      <p>Here is how you can contact us for any questions or concerns.</p>
    </div>
    <figure class="story-orbit contact-orbit" aria-label="Connect with Lumi5 Labs by visiting, emailing, calling, or sending a website message.">
      <span class="story-orbit-core" aria-hidden="true">L5</span>
      <span class="story-orbit-ring story-orbit-ring-one" aria-hidden="true"></span>
      <span class="story-orbit-ring story-orbit-ring-two" aria-hidden="true"></span>
      <span class="story-orbit-node node-visit" aria-hidden="true">Visit</span>
      <span class="story-orbit-node node-email" aria-hidden="true">Email</span>
      <span class="story-orbit-node node-call" aria-hidden="true">Call</span>
    </figure>
  </section>

  <section class="public-section contact-layout" aria-labelledby="contact-details-title">
    <div class="contact-details">
      <p class="section-eyebrow">02 · Details</p>
      <h2 id="contact-details-title">Get in Touch</h2>
      <address>
        <a href="https://www.google.com/maps/search/?api=1&amp;query=1%20Fullerton%20Rd%20Singapore%20049213">1 Fullerton Rd, #02-01 One Fullerton<br>Singapore 049213</a>
        <a href="tel:+6565991991">+65-6599-1991</a>
        <a href="mailto:business@lumi5labs.com">business@lumi5labs.com</a>
      </address>
      <div class="contact-map">
        <iframe
          title="Lumi5 Labs office location at One Fullerton, Singapore"
          src="https://www.google.com/maps?q=1%20Fullerton%20Rd%2C%20Singapore%20049213&amp;output=embed"
          loading="lazy"
          referrerpolicy="no-referrer-when-downgrade"></iframe>
        <a href="https://www.google.com/maps/search/?api=1&amp;query=1%20Fullerton%20Rd%20Singapore%20049213">Open in Google Maps</a>
      </div>
    </div>

    <form class="contact-form" id="contact-form" novalidate>
      <div class="form-group">
        <label for="contact-name">Name</label>
        <input id="contact-name" name="name" type="text" maxlength="100" placeholder="Your name" autocomplete="name" required aria-describedby="contact-name-error">
        <p class="form-error-text" id="contact-name-error"></p>
      </div>
      <div class="form-group">
        <label for="contact-email">Email</label>
        <input id="contact-email" name="email" type="email" maxlength="255" placeholder="your@email.com" autocomplete="email" required aria-describedby="contact-email-error">
        <p class="form-error-text" id="contact-email-error"></p>
      </div>
      <div class="form-group">
        <label for="contact-message">Message <span>(optional)</span></label>
        <textarea id="contact-message" name="message" maxlength="5000" placeholder="How can we help you?" aria-describedby="contact-message-error"></textarea>
        <p class="form-error-text" id="contact-message-error"></p>
      </div>
      <div class="contact-honeypot" aria-hidden="true">
        <label for="contact-company-website">Company website</label>
        <input id="contact-company-website" name="company_website" type="text" tabindex="-1" autocomplete="off" aria-hidden="true">
      </div>
      <button class="btn btn-primary" id="contact-submit" type="submit" disabled>Send Message</button>
      <p class="form-message" id="contact-status" role="status" aria-live="polite" tabindex="-1"></p>
    </form>
  </section>
</main>
<script src="js/api.js?v=20260727.2"></script>
<script src="js/contact.js?v=20260727.1"></script>
```

- [ ] **Step 7: Run content contracts and local-link regression**

Run:

```bash
node --test backend/test/public-content-pages.test.js backend/test/frontend-flow-contract.test.js
```

Expected: PASS with every required source string, local target, portrait reference, map fallback, and form hook present.

- [ ] **Step 8: Commit the semantic pages and official assets**

```bash
git add about.html contact.html images/raveen.webp images/victor.webp backend/test/public-content-pages.test.js
git commit -m "feat(public): add complete about and contact pages"
```

## Task 4: Orbit Story Visual System and Responsive Behavior

**Files:**

- Modify: `css/style.css`
- Modify: `backend/test/public-content-pages.test.js`

**Interfaces:**

- Consumes: the class and element contracts created in Task 3.
- Produces: page-scoped Orbit Story presentation at desktop, compact, and narrow widths; no selector changes the existing application pages.

- [ ] **Step 1: Add failing stylesheet contract tests**

Append to `backend/test/public-content-pages.test.js`:

```js
test('public content CSS is scoped, responsive, keyboard visible and motion safe', () => {
  const css = read('css/style.css');
  assert.match(css, /\/\* PUBLIC CONTENT PAGES \(ABOUT \/ CONTACT\) \*\//);
  for (const selector of [
    'body.public-content-page',
    '.public-content-page .public-header',
    '.public-content-page .public-nav',
    '.public-content-page .public-menu',
    '.public-content-page .public-hero',
    '.public-content-page .story-orbit',
    '.public-content-page .about-journey',
    '.public-content-page .about-vision',
    '.public-content-page .vision-grid',
    '.public-content-page .leadership-grid',
    '.public-content-page .contact-layout',
    '.public-content-page .contact-map',
    '.public-content-page .contact-form',
    '.public-content-page .public-footer',
  ]) {
    assert.ok(css.includes(selector), selector);
  }
  assert.match(css, /\.public-content-page :focus-visible\s*\{[^}]*outline:/s);
  assert.match(css, /\.public-content-page \.contact-honeypot\s*\{[^}]*position:\s*absolute[^}]*clip:/s);
  assert.match(
    css,
    /@media \(max-width:\s*979px\)[\s\S]*?\.public-content-page \.public-nav\s*\{[^}]*display:\s*none[\s\S]*?\.public-content-page \.public-menu\s*\{[^}]*display:\s*block/s,
  );
  assert.match(
    css,
    /\.public-content-page \.about-vision\s*\{[^}]*grid-template-columns:\s*minmax\(250px,\s*0\.75fr\)\s+minmax\(0,\s*1\.25fr\)/s,
  );
  assert.match(
    css,
    /@media \(max-width:\s*660px\)[\s\S]*?\.public-content-page \.leadership-grid\s*\{[^}]*grid-template-columns:\s*1fr/s,
  );
  assert.match(
    css,
    /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.public-content-page \.story-orbit-node\s*\{[^}]*animation:\s*none/s,
  );
  assert.match(css, /min-height:\s*44px/);
});
```

- [ ] **Step 2: Run the style contract and confirm the red state**

Run:

```bash
node --test backend/test/public-content-pages.test.js
```

Expected: FAIL because the `PUBLIC CONTENT PAGES` stylesheet block is absent.

- [ ] **Step 3: Add the shared public-content foundation**

Append a single scoped block to `css/style.css` after the landing-page styles and before the Admin Pages section:

```css
/* PUBLIC CONTENT PAGES (ABOUT / CONTACT) */
body.public-content-page {
  --public-navy: #0b1024;
  --public-indigo: #465ff0;
  --public-indigo-deep: #293ea8;
  --public-green: #4fa575;
  --public-ink: #121a2b;
  --public-muted: #687084;
  --public-line: #e2e5ec;
  --public-wash: #f5f6fb;
  margin: 0;
  min-width: 0;
  overflow-x: hidden;
  color: var(--public-ink);
  background: var(--public-wash);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.public-content-page *,
.public-content-page *::before,
.public-content-page *::after {
  box-sizing: border-box;
}

.public-content-page a {
  color: inherit;
}

.public-content-page :focus-visible {
  outline: 3px solid #86a0ff;
  outline-offset: 3px;
  border-radius: 6px;
}

.public-content-page .public-header {
  position: relative;
  z-index: 10;
  min-height: 86px;
  display: grid;
  grid-template-columns: minmax(240px, auto) 1fr auto;
  align-items: center;
  gap: 28px;
  padding: 16px clamp(24px, 5vw, 80px);
  color: #fff;
  background: var(--public-navy);
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
}

.public-content-page .public-brand {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  width: max-content;
  text-decoration: none;
}

.public-content-page .public-brand svg {
  width: 48px;
  height: 48px;
  flex: 0 0 auto;
}

.public-content-page .public-brand-copy {
  display: grid;
  gap: 2px;
}

.public-content-page .public-brand-copy strong {
  font-size: 0.96rem;
  letter-spacing: 0.09em;
}

.public-content-page .public-brand-copy span {
  color: #b8c1d8;
  font-size: 0.74rem;
}

.public-content-page .public-nav,
.public-content-page .public-auth-actions {
  display: flex;
  align-items: center;
  gap: 20px;
}

.public-content-page .public-nav {
  justify-content: center;
}

.public-content-page .public-nav a,
.public-content-page .public-signin {
  color: #dce2f1;
  font-weight: 650;
  text-decoration: none;
}

.public-content-page .public-nav a:hover,
.public-content-page .public-nav a[aria-current="page"],
.public-content-page .public-signin:hover {
  color: #fff;
}

.public-content-page .public-nav a[aria-current="page"] {
  text-decoration: underline;
  text-decoration-color: var(--public-green);
  text-decoration-thickness: 3px;
  text-underline-offset: 8px;
}

.public-content-page .public-menu {
  display: none;
  position: relative;
}

.public-content-page .public-menu summary {
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  padding: 9px 14px;
  cursor: pointer;
  color: #fff;
  border: 1px solid rgba(255, 255, 255, 0.28);
  border-radius: 12px;
  font-weight: 700;
  list-style: none;
}

.public-content-page .public-menu summary::-webkit-details-marker {
  display: none;
}

.public-content-page .public-menu nav {
  position: absolute;
  top: calc(100% + 10px);
  right: 0;
  width: min(280px, calc(100vw - 32px));
  display: grid;
  gap: 2px;
  padding: 10px;
  color: var(--public-ink);
  background: #fff;
  border: 1px solid var(--public-line);
  border-radius: 16px;
  box-shadow: 0 18px 55px rgba(6, 12, 35, 0.22);
}

.public-content-page .public-menu nav a {
  min-height: 44px;
  display: flex;
  align-items: center;
  padding: 8px 12px;
  border-radius: 10px;
  text-decoration: none;
  font-weight: 650;
}

.public-content-page .public-menu nav a:hover,
.public-content-page .public-menu nav a[aria-current="page"] {
  color: var(--public-indigo-deep);
  background: #eef1ff;
}

.public-content-page .public-hero {
  min-height: 620px;
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(420px, 0.95fr);
  align-items: center;
  gap: clamp(40px, 7vw, 110px);
  padding: clamp(72px, 9vw, 132px) clamp(24px, 8vw, 132px);
  color: #fff;
  background:
    radial-gradient(circle at 75% 35%, rgba(70, 95, 240, 0.36), transparent 32%),
    linear-gradient(135deg, #0b1024 0%, #151f4f 56%, #293ea8 100%);
}

.public-content-page .public-hero-copy {
  max-width: 720px;
}

.public-content-page .section-eyebrow {
  margin: 0 0 18px;
  color: var(--public-green);
  font-size: 0.8rem;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.public-content-page .public-kicker {
  margin: 0 0 12px;
  color: #c8d0e4;
  font-size: 1.05rem;
  font-weight: 700;
}

.public-content-page .public-hero h1 {
  max-width: 820px;
  margin: 0;
  font-size: clamp(3.1rem, 7vw, 6.9rem);
  line-height: 0.96;
  letter-spacing: -0.055em;
}

.public-content-page .public-hero-copy > p:last-of-type {
  max-width: 660px;
  margin: 28px 0 0;
  color: #d9dfef;
  font-size: clamp(1.05rem, 1.6vw, 1.28rem);
  line-height: 1.7;
}

.public-content-page .public-chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  padding: 0;
  margin: 30px 0 0;
  list-style: none;
}

.public-content-page .public-chip-list li {
  padding: 9px 13px;
  color: #f1f4ff;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 999px;
  font-size: 0.86rem;
  font-weight: 700;
}

.public-content-page .story-orbit {
  position: relative;
  width: min(100%, 520px);
  aspect-ratio: 1;
  justify-self: center;
  margin: 0;
}

.public-content-page .story-orbit-core,
.public-content-page .story-orbit-ring,
.public-content-page .story-orbit-node {
  position: absolute;
}

.public-content-page .story-orbit-core {
  inset: 50% auto auto 50%;
  width: 86px;
  height: 86px;
  display: grid;
  place-items: center;
  transform: translate(-50%, -50%);
  color: #fff;
  background: var(--public-green);
  border: 10px solid rgba(255, 255, 255, 0.1);
  border-radius: 50%;
  background-clip: padding-box;
  font-size: 1.4rem;
  font-weight: 850;
}

.public-content-page .story-orbit-ring {
  inset: 50% auto auto 50%;
  border: 1px solid rgba(255, 255, 255, 0.28);
  border-radius: 50%;
  transform: translate(-50%, -50%);
}

.public-content-page .story-orbit-ring-one {
  width: 56%;
  height: 56%;
}

.public-content-page .story-orbit-ring-two {
  width: 88%;
  height: 88%;
}

.public-content-page .story-orbit-node {
  min-width: 94px;
  min-height: 44px;
  display: grid;
  place-items: center;
  padding: 8px 14px;
  color: #fff;
  background: rgba(11, 16, 36, 0.84);
  border: 1px solid rgba(255, 255, 255, 0.34);
  border-radius: 999px;
  box-shadow: 0 15px 35px rgba(4, 9, 30, 0.28);
  font-size: 0.82rem;
  font-weight: 750;
  animation: publicOrbitFloat 5.5s ease-in-out infinite;
}

.public-content-page .node-founders,
.public-content-page .node-visit {
  top: 8%;
  left: 44%;
}

.public-content-page .node-capital,
.public-content-page .node-email {
  top: 45%;
  right: 0;
  animation-delay: -1.2s;
}

.public-content-page .node-technology,
.public-content-page .node-call {
  bottom: 6%;
  left: 32%;
  animation-delay: -2.4s;
}

.public-content-page .node-impact {
  top: 45%;
  left: 0;
  animation-delay: -3.6s;
}

@keyframes publicOrbitFloat {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-8px); }
}
```

- [ ] **Step 4: Add the About, Contact, and footer layouts**

Continue the same scoped block:

```css
.public-content-page .public-section {
  padding: clamp(72px, 9vw, 132px) clamp(24px, 8vw, 132px);
}

.public-content-page .public-section > header h2,
.public-content-page .contact-details h2 {
  max-width: 650px;
  margin: 0;
  color: var(--public-ink);
  font-size: clamp(2.2rem, 4.8vw, 4.7rem);
  line-height: 1.03;
  letter-spacing: -0.045em;
}

.public-content-page .about-journey {
  display: grid;
  grid-template-columns: minmax(250px, 0.75fr) minmax(0, 1.25fr);
  gap: clamp(48px, 8vw, 130px);
  background: #fff;
}

.public-content-page .public-prose {
  display: grid;
  gap: 24px;
}

.public-content-page .public-prose p,
.public-content-page .leader-copy p {
  margin: 0;
  color: #475168;
  font-size: 1.04rem;
  line-height: 1.85;
}

.public-content-page .about-vision {
  display: grid;
  grid-template-columns: minmax(250px, 0.75fr) minmax(0, 1.25fr);
  gap: clamp(48px, 8vw, 130px);
  background: #eef1fb;
}

.public-content-page .vision-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
  margin: 0;
}

.public-content-page .vision-card {
  position: relative;
  min-height: 260px;
  padding: 34px;
  background: #fff;
  border: 1px solid #dfe3ef;
  border-radius: 24px;
  box-shadow: 0 14px 38px rgba(31, 45, 94, 0.08);
}

.public-content-page .vision-card span {
  display: inline-grid;
  width: 44px;
  height: 44px;
  place-items: center;
  color: #fff;
  background: var(--public-indigo);
  border-radius: 50%;
  font-weight: 800;
}

.public-content-page .vision-card p {
  margin: 28px 0 0;
  color: #3f4960;
  line-height: 1.75;
}

.public-content-page .leadership-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 28px;
  margin-top: 52px;
}

.public-content-page .leader-card {
  overflow: hidden;
  background: #fff;
  border: 1px solid var(--public-line);
  border-radius: 28px;
  box-shadow: 0 20px 52px rgba(31, 45, 94, 0.1);
}

.public-content-page .leader-card img {
  width: 100%;
  aspect-ratio: 1;
  display: block;
  object-fit: cover;
}

.public-content-page .leader-copy {
  display: grid;
  gap: 18px;
  padding: 34px;
}

.public-content-page .leader-copy h3 {
  margin: 0;
  font-size: 1.8rem;
}

.public-content-page .leader-role {
  margin: -10px 0 0;
  color: var(--public-indigo-deep);
  font-weight: 800;
}

.public-content-page .leader-links,
.public-content-page .public-socials {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 18px;
}

.public-content-page .leader-links a,
.public-content-page .public-socials a {
  color: var(--public-indigo-deep);
  font-weight: 750;
}

.public-content-page .about-connect {
  color: #fff;
  text-align: center;
  background: var(--public-navy);
}

.public-content-page .about-connect h2 {
  margin: 0;
  font-size: clamp(2.5rem, 6vw, 5.6rem);
}

.public-content-page .about-connect p {
  max-width: 660px;
  margin: 24px auto 34px;
  color: #d7deee;
  font-size: 1.08rem;
  line-height: 1.7;
}

.public-content-page .contact-layout {
  display: grid;
  grid-template-columns: minmax(0, 0.95fr) minmax(420px, 1.05fr);
  gap: clamp(40px, 7vw, 100px);
  background: #fff;
}

.public-content-page .contact-details address {
  display: grid;
  gap: 16px;
  margin-top: 34px;
  font-style: normal;
}

.public-content-page .contact-details address a {
  width: fit-content;
  color: #38435a;
  font-weight: 700;
  line-height: 1.6;
}

.public-content-page .contact-map {
  overflow: hidden;
  margin-top: 36px;
  background: var(--public-wash);
  border: 1px solid var(--public-line);
  border-radius: 24px;
}

.public-content-page .contact-map iframe {
  width: 100%;
  min-height: 320px;
  display: block;
  border: 0;
}

.public-content-page .contact-map > a {
  min-height: 44px;
  display: flex;
  align-items: center;
  padding: 12px 18px;
  color: var(--public-indigo-deep);
  font-weight: 750;
}

.public-content-page .contact-form {
  align-self: start;
  display: grid;
  gap: 22px;
  padding: clamp(26px, 4vw, 48px);
  background: var(--public-wash);
  border: 1px solid var(--public-line);
  border-radius: 28px;
  box-shadow: 0 20px 52px rgba(31, 45, 94, 0.09);
}

.public-content-page .contact-form label {
  display: block;
  margin-bottom: 8px;
  font-weight: 750;
}

.public-content-page .contact-form label span {
  color: var(--public-muted);
  font-weight: 600;
}

.public-content-page .contact-form input,
.public-content-page .contact-form textarea {
  width: 100%;
  min-height: 48px;
  padding: 12px 14px;
  color: var(--public-ink);
  background: #fff;
  border: 1px solid #cdd3df;
  border-radius: 12px;
  font: inherit;
}

.public-content-page .contact-form textarea {
  min-height: 150px;
  resize: vertical;
}

.public-content-page .contact-form [aria-invalid="true"] {
  border-color: #b42318;
}

.public-content-page .form-error-text {
  min-height: 20px;
  margin: 6px 0 0;
  color: #9d2118;
  font-size: 0.84rem;
}

.public-content-page .form-message {
  min-height: 24px;
  margin: 0;
  color: #38435a;
  font-weight: 700;
}

.public-content-page .form-message.success {
  color: #286745;
}

.public-content-page .form-message.error {
  color: #9d2118;
}

.public-content-page .contact-honeypot {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  white-space: nowrap;
}

.public-content-page .contact-form .btn,
.public-content-page .public-auth-actions .btn,
.public-content-page .about-connect .btn {
  min-height: 44px;
}

.public-content-page .public-footer {
  padding: 64px clamp(24px, 8vw, 132px) 24px;
  color: #d9dfef;
  background: #080c1b;
}

.public-content-page .public-footer-grid {
  display: grid;
  grid-template-columns: 1.4fr repeat(3, minmax(150px, 0.7fr));
  gap: 38px;
}

.public-content-page .public-footer h2 {
  margin: 0 0 18px;
  color: #fff;
  font-size: 0.9rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.public-content-page .public-footer p {
  max-width: 450px;
  margin: 0;
  line-height: 1.75;
}

.public-content-page .public-footer nav,
.public-content-page .public-footer address {
  display: grid;
  align-content: start;
  gap: 10px;
  font-style: normal;
}

.public-content-page .public-footer a {
  color: #d9dfef;
  text-decoration-color: rgba(217, 223, 239, 0.4);
}

.public-content-page .public-footer-meta {
  display: flex;
  justify-content: space-between;
  gap: 24px;
  padding-top: 24px;
  margin-top: 48px;
  color: #9ea8bf;
  border-top: 1px solid rgba(255, 255, 255, 0.12);
  font-size: 0.84rem;
}
```

- [ ] **Step 5: Add exact compact, narrow, and reduced-motion behavior**

Finish the block:

```css
@media (max-width: 979px) {
  .public-content-page .public-header {
    grid-template-columns: 1fr auto auto;
    gap: 14px;
    padding-inline: 24px;
  }

  .public-content-page .public-nav {
    display: none;
  }

  .public-content-page .public-menu {
    display: block;
    grid-column: 2;
    grid-row: 1;
  }

  .public-content-page .public-auth-actions {
    grid-column: 3;
    grid-row: 1;
  }

  .public-content-page .public-auth-actions .public-signin {
    display: none;
  }

  .public-content-page .public-hero,
  .public-content-page .about-journey,
  .public-content-page .about-vision,
  .public-content-page .contact-layout {
    grid-template-columns: 1fr;
  }

  .public-content-page .public-hero {
    min-height: auto;
  }

  .public-content-page .story-orbit {
    width: min(76vw, 500px);
  }

  .public-content-page .public-footer-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 660px) {
  .public-content-page .public-header {
    grid-template-columns: minmax(0, 1fr) auto auto;
    padding: 12px 16px;
  }

  .public-content-page .public-brand-copy span {
    display: none;
  }

  .public-content-page .public-brand svg {
    width: 42px;
    height: 42px;
  }

  .public-content-page .public-auth-actions .btn {
    padding-inline: 12px;
  }

  .public-content-page .public-hero,
  .public-content-page .public-section {
    padding-inline: 20px;
  }

  .public-content-page .public-hero h1 {
    font-size: clamp(2.7rem, 15vw, 4.5rem);
  }

  .public-content-page .story-orbit {
    width: min(92vw, 420px);
  }

  .public-content-page .vision-grid,
  .public-content-page .leadership-grid,
  .public-content-page .public-footer-grid {
    grid-template-columns: 1fr;
  }

  .public-content-page .vision-card,
  .public-content-page .leader-copy,
  .public-content-page .contact-form {
    padding: 24px;
  }

  .public-content-page .contact-map iframe {
    min-height: 260px;
  }

  .public-content-page .public-footer-meta {
    flex-direction: column;
  }
}

@media (prefers-reduced-motion: reduce) {
  .public-content-page .story-orbit-node {
    animation: none;
  }

  .public-content-page *,
  .public-content-page *::before,
  .public-content-page *::after {
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
  }
}
```

- [ ] **Step 6: Run page/style contracts**

Run:

```bash
node --test backend/test/public-content-pages.test.js backend/test/frontend-flow-contract.test.js
```

Expected: PASS, including exact 979px and 660px breakpoints, native compact navigation, 44px targets, visible focus, and reduced motion.

- [ ] **Step 7: Commit the visual system**

```bash
git add css/style.css backend/test/public-content-pages.test.js
git commit -m "feat(public): style orbit story pages"
```

## Task 5: Contact API Client and Accessible Form State Machine

**Files:**

- Create: `js/contact.js`
- Create: `backend/test/contact-client.test.js`
- Modify: `js/api.js`
- Modify: `backend/test/api-client.test.js`

**Interfaces:**

- Consumes: `API.submitContact(payload): Promise<{message: string}>`, the stable Contact DOM IDs from Task 3, and route payload fields `name`, `email`, `message`, `company_website`.
- Produces: `validateContactPayload(payload): Record<string,string>` and `initializeContactForm({root?,api?}): {syncEligibility(): void}|null`.

- [ ] **Step 1: Add the failing API-client contract**

Append to `backend/test/api-client.test.js`:

```js
test('submitContact posts the exact public payload to the shared API', async () => {
  const client = clientHarness();
  const requests = [];
  client.context.fetch = async (url, options) => {
    requests.push({ url, options });
    return response(201, { message: 'Message received' });
  };

  const result = await client.run(`
    API.submitContact({
      name: 'Visitor',
      email: 'visitor@example.com',
      message: 'Hello',
      company_website: ''
    })
  `);

  assert.equal(result.message, 'Message received');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/contact');
  assert.equal(requests[0].options.method, 'POST');
  assert.equal(requests[0].options.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    name: 'Visitor',
    email: 'visitor@example.com',
    message: 'Hello',
    company_website: '',
  });
});
```

- [ ] **Step 2: Write failing Contact client state tests**

Create `backend/test/contact-client.test.js` with a VM harness matching the repository's existing vanilla-client tests:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '..', '..', 'js', 'contact.js'),
  'utf8',
).replace(/\ninitializeContactForm\(\);\s*$/, '\n');

function element(value = '') {
  return {
    value,
    disabled: false,
    textContent: '',
    className: '',
    attributes: {},
    listeners: {},
    focused: 0,
    addEventListener(name, handler) { this.listeners[name] = handler; },
    setAttribute(name, nextValue) { this.attributes[name] = String(nextValue); },
    removeAttribute(name) { delete this.attributes[name]; },
    focus() { this.focused += 1; },
  };
}

function formHarness({ apiResult = { message: 'Message received' } } = {}) {
  const ids = [
    'contact-form',
    'contact-name',
    'contact-name-error',
    'contact-email',
    'contact-email-error',
    'contact-message',
    'contact-message-error',
    'contact-company-website',
    'contact-submit',
    'contact-status',
  ];
  const nodes = new Map(ids.map((id) => [id, element()]));
  const form = nodes.get('contact-form');
  form.reset = () => {
    for (const id of [
      'contact-name',
      'contact-email',
      'contact-message',
      'contact-company-website',
    ]) {
      nodes.get(id).value = '';
    }
  };
  const calls = [];
  const api = {
    async submitContact(payload) {
      calls.push(payload);
      if (apiResult instanceof Error) throw apiResult;
      return apiResult;
    },
  };
  const root = { getElementById: (id) => nodes.get(id) || null };
  const context = vm.createContext({ document: root, API: api, console });
  vm.runInContext(source, context);
  context.initializeContactForm({ root, api });
  return {
    calls,
    context,
    nodes,
    input() {
      form.listeners.input({ target: form });
    },
    async submit() {
      await form.listeners.submit({ preventDefault() {} });
    },
  };
}

test('button eligibility follows the two required fields without showing errors', () => {
  const client = formHarness();
  const button = client.nodes.get('contact-submit');
  assert.equal(button.disabled, true);

  client.nodes.get('contact-name').value = 'Visitor';
  client.nodes.get('contact-email').value = 'visitor@example.com';
  client.input();

  assert.equal(button.disabled, false);
  assert.equal(client.nodes.get('contact-name-error').textContent, '');
  assert.equal(client.nodes.get('contact-email-error').textContent, '');
});

test('invalid submit renders field guidance and focuses the first invalid field', async () => {
  const client = formHarness();
  client.nodes.get('contact-name').value = ' ';
  client.nodes.get('contact-email').value = 'invalid';
  await client.submit();

  assert.equal(client.calls.length, 0);
  assert.equal(client.nodes.get('contact-name-error').textContent, 'Enter your name.');
  assert.equal(client.nodes.get('contact-email-error').textContent, 'Enter a valid email address.');
  assert.equal(client.nodes.get('contact-name').attributes['aria-invalid'], 'true');
  assert.equal(client.nodes.get('contact-name').focused, 1);
});

test('success submits once, clears fields and focuses the live status', async () => {
  const client = formHarness();
  client.nodes.get('contact-name').value = ' Visitor ';
  client.nodes.get('contact-email').value = ' visitor@example.com ';
  client.nodes.get('contact-message').value = ' Hello ';
  client.nodes.get('contact-company-website').value = '';
  await client.submit();

  assert.deepEqual(client.calls, [{
    name: 'Visitor',
    email: 'visitor@example.com',
    message: 'Hello',
    company_website: '',
  }]);
  assert.equal(client.nodes.get('contact-name').value, '');
  assert.equal(
    client.nodes.get('contact-status').textContent,
    "Message received. We'll get back to you soon.",
  );
  assert.equal(client.nodes.get('contact-status').className, 'form-message success');
  assert.equal(client.nodes.get('contact-status').focused, 1);
  assert.equal(client.nodes.get('contact-submit').disabled, true);
});

test('failure preserves every value and restores retry state', async () => {
  const client = formHarness({ apiResult: new Error('offline') });
  client.nodes.get('contact-name').value = 'Visitor';
  client.nodes.get('contact-email').value = 'visitor@example.com';
  client.nodes.get('contact-message').value = 'Keep this text';
  await client.submit();

  assert.equal(client.nodes.get('contact-name').value, 'Visitor');
  assert.equal(client.nodes.get('contact-email').value, 'visitor@example.com');
  assert.equal(client.nodes.get('contact-message').value, 'Keep this text');
  assert.equal(
    client.nodes.get('contact-status').textContent,
    "We couldn't send your message. Your text is still here—please retry.",
  );
  assert.equal(client.nodes.get('contact-status').className, 'form-message error');
  assert.equal(client.nodes.get('contact-submit').disabled, false);
  assert.equal(client.nodes.get('contact-submit').textContent, 'Send Message');
});
```

Add the duplicate-submit and Unicode-boundary tests:

```js
test('pending submission is single-flight and exposes Sending state', async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const client = formHarness({ apiResult: pending });
  client.nodes.get('contact-name').value = 'Visitor';
  client.nodes.get('contact-email').value = 'visitor@example.com';

  const first = client.nodes.get('contact-form').listeners.submit({
    preventDefault() {},
  });
  const second = client.nodes.get('contact-form').listeners.submit({
    preventDefault() {},
  });
  await Promise.resolve();

  assert.equal(client.calls.length, 1);
  assert.equal(client.nodes.get('contact-submit').disabled, true);
  assert.equal(client.nodes.get('contact-submit').textContent, 'Sending…');

  release({ message: 'Message received' });
  await Promise.all([first, second]);
  assert.equal(client.calls.length, 1);
});

test('client validation uses the same exact Unicode boundaries as the server', () => {
  const client = formHarness();
  const validate = client.context.validateContactPayload;
  const email255 = `${'a'.repeat(250)}@e.co`;
  const email256 = `${'a'.repeat(251)}@e.co`;

  assert.deepEqual(
    JSON.parse(JSON.stringify(validate({
      name: '🙂'.repeat(100),
      email: email255,
      message: '界'.repeat(5000),
    }))),
    {},
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(validate({
      name: '🙂'.repeat(101),
      email: email256,
      message: '界'.repeat(5001),
    }))),
    {
      name: 'Name must be 100 characters or fewer.',
      email: 'Email must be 255 characters or fewer.',
      message: 'Message must be 5,000 characters or fewer.',
    },
  );
});
```

- [ ] **Step 3: Run client tests and confirm the red state**

Run:

```bash
node --test backend/test/api-client.test.js backend/test/contact-client.test.js
```

Expected: FAIL because `API.submitContact`, `js/contact.js`, and its two public functions do not exist.

- [ ] **Step 4: Add the shared API method**

Add near the start of the `API` object in `js/api.js`:

```js
submitContact: (payload) =>
  apiFetch("/contact", {
    method: "POST",
    body: JSON.stringify(payload),
  }),
```

Keep the route public; do not add a token requirement or a redirect.

- [ ] **Step 5: Implement the Contact form state machine**

Create `js/contact.js`:

```js
function contactCharacterCount(value) {
  return [...value].length;
}

function validateContactPayload({ name, email, message } = {}) {
  const errors = {};
  const normalizedName = typeof name === "string" ? name.trim() : "";
  const normalizedEmail = typeof email === "string" ? email.trim() : "";
  const normalizedMessage = typeof message === "string" ? message.trim() : "";

  if (!normalizedName) {
    errors.name = "Enter your name.";
  } else if (contactCharacterCount(normalizedName) > 100) {
    errors.name = "Name must be 100 characters or fewer.";
  }

  if (!normalizedEmail) {
    errors.email = "Enter your email address.";
  } else if (contactCharacterCount(normalizedEmail) > 255) {
    errors.email = "Email must be 255 characters or fewer.";
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    errors.email = "Enter a valid email address.";
  }

  if (contactCharacterCount(normalizedMessage) > 5000) {
    errors.message = "Message must be 5,000 characters or fewer.";
  }
  return errors;
}

function initializeContactForm({ root = document, api = API } = {}) {
  const form = root.getElementById("contact-form");
  if (!form) return null;

  const fields = {
    name: root.getElementById("contact-name"),
    email: root.getElementById("contact-email"),
    message: root.getElementById("contact-message"),
  };
  const errors = {
    name: root.getElementById("contact-name-error"),
    email: root.getElementById("contact-email-error"),
    message: root.getElementById("contact-message-error"),
  };
  const honeypot = root.getElementById("contact-company-website");
  const submit = root.getElementById("contact-submit");
  const status = root.getElementById("contact-status");
  let submissionPending = false;

  function payload() {
    return {
      name: fields.name.value.trim(),
      email: fields.email.value.trim(),
      message: fields.message.value.trim(),
      company_website: honeypot.value.trim(),
    };
  }

  function renderErrors(nextErrors) {
    for (const name of Object.keys(fields)) {
      errors[name].textContent = nextErrors[name] || "";
      if (nextErrors[name]) {
        fields[name].setAttribute("aria-invalid", "true");
      } else {
        fields[name].removeAttribute("aria-invalid");
      }
    }
  }

  function syncEligibility() {
    const nextErrors = validateContactPayload(payload());
    submit.disabled = submissionPending
      || Boolean(nextErrors.name || nextErrors.email || nextErrors.message);
  }

  form.addEventListener("input", () => {
    renderErrors({});
    status.textContent = "";
    status.className = "form-message";
    syncEligibility();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submissionPending) return;

    const submission = payload();
    const nextErrors = validateContactPayload(submission);
    renderErrors(nextErrors);
    const firstInvalid = Object.keys(fields).find((name) => nextErrors[name]);
    if (firstInvalid) {
      fields[firstInvalid].focus();
      syncEligibility();
      return;
    }

    submissionPending = true;
    submit.disabled = true;
    submit.textContent = "Sending…";
    status.textContent = "";
    status.className = "form-message";

    try {
      await api.submitContact(submission);
      form.reset();
      renderErrors({});
      status.textContent = "Message received. We'll get back to you soon.";
      status.className = "form-message success";
      status.focus();
    } catch {
      status.textContent =
        "We couldn't send your message. Your text is still here—please retry.";
      status.className = "form-message error";
      status.focus();
    } finally {
      submissionPending = false;
      submit.textContent = "Send Message";
      syncEligibility();
    }
  });

  syncEligibility();
  return { syncEligibility };
}

initializeContactForm();
```

- [ ] **Step 6: Run client tests and syntax checks**

Run:

```bash
node --test backend/test/api-client.test.js backend/test/contact-client.test.js backend/test/public-content-pages.test.js
node --check js/contact.js
node --check js/api.js
```

Expected: PASS. The form clears only after success, preserves all fields after failure, rejects duplicate concurrent submits, and exposes exact feedback text.

- [ ] **Step 7: Commit the client slice**

```bash
git add js/api.js js/contact.js backend/test/api-client.test.js backend/test/contact-client.test.js
git commit -m "feat(contact): submit messages with resilient form states"
```

## Task 6: Release Allowlist, Regression Suite, and Browser Acceptance

**Files:**

- Modify: `backend/package.json`
- Modify: `backend/package-lock.json`
- Modify: `backend/deploy/runtime-manifest.txt`
- Modify: `backend/test/messages-deployment-files.test.js`
- Verify: all files created or modified in Tasks 1–5

**Interfaces:**

- Consumes: the final static pages/assets/client, Contact API route/service, and focused migration.
- Produces: one exact runtime deployment allowlist and the operator command `npm run migrate:contact-submissions`.

- [ ] **Step 1: Write the failing release-contract changes**

Update the deep-equality expectation in `backend/test/messages-deployment-files.test.js` to include:

```js
'migrate:contact-submissions': 'node migrate-contact.js',
```

Add these exact paths to `expectedRuntimeFiles` in their corresponding frontend/backend groups:

```js
'about.html',
'contact.html',
'images/raveen.webp',
'images/victor.webp',
'js/contact.js',
'backend/migrate-contact.js',
'backend/scripts/migrate-contact-submissions.js',
'backend/src/routes/contact.js',
'backend/src/services/contact-submission-workflow.js',
```

Add both migration files to the test's required operational-runtime list:

```js
'backend/migrate-contact.js',
'backend/scripts/migrate-contact-submissions.js',
```

- [ ] **Step 2: Run the deployment contract and confirm the red state**

Run:

```bash
node --test backend/test/messages-deployment-files.test.js
```

Expected: FAIL because `backend/package.json` and `backend/deploy/runtime-manifest.txt` do not yet match the expanded exact contracts.

- [ ] **Step 3: Expose the focused migration and synchronize the runtime manifest**

Add the script to `backend/package.json` without changing any existing script:

```json
{
  "migrate:contact-submissions": "node migrate-contact.js"
}
```

Run `npm --prefix backend install --package-lock-only` only if npm reports that the lockfile's root package scripts/dependency metadata is stale.

Add these paths to `backend/deploy/runtime-manifest.txt`, in the same order used by `expectedRuntimeFiles`:

```text
about.html
contact.html
images/raveen.webp
images/victor.webp
js/contact.js
backend/migrate-contact.js
backend/scripts/migrate-contact-submissions.js
backend/src/routes/contact.js
backend/src/services/contact-submission-workflow.js
```

Do not add tests, `backend/schema.sql`, docs, `.env`, uploads, `node_modules`, or deployment configuration to the public runtime allowlist.

- [ ] **Step 4: Run every focused feature test**

Run:

```bash
node --test \
  backend/test/public-content-pages.test.js \
  backend/test/contact-client.test.js \
  backend/test/api-client.test.js \
  backend/test/contact-submission-workflow.test.js \
  backend/test/contact-route.test.js \
  backend/test/contact-submissions-migration.test.js \
  backend/test/schema-contract.test.js \
  backend/test/messages-deployment-files.test.js
```

Expected: PASS with no skipped tests.

- [ ] **Step 5: Run syntax and formatting checks**

Run:

```bash
node --check js/contact.js
node --check js/api.js
node --check backend/src/routes/contact.js
node --check backend/src/services/contact-submission-workflow.js
node --check backend/scripts/migrate-contact-submissions.js
node --check backend/migrate-contact.js
git diff --check
```

Expected: every command exits zero and `git diff --check` prints nothing.

- [ ] **Step 6: Run the complete repository test suite**

Run:

```bash
npm --prefix backend test
```

Expected: PASS with no regression in authentication, roles, portfolios, assignments, dashboards, messaging, notifications, migrations, deployment, or existing frontend contracts.

- [ ] **Step 7: Perform desktop browser acceptance**

Serve the repository through a local static server, open both pages in the in-app browser at a viewport at least 1280px wide, and verify all of the following:

```text
about.html: one complete hero, three Journey paragraphs, four Vision cards,
two locally loaded 600×600 founder portraits, complete biographies/profile links,
Connect call to action, complete footer, and no AI/stock hero

contact.html: Contact hero, correct One Fullerton details, lazy map plus fallback,
Name/Email/optional Message form, disabled invalid submit, visible focus,
Sending state, safe failure preservation, complete footer, and no console error

both pages: full desktop navigation, correct aria-current link, working local links,
working mailto/tel/map destinations, no horizontal overflow, and no failed local asset
```

Use the browser network panel or DOM inspection to confirm the portrait URLs are local `images/*.webp` requests and the page never requests `ai.webp`.

- [ ] **Step 8: Perform compact and reduced-motion browser acceptance**

At 800px and 390px widths:

```text
native Menu summary is keyboard operable
Sign up remains visible in the header
all sections stack in the specified order
portraits, cards, form, map, and footer remain inside the viewport
controls remain at least 44px high
no horizontal overflow appears
```

Enable reduced motion in browser emulation and confirm Orbit Story nodes remain static.

- [ ] **Step 9: Verify a real non-production database round trip when credentials are available**

Against an explicitly identified development/test database:

```bash
npm --prefix backend run migrate:contact-submissions
```

Start the backend, submit one uniquely named Contact message in the browser, and query:

```sql
SELECT id, name, email, message, created_at
FROM contact_submissions
WHERE email = 'orbit-contact-test@example.com'
ORDER BY id DESC;
```

Expected: exactly one row exists, a browser refresh does not add another row, an invalid request adds none, and a populated honeypot request adds none. Delete only the uniquely labelled test row after recording the result:

```sql
DELETE FROM contact_submissions
WHERE email = 'orbit-contact-test@example.com';
```

Do not point this verification at production or delete any row that was not created by this exact acceptance check.

- [ ] **Step 10: Commit the release contract**

```bash
git add backend/package.json backend/package-lock.json backend/deploy/runtime-manifest.txt backend/test/messages-deployment-files.test.js
git commit -m "chore(release): package about and contact workflow"
```

## Release Order After Separate Deployment Authorization

1. Confirm the exact Git commit and create a verified database dump plus file preimages.
2. Build the release only from `backend/deploy/runtime-manifest.txt`.
3. Stage production dependencies from the committed lockfile with `npm ci --omit=dev`; do not mutate the live dependency tree piecemeal.
4. Preserve the live `.env`, uploads, previous backend files, and previous dependency tree.
5. Install `backend/migrate-contact.js`, `backend/scripts/migrate-contact-submissions.js`, and the updated schema-contract files.
6. Run `npm run migrate:contact-submissions` before restarting the backend; the updated readiness check intentionally returns 503 until the table exists.
7. Install the remaining backend files and staged dependencies atomically, then restart only `lumilabs-backend.service`.
8. Require loopback `/api/health`, `/api/ready`, active service state, and clean recent logs.
9. Upload CSS, JavaScript, portraits, and shared assets before uploading `about.html` and `contact.html`.
10. Verify public HTTP 200 responses, raw hashes, no private backend exposure, both responsive layouts, and one uniquely labelled Contact insert.
11. Keep the database dump and file preimages until acceptance; code rollback must not drop `contact_submissions`, because it may contain real visitor submissions.
