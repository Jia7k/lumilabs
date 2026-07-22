const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/config/db');
const {
  WorkflowError,
  submitPortfolio,
  moderatePortfolio,
  expressInterest,
  updatePortfolioDetails,
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

test('submitting an approved portfolio archives its managed room in the same transaction', { concurrency: false }, async (t) => {
  const connection = fakeConnection(async (sql, params) => {
    if (sql.includes('FROM portfolios') && sql.includes('FOR UPDATE')) {
      return [[{ id: 7, owner_id: 4, name: 'Flow Co', status: 'approved' }], []];
    }
    if (sql.includes('FROM conversations') && sql.includes('FOR UPDATE')) {
      return [[{
        id: 12,
        portfolio_id: 7,
        title: 'Flow Co',
        status: 'active',
        archived_reason: null,
      }], []];
    }
    if (sql.includes('FROM conversation_members') && sql.includes("membership_status='active'")) {
      return [[{ user_id: 4 }, { user_id: 8 }, { user_id: 9 }], []];
    }
    if (sql.includes('UPDATE conversations')) {
      assert.equal(params[0], 'portfolio_unapproved');
      return [{ affectedRows: 1 }, []];
    }
    if (sql.startsWith('UPDATE portfolios')) return [{ affectedRows: 1 }, []];
    if (sql.includes("role='admin'")) return [[{ id: 10 }], []];
    if (sql.startsWith('INSERT INTO notifications')) return [{ affectedRows: 1 }, []];
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  useConnection(t, connection);

  await submitPortfolio({ portfolioId: 7, ownerId: 4, ownerName: 'Owner' });
  const archiveAt = connection.calls.queries.findIndex(({ sql }) => sql.includes('UPDATE conversations'));
  const portfolioAt = connection.calls.queries.findIndex(({ sql }) => sql.startsWith('UPDATE portfolios'));
  assert.ok(archiveAt > -1 && archiveAt < portfolioAt);
  assert.equal(connection.calls.commit, 1);
});

test('updating approved portfolio details archives before resetting to draft', { concurrency: false }, async (t) => {
  assert.equal(typeof updatePortfolioDetails, 'function');
  const portfolio = {
    id: 7,
    owner_id: 4,
    name: 'Flow Co',
    sector: 'Technology',
    mvp_status: 'Beta',
    description: 'Existing description',
    funding_goal: 1000,
    team_size: 3,
    founded_year: 2026,
    location: 'Singapore',
    website: '',
    monthly_revenue: 100,
    user_count: 20,
    growth_rate: 5,
    market_size: 'Large',
    competitor_analysis: 'Several',
    advisor_names: '',
    burn_rate: 50,
    runway_months: 12,
    status: 'approved',
  };
  const connection = fakeConnection(async (sql) => {
    if (sql.includes('FROM portfolios') && sql.includes('FOR UPDATE')) return [[portfolio], []];
    if (sql.includes('COUNT(*) AS c')) return [[{ c: 1 }], []];
    if (sql.includes('FROM conversations') && sql.includes('FOR UPDATE')) {
      return [[{
        id: 12, portfolio_id: 7, title: 'Flow Co', status: 'active', archived_reason: null,
      }], []];
    }
    if (sql.includes('FROM conversation_members')) return [[{ user_id: 4 }, { user_id: 8 }], []];
    if (sql.includes('UPDATE conversations')) return [{ affectedRows: 1 }, []];
    if (sql.startsWith('INSERT INTO notifications')) return [{ affectedRows: 1 }, []];
    if (sql.includes('UPDATE portfolios')) return [{ affectedRows: 1 }, []];
    if (sql.includes('SELECT * FROM portfolios WHERE id=?')) {
      return [[{ ...portfolio, name: 'Flow Co Updated', status: 'draft' }], []];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  useConnection(t, connection);

  const result = await updatePortfolioDetails({
    portfolioId: 7,
    ownerId: 4,
    payload: { name: 'Flow Co Updated' },
    calculateReadiness: () => 77,
  });
  assert.equal(result.name, 'Flow Co Updated');
  assert.equal(result.was_reset_to_draft, true);
  assert.ok(connection.calls.queries.some(({ sql }) => sql.includes('UPDATE conversations')));
  assert.equal(connection.calls.commit, 1);
});
