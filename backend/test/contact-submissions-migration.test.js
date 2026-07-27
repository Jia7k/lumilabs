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
