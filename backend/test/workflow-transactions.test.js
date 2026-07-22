const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/config/db');
const {
  WorkflowError,
  submitPortfolio,
  moderatePortfolio,
  expressInterest,
} = require('../src/services/workflow');

function fakeConnection(handler) {
  const calls = { begin: 0, queries: [], commit: 0, rollback: 0, release: 0 };
  return {
    calls,
    async beginTransaction() { calls.begin += 1; },
    async query(sql, params) {
      calls.queries.push({ sql, params });
      return handler(sql, params);
    },
    async commit() { calls.commit += 1; },
    async rollback() { calls.rollback += 1; },
    release() { calls.release += 1; },
  };
}

function useConnection(t, connection) {
  const original = db.getConnection;
  db.getConnection = async () => connection;
  t.after(() => { db.getConnection = original; });
}

test('submission rolls back when admin notification insert fails', { concurrency: false }, async (t) => {
  const connection = fakeConnection(async (sql) => {
    if (sql.includes('FROM portfolios') && sql.includes('FOR UPDATE')) {
      return [[{ id: 7, owner_id: 4, name: 'Flow Co', status: 'draft' }], []];
    }
    if (sql.startsWith('UPDATE portfolios')) return [{ affectedRows: 1 }, []];
    if (sql.includes("role='admin'")) return [[{ id: 9 }], []];
    if (sql.startsWith('INSERT INTO notifications')) throw new Error('notification failed');
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  useConnection(t, connection);

  await assert.rejects(
    () => submitPortfolio({ portfolioId: 7, ownerId: 4, ownerName: 'Owner' }),
    /notification failed/,
  );
  assert.deepEqual(connection.calls, {
    begin: 1,
    queries: connection.calls.queries,
    commit: 0,
    rollback: 1,
    release: 1,
  });
});

test('moderation changes status, audit, and notification in one commit', { concurrency: false }, async (t) => {
  const connection = fakeConnection(async (sql) => {
    if (sql.includes('FROM portfolios') && sql.includes('FOR UPDATE')) {
      return [[{ id: 7, owner_id: 4, name: 'Flow Co', status: 'pending' }], []];
    }
    if (sql.startsWith('UPDATE portfolios')) return [{ affectedRows: 1 }, []];
    if (sql.startsWith('INSERT INTO audit_logs')) return [{ affectedRows: 1 }, []];
    if (sql.startsWith('INSERT INTO notifications')) return [{ affectedRows: 1 }, []];
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  useConnection(t, connection);

  await moderatePortfolio({ portfolioId: 7, adminId: 9, action: 'approved', reason: null });
  assert.equal(connection.calls.commit, 1);
  assert.equal(connection.calls.rollback, 0);
  assert.equal(connection.calls.release, 1);
  assert.ok(connection.calls.queries.some(({ sql }) => /WHERE id=\? AND status='pending'/.test(sql)));
  assert.ok(connection.calls.queries.some(({ sql }) => sql.startsWith('INSERT INTO audit_logs')));
  assert.ok(connection.calls.queries.some(({ sql }) => sql.startsWith('INSERT INTO notifications')));
});

test('a concurrent second moderation receives a conflict without inserts', { concurrency: false }, async (t) => {
  const connection = fakeConnection(async (sql) => {
    if (sql.includes('FROM portfolios') && sql.includes('FOR UPDATE')) {
      return [[{ id: 7, owner_id: 4, name: 'Flow Co', status: 'pending' }], []];
    }
    if (sql.startsWith('UPDATE portfolios')) return [{ affectedRows: 0 }, []];
    throw new Error(`Unexpected SQL after conflict: ${sql}`);
  });
  useConnection(t, connection);

  await assert.rejects(
    () => moderatePortfolio({ portfolioId: 7, adminId: 9, action: 'rejected', reason: 'No fit' }),
    (error) => error instanceof WorkflowError && error.status === 409,
  );
  assert.equal(connection.calls.commit, 0);
  assert.equal(connection.calls.rollback, 1);
  assert.equal(connection.calls.queries.length, 2);
});

test('duplicate interest returns created false and creates no notification', { concurrency: false }, async (t) => {
  const connection = fakeConnection(async (sql) => {
    if (sql.includes('FROM portfolios') && sql.includes('FOR UPDATE')) {
      return [[{ id: 7, owner_id: 4, name: 'Flow Co' }], []];
    }
    if (sql.startsWith('INSERT IGNORE INTO investor_interests')) return [{ affectedRows: 0 }, []];
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  useConnection(t, connection);

  assert.deepEqual(
    await expressInterest({ portfolioId: 7, investorId: 8, investorName: 'Investor' }),
    { created: false },
  );
  assert.equal(connection.calls.commit, 1);
  assert.equal(connection.calls.queries.length, 2);
});

test('new interest and notification commit together', { concurrency: false }, async (t) => {
  const connection = fakeConnection(async (sql) => {
    if (sql.includes('FROM portfolios') && sql.includes('FOR UPDATE')) {
      return [[{ id: 7, owner_id: 4, name: 'Flow Co' }], []];
    }
    if (sql.startsWith('INSERT IGNORE INTO investor_interests')) return [{ affectedRows: 1 }, []];
    if (sql.startsWith('INSERT INTO notifications')) return [{ affectedRows: 1 }, []];
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  useConnection(t, connection);

  assert.deepEqual(
    await expressInterest({ portfolioId: 7, investorId: 8, investorName: 'Investor' }),
    { created: true },
  );
  assert.equal(connection.calls.commit, 1);
  assert.equal(connection.calls.rollback, 0);
  assert.equal(connection.calls.queries.length, 3);
});
