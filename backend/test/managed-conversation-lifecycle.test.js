const test = require('node:test');
const assert = require('node:assert/strict');
const {
  archiveConversationForPortfolio,
  prepareConversationForPortfolioDeletion,
  reconcileConversationAfterApproval,
  withdrawInvestorInterest,
} = require('../src/services/managed-conversation-workflow');

function scriptedConnection(responses) {
  const calls = [];
  const state = { begin: 0, commits: 0, rollbacks: 0, releases: 0 };
  const connection = {
    async beginTransaction() { state.begin += 1; },
    async query(sql, params = []) {
      calls.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params });
      assert.ok(responses.length, `unexpected query: ${sql}`);
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return [response, []];
    },
    async commit() { state.commits += 1; },
    async rollback() { state.rollbacks += 1; },
    release() { state.releases += 1; },
  };
  return {
    connection,
    database: { getConnection: async () => connection },
    calls,
    state,
    assertConsumed() { assert.equal(responses.length, 0); },
  };
}

test('withdrawal removes investor access and archives after the last investor', async () => {
  assert.equal(typeof withdrawInvestorInterest, 'function');
  const fake = scriptedConnection([
    [{
      id: 1,
      owner_id: 3,
      name: 'X3',
      status: 'approved',
      relationship_manager_id: 8,
    }],
    [{
      id: 12,
      portfolio_id: 1,
      relationship_manager_id: 8,
      title: 'X3',
      status: 'active',
      archived_reason: null,
    }],
    [{ id: 1, investor_id: 6, portfolio_id: 1 }],
    [{ user_id: 6, membership_status: 'active' }],
    [{ user_id: 6 }],
    { affectedRows: 1 },
    { affectedRows: 1 },
    [{ user_id: 8 }, { user_id: 3 }],
    { affectedRows: 1 },
    { affectedRows: 2 },
    { affectedRows: 2 },
  ]);

  const result = await withdrawInvestorInterest({
    database: fake.database,
    investorId: 6,
    portfolioId: 1,
  });

  assert.deepEqual(result, {
    removed: true,
    conversation_id: 12,
    archived: true,
  });
  assert.ok(fake.calls.some(({ sql }) => (
    /membership_status='removed'/.test(sql) && /left_at=NOW\(\)/.test(sql)
  )));
  assert.equal(fake.calls.some(({ sql }) => /DELETE FROM notifications/.test(sql)), false);
  assert.ok(fake.calls.some(({ sql }) => (
    /JOIN investor_interests/.test(sql) && /membership_status='active'/.test(sql)
  )));
  assert.ok(fake.calls.some(({ sql }) => /archived_reason=\?/.test(sql)));
  const notificationWrites = fake.calls.filter(({ sql }) => /INSERT INTO notifications/.test(sql));
  assert.deepEqual(
    notificationWrites.at(-1).params[0].map((row) => row[0]),
    [8, 3],
  );
  assert.equal(fake.state.commits, 1);
  assert.equal(fake.state.rollbacks, 0);
  assert.equal(fake.state.releases, 1);
  fake.assertConsumed();
});

test('withdrawal keeps the room active when another investor remains', async () => {
  assert.equal(typeof withdrawInvestorInterest, 'function');
  const fake = scriptedConnection([
    [{
      id: 1,
      owner_id: 3,
      name: 'X3',
      status: 'approved',
      relationship_manager_id: 8,
    }],
    [{
      id: 12,
      portfolio_id: 1,
      relationship_manager_id: 8,
      title: 'X3',
      status: 'active',
      archived_reason: null,
    }],
    [{ id: 1, investor_id: 6, portfolio_id: 1 }],
    [{ user_id: 6, membership_status: 'active' }],
    [{ user_id: 6 }, { user_id: 9 }],
    { affectedRows: 1 },
    { affectedRows: 1 },
    { affectedRows: 2 },
  ]);

  assert.deepEqual(
    await withdrawInvestorInterest({
      database: fake.database,
      investorId: 6,
      portfolioId: 1,
    }),
    { removed: true, conversation_id: 12, archived: false },
  );
  assert.equal(fake.calls.some(({ sql }) => /UPDATE conversations/.test(sql)), false);
  assert.deepEqual(
    fake.calls.find(({ sql }) => /INSERT INTO notifications/.test(sql)).params[0]
      .map((row) => row[0]),
    [8, 3],
  );
  fake.assertConsumed();
});

test('withdrawal without a chat still notifies the assigned manager and owner', async () => {
  const fake = scriptedConnection([
    [{
      id: 1,
      owner_id: 3,
      name: 'X3',
      status: 'approved',
      relationship_manager_id: 8,
    }],
    [],
    [{ id: 1, investor_id: 6, portfolio_id: 1 }],
    { affectedRows: 1 },
    { affectedRows: 2 },
  ]);

  assert.deepEqual(
    await withdrawInvestorInterest({
      database: fake.database,
      investorId: 6,
      portfolioId: 1,
    }),
    { removed: true, conversation_id: null, archived: false },
  );
  const notification = fake.calls.find(({ sql }) => /INSERT INTO notifications/.test(sql));
  assert.deepEqual(notification.params[0].map((row) => row[0]), [8, 3]);
  assert.equal(notification.params[0].every((row) => row[5] === null), true);
  fake.assertConsumed();
});

test('withdrawal fails closed when portfolio and conversation managers disagree', async () => {
  const fake = scriptedConnection([
    [{
      id: 1,
      owner_id: 3,
      name: 'X3',
      status: 'approved',
      relationship_manager_id: 8,
    }],
    [{
      id: 12,
      portfolio_id: 1,
      relationship_manager_id: 10,
      title: 'X3',
      status: 'active',
      archived_reason: null,
    }],
  ]);

  await assert.rejects(
    withdrawInvestorInterest({
      database: fake.database,
      investorId: 6,
      portfolioId: 1,
    }),
    (error) => error.status === 409 && error.code === 'ASSIGNMENT_STATE_MISMATCH',
  );
  assert.equal(fake.state.commits, 0);
  assert.equal(fake.state.rollbacks, 1);
  fake.assertConsumed();
});

test('automatic portfolio archival replaces a prior manual reason atomically', async () => {
  assert.equal(typeof archiveConversationForPortfolio, 'function');
  const fake = scriptedConnection([
    [{
      id: 1,
      owner_id: 3,
      name: 'X3',
      status: 'pending',
      relationship_manager_id: 8,
    }],
    [{
      id: 12,
      portfolio_id: 1,
      relationship_manager_id: 8,
      title: 'X3',
      status: 'archived',
      archived_reason: 'manual',
    }],
    [{ user_id: 8 }, { user_id: 3 }, { user_id: 6 }],
    { affectedRows: 1 },
    { affectedRows: 2 },
  ]);

  const result = await archiveConversationForPortfolio(
    fake.connection,
    1,
    'portfolio_unapproved',
    3,
  );
  assert.deepEqual(result, { conversationId: 12, changed: true });
  const update = fake.calls.find(({ sql }) => /UPDATE conversations/.test(sql));
  assert.equal(update.params[0], 'portfolio_unapproved');
  assert.deepEqual(
    fake.calls.at(-1).params[0].map((row) => row[0]),
    [8, 6],
  );
  fake.assertConsumed();
});

test('automatic archive priority never weakens an existing stronger reason', async () => {
  const fake = scriptedConnection([
    [{
      id: 1,
      owner_id: 3,
      name: 'X3',
      status: 'approved',
      relationship_manager_id: 8,
    }],
    [{
      id: 12,
      portfolio_id: 1,
      relationship_manager_id: 8,
      title: 'X3',
      status: 'archived',
      archived_reason: 'portfolio_deleted',
    }],
  ]);

  assert.deepEqual(
    await archiveConversationForPortfolio(
      fake.connection,
      1,
      'no_active_investors',
      8,
    ),
    { conversationId: 12, changed: false },
  );
  assert.equal(fake.calls.some(({ sql }) => /UPDATE conversations/.test(sql)), false);
  fake.assertConsumed();
});

test('approval reconciliation reactivates an eligible room without an invented notification', async () => {
  assert.equal(typeof reconcileConversationAfterApproval, 'function');
  const fake = scriptedConnection([
    [{
      id: 1,
      owner_id: 3,
      name: 'X3',
      status: 'approved',
      relationship_manager_id: 8,
    }],
    [{
      id: 12,
      portfolio_id: 1,
      relationship_manager_id: 8,
      title: 'X3',
      status: 'archived',
      archived_reason: 'portfolio_unapproved',
    }],
    [{ user_id: 6 }],
    { affectedRows: 1 },
  ]);

  assert.deepEqual(
    await reconcileConversationAfterApproval(fake.connection, 1, 4),
    {
      conversationId: 12,
      status: 'active',
      archived_reason: null,
      changed: true,
    },
  );
  assert.ok(fake.calls.some(({ sql }) => (
    /UPDATE conversations/.test(sql) && /status='active'/.test(sql)
  )));
  assert.equal(fake.calls.some(({ sql }) => /INSERT INTO notifications/.test(sql)), false);
  fake.assertConsumed();
});

test('approval reconciliation archives a room with no eligible investor and notifies active members once', async () => {
  assert.equal(typeof reconcileConversationAfterApproval, 'function');
  const fake = scriptedConnection([
    [{
      id: 1,
      owner_id: 3,
      name: 'X3',
      status: 'approved',
      relationship_manager_id: 8,
    }],
    [{
      id: 12,
      portfolio_id: 1,
      relationship_manager_id: 8,
      title: 'X3',
      status: 'active',
      archived_reason: null,
    }],
    [],
    [{ user_id: 8 }, { user_id: 3 }],
    { affectedRows: 1 },
    { affectedRows: 2 },
  ]);

  assert.deepEqual(
    await reconcileConversationAfterApproval(fake.connection, 1, 4),
    {
      conversationId: 12,
      status: 'archived',
      archived_reason: 'no_active_investors',
      changed: true,
    },
  );
  assert.deepEqual(
    fake.calls.at(-1).params[0].map((row) => row[0]),
    [8, 3],
  );
  fake.assertConsumed();
});

test('approval reconciliation is a no-op when no room exists or state already matches', async () => {
  const missing = scriptedConnection([
    [{
      id: 1,
      owner_id: 3,
      name: 'X3',
      status: 'approved',
      relationship_manager_id: 8,
    }],
    [],
  ]);
  assert.equal(
    await reconcileConversationAfterApproval(missing.connection, 1, 4),
    null,
  );
  missing.assertConsumed();

  const unchanged = scriptedConnection([
    [{
      id: 1,
      owner_id: 3,
      name: 'X3',
      status: 'approved',
      relationship_manager_id: 8,
    }],
    [{
      id: 12,
      portfolio_id: 1,
      relationship_manager_id: 8,
      title: 'X3',
      status: 'active',
      archived_reason: null,
    }],
    [{ user_id: 6 }],
  ]);
  assert.deepEqual(
    await reconcileConversationAfterApproval(unchanged.connection, 1, 4),
    {
      conversationId: 12,
      status: 'active',
      archived_reason: null,
      changed: false,
    },
  );
  assert.equal(unchanged.calls.some(({ sql }) => /UPDATE conversations/.test(sql)), false);
  unchanged.assertConsumed();
});

test('approval reconciliation never weakens or reactivates a deleted room', async () => {
  for (const eligibleInvestors of [[], [{ user_id: 6 }]]) {
    const fake = scriptedConnection([
      [{
        id: 1,
        owner_id: 3,
        name: 'X3',
        status: 'approved',
        relationship_manager_id: 8,
      }],
      [{
        id: 12,
        portfolio_id: 1,
        relationship_manager_id: 8,
        title: 'X3',
        status: 'archived',
        archived_reason: 'portfolio_deleted',
      }],
      eligibleInvestors,
    ]);

    assert.deepEqual(
      await reconcileConversationAfterApproval(fake.connection, 1, 4),
      {
        conversationId: 12,
        status: 'archived',
        archived_reason: 'portfolio_deleted',
        changed: false,
      },
    );
    assert.equal(fake.calls.some(({ sql }) => /^(UPDATE|INSERT|DELETE)/.test(sql)), false);
    fake.assertConsumed();
  }
});

test('portfolio deletion preserves room history but severs portfolio and investor access', async () => {
  assert.equal(typeof prepareConversationForPortfolioDeletion, 'function');
  const fake = scriptedConnection([
    [{
      id: 1,
      owner_id: 3,
      name: 'X3',
      status: 'draft',
      relationship_manager_id: 8,
    }],
    [{
      id: 12,
      portfolio_id: 1,
      relationship_manager_id: 8,
      title: 'X3',
      status: 'archived',
      archived_reason: 'portfolio_unapproved',
    }],
    [{ user_id: 8 }, { user_id: 3 }, { user_id: 6 }, { user_id: 9 }],
    { affectedRows: 1 },
    { affectedRows: 3 },
    [{ user_id: 6 }, { user_id: 9 }],
    { affectedRows: 5 },
    { affectedRows: 2 },
    { affectedRows: 1 },
  ]);

  const result = await prepareConversationForPortfolioDeletion(
    fake.connection,
    1,
    3,
  );
  assert.deepEqual(result, { conversationId: 12, changed: true });
  assert.ok(fake.calls.some(({ sql }) => /archived_reason=\?/.test(sql)));
  assert.ok(fake.calls.some(({ sql }) => /membership_status='removed'/.test(sql)));
  assert.ok(fake.calls.some(({ sql }) => /SET portfolio_id=NULL/.test(sql)));
  assert.deepEqual(
    fake.calls.find(({ sql }) => /DELETE FROM notifications/.test(sql)).params,
    [12, 6, 9],
  );
  fake.assertConsumed();
});

test('automatic lifecycle helpers lock portfolio before conversation and fail closed on assignment drift', async (t) => {
  for (const [label, invoke] of [
    [
      'archive',
      (connection) => archiveConversationForPortfolio(
        connection,
        1,
        'portfolio_unapproved',
        4,
      ),
    ],
    [
      'approval reconciliation',
      (connection) => reconcileConversationAfterApproval(connection, 1, 4),
    ],
    [
      'portfolio deletion',
      (connection) => prepareConversationForPortfolioDeletion(connection, 1, 4),
    ],
  ]) {
    await t.test(label, async () => {
      const fake = scriptedConnection([
        [{
          id: 1,
          owner_id: 3,
          name: 'X3',
          status: 'approved',
          relationship_manager_id: 8,
        }],
        [{
          id: 12,
          portfolio_id: 1,
          relationship_manager_id: 10,
          title: 'X3',
          status: 'active',
          archived_reason: null,
        }],
      ]);

      await assert.rejects(
        invoke(fake.connection),
        (error) => (
          error.status === 409
          && error.code === 'ASSIGNMENT_STATE_MISMATCH'
        ),
      );
      assert.match(fake.calls[0].sql, /^SELECT \* FROM portfolios/);
      assert.match(fake.calls[0].sql, /FOR UPDATE/);
      assert.match(fake.calls[1].sql, /FROM conversations/);
      assert.match(fake.calls[1].sql, /FOR UPDATE/);
      assert.equal(
        fake.calls.some(({ sql }) => /^(UPDATE|INSERT|DELETE)/.test(sql)),
        false,
      );
      fake.assertConsumed();
    });
  }
});
