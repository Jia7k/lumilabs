const test = require('node:test');
const assert = require('node:assert/strict');
const {
  archiveConversationForPortfolio,
  prepareConversationForPortfolioDeletion,
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
    [{ id: 1, investor_id: 6, portfolio_id: 1 }],
    [{
      id: 12,
      portfolio_id: 1,
      title: 'X3',
      status: 'active',
      archived_reason: null,
    }],
    [{ user_id: 6, membership_status: 'active' }],
    { affectedRows: 1 },
    { affectedRows: 4 },
    { affectedRows: 1 },
    [{ active_count: 0 }],
    [{ user_id: 8 }, { user_id: 3 }],
    { affectedRows: 1 },
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
  assert.ok(fake.calls.some(({ sql }) => /DELETE FROM notifications/.test(sql)));
  assert.ok(fake.calls.some(({ sql }) => /archived_reason=\?/.test(sql)));
  assert.equal(fake.state.commits, 1);
  assert.equal(fake.state.rollbacks, 0);
  assert.equal(fake.state.releases, 1);
  fake.assertConsumed();
});

test('withdrawal keeps the room active when another investor remains', async () => {
  assert.equal(typeof withdrawInvestorInterest, 'function');
  const fake = scriptedConnection([
    [{ id: 1, investor_id: 6, portfolio_id: 1 }],
    [{
      id: 12,
      portfolio_id: 1,
      title: 'X3',
      status: 'active',
      archived_reason: null,
    }],
    [{ user_id: 6, membership_status: 'active' }],
    { affectedRows: 1 },
    { affectedRows: 3 },
    { affectedRows: 1 },
    [{ active_count: 1 }],
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
  fake.assertConsumed();
});

test('automatic portfolio archival replaces a prior manual reason atomically', async () => {
  assert.equal(typeof archiveConversationForPortfolio, 'function');
  const fake = scriptedConnection([
    [{
      id: 12,
      portfolio_id: 1,
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

test('portfolio deletion preserves room history but severs portfolio and investor access', async () => {
  assert.equal(typeof prepareConversationForPortfolioDeletion, 'function');
  const fake = scriptedConnection([
    [{
      id: 12,
      portfolio_id: 1,
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
