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

function isModerationLock(sql) {
  return (
    sql.includes('FROM portfolios')
    && sql.includes('FOR UPDATE')
    && !sql.startsWith('SELECT * FROM portfolios')
  );
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
    if (sql.startsWith('SELECT * FROM portfolios')) {
      return [[{
        id: 7,
        owner_id: 4,
        name: 'Flow Co',
        status: 'approved',
        relationship_manager_id: null,
      }], []];
    }
    if (sql.includes('FROM portfolios') && sql.includes('FOR UPDATE')) {
      return [[{
        id: 7,
        owner_id: 4,
        name: 'Flow Co',
        status: 'pending',
        relationship_manager_id: null,
      }], []];
    }
    if (sql.startsWith('UPDATE portfolios')) return [{ affectedRows: 1 }, []];
    if (sql.includes('FROM conversations') && sql.includes('FOR UPDATE')) {
      return [[], []];
    }
    if (sql.startsWith('INSERT INTO audit_logs')) return [{ affectedRows: 1 }, []];
    if (sql.startsWith('INSERT INTO notifications')) return [{ affectedRows: 1 }, []];
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  useConnection(t, connection);

  await moderatePortfolio({ portfolioId: 7, adminId: 9, action: 'approved', reason: null });
  assert.equal(connection.calls.commit, 1);
  assert.equal(connection.calls.rollback, 0);
  assert.equal(connection.calls.release, 1);
  assert.ok(connection.calls.queries.some(({ sql }) => (
    /WHERE id=\?\s+FOR UPDATE/.test(sql)
    && !/WHERE id=\? AND status='pending'/.test(sql)
  )));
  assert.ok(connection.calls.queries.some(({ sql }) => sql.startsWith('INSERT INTO audit_logs')));
  assert.ok(connection.calls.queries.some(({ sql }) => sql.startsWith('INSERT INTO notifications')));
});

test('an already-moderated locked portfolio returns conflict without mutation', {
  concurrency: false,
}, async (t) => {
  for (const status of ['approved', 'rejected']) {
    await t.test(status, async (subtest) => {
      const connection = fakeConnection(async (sql) => {
        if (sql.includes('FROM portfolios') && sql.includes('FOR UPDATE')) {
          if (/WHERE id=\? AND status='pending'/.test(sql)) return [[], []];
          return [[{
            id: 7,
            owner_id: 4,
            name: 'Flow Co',
            status,
            relationship_manager_id: 8,
          }], []];
        }
        throw new Error(`Unexpected mutation after conflict: ${sql}`);
      });
      useConnection(subtest, connection);

      await assert.rejects(
        () => moderatePortfolio({
          portfolioId: 7,
          adminId: 9,
          action: 'rejected',
          reason: 'No fit',
        }),
        (error) => (
          error instanceof WorkflowError
          && error.status === 409
          && error.code === 'MODERATION_CONFLICT'
        ),
      );
      assert.equal(connection.calls.commit, 0);
      assert.equal(connection.calls.rollback, 1);
      assert.equal(connection.calls.queries.length, 1);
    });
  }
});

test('a missing portfolio returns not found without mutation', {
  concurrency: false,
}, async (t) => {
  const connection = fakeConnection(async (sql) => {
    if (sql.includes('FROM portfolios') && sql.includes('FOR UPDATE')) {
      return [[], []];
    }
    throw new Error(`Unexpected mutation after missing portfolio: ${sql}`);
  });
  useConnection(t, connection);

  await assert.rejects(
    () => moderatePortfolio({
      portfolioId: 404,
      adminId: 9,
      action: 'approved',
      reason: null,
    }),
    (error) => (
      error instanceof WorkflowError
      && error.status === 404
      && error.code === 'PENDING_PORTFOLIO_NOT_FOUND'
    ),
  );
  assert.equal(connection.calls.commit, 0);
  assert.equal(connection.calls.rollback, 1);
  assert.equal(connection.calls.queries.length, 1);
});

test('a defensive zero-row moderation update receives a conflict without inserts', {
  concurrency: false,
}, async (t) => {
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
      return [[{
        id: 7,
        owner_id: 4,
        name: 'Flow Co',
        status: 'approved',
        relationship_manager_id: 9,
        owner_name: 'Owner',
      }], []];
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
      return [[{
        id: 7,
        owner_id: 4,
        name: 'Flow Co',
        status: 'approved',
        relationship_manager_id: 9,
        owner_name: 'Owner',
      }], []];
    }
    if (sql.startsWith('INSERT IGNORE INTO investor_interests')) return [{ affectedRows: 1 }, []];
    if (sql.startsWith('INSERT INTO notifications')) {
      return [{ affectedRows: 2 }, []];
    }
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
  const notification = connection.calls.queries.find(
    ({ sql }) => sql.startsWith('INSERT INTO notifications'),
  );
  assert.deepEqual(
    notification.params[0].map((row) => row[0]),
    [4, 9],
  );
  assert.deepEqual(
    notification.params[0].map((row) => row[1]),
    ['new_interest', 'new_interest'],
  );
});

test('new interest notifies the owner and assigned manager exactly once', {
  concurrency: false,
}, async (t) => {
  const connection = fakeConnection(async (sql) => {
    if (sql.includes('FROM portfolios') && sql.includes('FOR UPDATE')) {
      assert.match(sql, /p\.relationship_manager_id/);
      assert.match(sql, /JOIN users owner ON owner\.id=p\.owner_id/);
      return [[{
        id: 20,
        owner_id: 9,
        name: 'X3',
        status: 'approved',
        relationship_manager_id: 7,
        owner_name: 'Owner',
      }], []];
    }
    if (sql.startsWith('INSERT IGNORE INTO investor_interests')) {
      return [{ affectedRows: 1 }, []];
    }
    if (sql.startsWith('INSERT INTO notifications')) {
      return [{ affectedRows: 2 }, []];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  useConnection(t, connection);

  await expressInterest({
    portfolioId: 20,
    investorId: 11,
    investorName: 'Investor',
  });

  const notification = connection.calls.queries.find(
    ({ sql }) => sql.startsWith('INSERT INTO notifications'),
  );
  assert.deepEqual(
    notification.params[0].map((row) => row[0]).sort((left, right) => left - right),
    [7, 9],
  );
  assert.deepEqual(
    notification.params[0].map((row) => row[1]),
    ['new_interest', 'new_interest'],
  );
});

test('new interest notifies only the owner while the portfolio is unassigned', {
  concurrency: false,
}, async (t) => {
  const connection = fakeConnection(async (sql) => {
    if (sql.includes('FROM portfolios') && sql.includes('FOR UPDATE')) {
      return [[{
        id: 20,
        owner_id: 9,
        name: 'X3',
        status: 'approved',
        relationship_manager_id: null,
        owner_name: 'Owner',
      }], []];
    }
    if (sql.startsWith('INSERT IGNORE INTO investor_interests')) {
      return [{ affectedRows: 1 }, []];
    }
    if (sql.startsWith('INSERT INTO notifications')) {
      return [{ affectedRows: 1 }, []];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  useConnection(t, connection);

  await expressInterest({
    portfolioId: 20,
    investorId: 11,
    investorName: 'Investor',
  });

  const notification = connection.calls.queries.find(
    ({ sql }) => sql.startsWith('INSERT INTO notifications'),
  );
  assert.deepEqual(notification.params[0].map((row) => row[0]), [9]);
});

test('interest notification failure rolls back the interest write', {
  concurrency: false,
}, async (t) => {
  const connection = fakeConnection(async (sql) => {
    if (sql.includes('FROM portfolios') && sql.includes('FOR UPDATE')) {
      return [[{
        id: 20,
        owner_id: 9,
        name: 'X3',
        status: 'approved',
        relationship_manager_id: 7,
        owner_name: 'Owner',
      }], []];
    }
    if (sql.startsWith('INSERT IGNORE INTO investor_interests')) {
      return [{ affectedRows: 1 }, []];
    }
    if (sql.startsWith('INSERT INTO notifications')) {
      throw new Error('notification failed');
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  useConnection(t, connection);

  await assert.rejects(
    expressInterest({
      portfolioId: 20,
      investorId: 11,
      investorName: 'Investor',
    }),
    /notification failed/,
  );
  assert.equal(connection.calls.commit, 0);
  assert.equal(connection.calls.rollback, 1);
  assert.ok(connection.calls.queries.some(
    ({ sql }) => sql.startsWith('INSERT IGNORE INTO investor_interests'),
  ));
});

test('interest IDs are rejected before a transaction or SQL starts', {
  concurrency: false,
}, async (t) => {
  const original = db.getConnection;
  let calls = 0;
  db.getConnection = async () => {
    calls += 1;
    throw new Error('database must not be reached');
  };
  t.after(() => {
    db.getConnection = original;
  });

  await assert.rejects(
    expressInterest({
      portfolioId: '20junk',
      investorId: 11,
      investorName: 'Investor',
    }),
    (error) => error instanceof WorkflowError && error.status === 400,
  );
  assert.equal(calls, 0);
});

test('approval restores a room only when an active investor still has interest', {
  concurrency: false,
}, async (t) => {
  let portfolioStatus = 'pending';
  const conversation = {
    id: 12,
    portfolio_id: 20,
    relationship_manager_id: 7,
    title: 'X3',
    status: 'archived',
    archived_reason: 'portfolio_unapproved',
  };
  const connection = fakeConnection(async (sql, params) => {
    if (isModerationLock(sql)) {
      return [[{
        id: 20,
        owner_id: 9,
        name: 'X3',
        status: portfolioStatus,
        relationship_manager_id: 7,
      }], []];
    }
    if (sql.startsWith('UPDATE portfolios')) {
      portfolioStatus = params[0];
      return [{ affectedRows: 1 }, []];
    }
    if (sql.startsWith('SELECT * FROM portfolios')) {
      return [[{
        id: 20,
        owner_id: 9,
        name: 'X3',
        status: portfolioStatus,
        relationship_manager_id: 7,
      }], []];
    }
    if (sql.includes('FROM conversations') && sql.includes('FOR UPDATE')) {
      return [[{ ...conversation }], []];
    }
    if (sql.includes('JOIN investor_interests')) {
      return [[{ user_id: 11 }], []];
    }
    if (sql.startsWith("UPDATE conversations SET status='active'")) {
      conversation.status = 'active';
      conversation.archived_reason = null;
      return [{ affectedRows: 1 }, []];
    }
    if (sql.startsWith('INSERT INTO audit_logs')) return [{ affectedRows: 1 }, []];
    if (sql.startsWith('INSERT INTO notifications')) return [{ affectedRows: 1 }, []];
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  useConnection(t, connection);

  await moderatePortfolio({
    portfolioId: 20,
    adminId: 5,
    action: 'approve',
    reason: null,
  });

  assert.deepEqual(
    {
      status: conversation.status,
      archived_reason: conversation.archived_reason,
    },
    { status: 'active', archived_reason: null },
  );
  const reconciliationAt = connection.calls.queries.findIndex(
    ({ sql }) => sql.startsWith("UPDATE conversations SET status='active'"),
  );
  const auditAt = connection.calls.queries.findIndex(
    ({ sql }) => sql.startsWith('INSERT INTO audit_logs'),
  );
  assert.ok(reconciliationAt > -1 && reconciliationAt < auditAt);
});

test('approval leaves a room archived when no active investor still has interest', {
  concurrency: false,
}, async (t) => {
  let portfolioStatus = 'pending';
  const conversation = {
    id: 12,
    portfolio_id: 20,
    relationship_manager_id: 7,
    title: 'X3',
    status: 'archived',
    archived_reason: 'portfolio_unapproved',
  };
  const connection = fakeConnection(async (sql, params) => {
    if (isModerationLock(sql)) {
      return [[{
        id: 20,
        owner_id: 9,
        name: 'X3',
        status: portfolioStatus,
        relationship_manager_id: 7,
      }], []];
    }
    if (sql.startsWith('UPDATE portfolios')) {
      portfolioStatus = params[0];
      return [{ affectedRows: 1 }, []];
    }
    if (sql.startsWith('SELECT * FROM portfolios')) {
      return [[{
        id: 20,
        owner_id: 9,
        name: 'X3',
        status: portfolioStatus,
        relationship_manager_id: 7,
      }], []];
    }
    if (sql.includes('FROM conversations') && sql.includes('FOR UPDATE')) {
      return [[{ ...conversation }], []];
    }
    if (sql.includes('JOIN investor_interests')) return [[], []];
    if (sql.includes('FROM conversation_members')) {
      return [[{ user_id: 7 }, { user_id: 9 }], []];
    }
    if (sql.includes("archived_reason='no_active_investors'")) {
      conversation.status = 'archived';
      conversation.archived_reason = 'no_active_investors';
      return [{ affectedRows: 1 }, []];
    }
    if (sql.startsWith('INSERT INTO audit_logs')) return [{ affectedRows: 1 }, []];
    if (sql.startsWith('INSERT INTO notifications')) return [{ affectedRows: 2 }, []];
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  useConnection(t, connection);

  await moderatePortfolio({
    portfolioId: 20,
    adminId: 5,
    action: 'approved',
    reason: null,
  });

  assert.deepEqual(
    {
      status: conversation.status,
      archived_reason: conversation.archived_reason,
    },
    { status: 'archived', archived_reason: 'no_active_investors' },
  );
});

test('rejection archives the room without clearing its assignment or memberships', {
  concurrency: false,
}, async (t) => {
  let portfolioStatus = 'pending';
  let relationshipManagerId = 7;
  const connection = fakeConnection(async (sql, params) => {
    if (isModerationLock(sql)) {
      return [[{
        id: 20,
        owner_id: 9,
        name: 'X3',
        status: portfolioStatus,
        relationship_manager_id: relationshipManagerId,
      }], []];
    }
    if (sql.startsWith('UPDATE portfolios')) {
      assert.doesNotMatch(sql, /relationship_manager_id/);
      portfolioStatus = params[0];
      return [{ affectedRows: 1 }, []];
    }
    if (sql.startsWith('SELECT * FROM portfolios')) {
      return [[{
        id: 20,
        owner_id: 9,
        name: 'X3',
        status: portfolioStatus,
        relationship_manager_id: relationshipManagerId,
      }], []];
    }
    if (sql.includes('FROM conversations') && sql.includes('FOR UPDATE')) {
      return [[{
        id: 12,
        portfolio_id: 20,
        relationship_manager_id: 7,
        title: 'X3',
        status: 'active',
        archived_reason: null,
      }], []];
    }
    if (sql.includes('FROM conversation_members')) {
      return [[{ user_id: 7 }, { user_id: 9 }, { user_id: 11 }], []];
    }
    if (sql.includes('UPDATE conversations')) return [{ affectedRows: 1 }, []];
    if (sql.startsWith('INSERT INTO audit_logs')) return [{ affectedRows: 1 }, []];
    if (sql.startsWith('INSERT INTO notifications')) return [{ affectedRows: 1 }, []];
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  useConnection(t, connection);

  await moderatePortfolio({
    portfolioId: 20,
    adminId: 5,
    action: 'reject',
    reason: 'Not ready',
  });

  assert.equal(relationshipManagerId, 7);
  assert.equal(
    connection.calls.queries.some(({ sql }) => (
      /DELETE FROM conversation_members|UPDATE conversation_members/.test(sql)
    )),
    false,
  );
  assert.ok(connection.calls.queries.some(({ sql, params }) => (
    sql.includes('UPDATE conversations')
    && params[0] === 'portfolio_unapproved'
  )));
});

test('moderation notification failure rolls back status, reconciliation, and audit', {
  concurrency: false,
}, async (t) => {
  let notificationWrites = 0;
  const connection = fakeConnection(async (sql) => {
    if (isModerationLock(sql)) {
      return [[{
        id: 20,
        owner_id: 9,
        name: 'X3',
        status: 'pending',
        relationship_manager_id: null,
      }], []];
    }
    if (sql.startsWith('UPDATE portfolios')) return [{ affectedRows: 1 }, []];
    if (sql.startsWith('SELECT * FROM portfolios')) {
      return [[{
        id: 20,
        owner_id: 9,
        name: 'X3',
        status: 'approved',
        relationship_manager_id: null,
      }], []];
    }
    if (sql.includes('FROM conversations') && sql.includes('FOR UPDATE')) {
      return [[], []];
    }
    if (sql.startsWith('INSERT INTO audit_logs')) return [{ affectedRows: 1 }, []];
    if (sql.startsWith('INSERT INTO notifications')) {
      notificationWrites += 1;
      throw new Error('owner notification failed');
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  useConnection(t, connection);

  await assert.rejects(
    moderatePortfolio({
      portfolioId: 20,
      adminId: 5,
      action: 'approve',
      reason: null,
    }),
    /owner notification failed/,
  );
  assert.equal(notificationWrites, 1);
  assert.equal(connection.calls.commit, 0);
  assert.equal(connection.calls.rollback, 1);
  assert.ok(connection.calls.queries.some(
    ({ sql }) => sql.startsWith('INSERT INTO audit_logs'),
  ));
});

test('approval reconciliation failure rolls back before audit and owner notice', {
  concurrency: false,
}, async (t) => {
  const connection = fakeConnection(async (sql) => {
    if (isModerationLock(sql)) {
      return [[{
        id: 20,
        owner_id: 9,
        name: 'X3',
        status: 'pending',
        relationship_manager_id: 7,
      }], []];
    }
    if (sql.startsWith('UPDATE portfolios')) return [{ affectedRows: 1 }, []];
    if (sql.startsWith('SELECT * FROM portfolios')) {
      throw new Error('reconciliation failed');
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  useConnection(t, connection);

  await assert.rejects(
    moderatePortfolio({
      portfolioId: 20,
      adminId: 5,
      action: 'approved',
      reason: null,
    }),
    /reconciliation failed/,
  );
  assert.equal(connection.calls.commit, 0);
  assert.equal(connection.calls.rollback, 1);
  assert.equal(connection.calls.queries.some(
    ({ sql }) => sql.startsWith('INSERT INTO audit_logs'),
  ), false);
  assert.equal(connection.calls.queries.some(
    ({ sql }) => sql.startsWith('INSERT INTO notifications'),
  ), false);
});

test('rejection archive failure rolls back before audit and owner notice', {
  concurrency: false,
}, async (t) => {
  const connection = fakeConnection(async (sql) => {
    if (isModerationLock(sql)) {
      return [[{
        id: 20,
        owner_id: 9,
        name: 'X3',
        status: 'pending',
        relationship_manager_id: 7,
      }], []];
    }
    if (sql.startsWith('UPDATE portfolios')) return [{ affectedRows: 1 }, []];
    if (sql.startsWith('SELECT * FROM portfolios')) {
      throw new Error('archive failed');
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  useConnection(t, connection);

  await assert.rejects(
    moderatePortfolio({
      portfolioId: 20,
      adminId: 5,
      action: 'rejected',
      reason: 'Not ready',
    }),
    /archive failed/,
  );
  assert.equal(connection.calls.commit, 0);
  assert.equal(connection.calls.rollback, 1);
  assert.equal(connection.calls.queries.some(
    ({ sql }) => sql.startsWith('INSERT INTO audit_logs'),
  ), false);
  assert.equal(connection.calls.queries.some(
    ({ sql }) => sql.startsWith('INSERT INTO notifications'),
  ), false);
});

test('moderation audit failure rolls back before the owner notice', {
  concurrency: false,
}, async (t) => {
  const connection = fakeConnection(async (sql) => {
    if (isModerationLock(sql)) {
      return [[{
        id: 20,
        owner_id: 9,
        name: 'X3',
        status: 'pending',
        relationship_manager_id: null,
      }], []];
    }
    if (sql.startsWith('UPDATE portfolios')) return [{ affectedRows: 1 }, []];
    if (sql.startsWith('SELECT * FROM portfolios')) {
      return [[{
        id: 20,
        owner_id: 9,
        name: 'X3',
        status: 'approved',
        relationship_manager_id: null,
      }], []];
    }
    if (sql.includes('FROM conversations') && sql.includes('FOR UPDATE')) {
      return [[], []];
    }
    if (sql.startsWith('INSERT INTO audit_logs')) {
      throw new Error('audit failed');
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  useConnection(t, connection);

  await assert.rejects(
    moderatePortfolio({
      portfolioId: 20,
      adminId: 5,
      action: 'approved',
      reason: null,
    }),
    /audit failed/,
  );
  assert.equal(connection.calls.commit, 0);
  assert.equal(connection.calls.rollback, 1);
  assert.equal(connection.calls.queries.some(
    ({ sql }) => sql.startsWith('INSERT INTO notifications'),
  ), false);
});

test('rollback failure preserves the primary workflow error and destroys the connection', {
  concurrency: false,
}, async (t) => {
  const primaryError = new Error('primary notification failure');
  let destroyCalls = 0;
  let releaseCalls = 0;
  const logs = [];
  const originalGetConnection = db.getConnection;
  const originalError = console.error;
  db.getConnection = async () => ({
    async beginTransaction() {},
    async query(sql) {
      if (sql.includes('FROM portfolios') && sql.includes('FOR UPDATE')) {
        return [[{
          id: 7,
          owner_id: 4,
          name: 'Flow Co',
          status: 'draft',
        }], []];
      }
      if (sql.startsWith('UPDATE portfolios')) return [{ affectedRows: 1 }, []];
      if (sql.includes("role='admin'")) return [[{ id: 9 }], []];
      if (sql.startsWith('INSERT INTO notifications')) throw primaryError;
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    async commit() {},
    async rollback() {
      throw new Error('rollback password=secret');
    },
    async destroy() {
      destroyCalls += 1;
    },
    release() {
      releaseCalls += 1;
    },
  });
  console.error = (...parts) => {
    logs.push(parts.join(' '));
  };
  t.after(() => {
    db.getConnection = originalGetConnection;
    console.error = originalError;
  });

  await assert.rejects(
    submitPortfolio({ portfolioId: 7, ownerId: 4, ownerName: 'Owner' }),
    (error) => error === primaryError,
  );
  assert.equal(destroyCalls, 1);
  assert.equal(releaseCalls, 0);
  assert.equal(logs.some((line) => line.includes('secret')), false);
  assert.ok(logs.some((line) => line === 'Workflow transaction rollback failed'));
});

test('begin failure releases the unused workflow connection', {
  concurrency: false,
}, async (t) => {
  let releaseCalls = 0;
  const originalGetConnection = db.getConnection;
  db.getConnection = async () => ({
    async beginTransaction() {
      throw new Error('begin failed');
    },
    release() {
      releaseCalls += 1;
    },
  });
  t.after(() => {
    db.getConnection = originalGetConnection;
  });

  await assert.rejects(
    submitPortfolio({ portfolioId: 7, ownerId: 4, ownerName: 'Owner' }),
    /begin failed/,
  );
  assert.equal(releaseCalls, 1);
});

test('submitting an approved portfolio archives its managed room in the same transaction', { concurrency: false }, async (t) => {
  const connection = fakeConnection(async (sql, params) => {
    if (sql.includes('FROM portfolios') && sql.includes('FOR UPDATE')) {
      return [[{
        id: 7,
        owner_id: 4,
        name: 'Flow Co',
        status: 'approved',
        relationship_manager_id: 8,
      }], []];
    }
    if (sql.includes('FROM conversations') && sql.includes('FOR UPDATE')) {
      return [[{
        id: 12,
        portfolio_id: 7,
        relationship_manager_id: 8,
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
    relationship_manager_id: 8,
  };
  const connection = fakeConnection(async (sql) => {
    if (sql.includes('FROM portfolios') && sql.includes('FOR UPDATE')) return [[portfolio], []];
    if (sql.includes('COUNT(*) AS c')) return [[{ c: 1 }], []];
    if (sql.includes('FROM conversations') && sql.includes('FOR UPDATE')) {
      return [[{
        id: 12,
        portfolio_id: 7,
        relationship_manager_id: 8,
        title: 'Flow Co',
        status: 'active',
        archived_reason: null,
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
  assert.equal(connection.calls.queries.some(({ sql }) => (
    sql.includes('UPDATE portfolios') && sql.includes('relationship_manager_id')
  )), false);
  assert.equal(connection.calls.commit, 1);
});
