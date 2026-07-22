const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const servicePath = path.join(
  __dirname,
  '..',
  'src',
  'services',
  'managed-conversation-workflow.js',
);

function loadService() {
  assert.equal(fs.existsSync(servicePath), true, 'managed conversation service must exist');
  return require(servicePath);
}

function scriptedDatabase(responses) {
  const calls = [];
  const state = { begin: 0, commits: 0, rollbacks: 0, releases: 0 };
  const connection = {
    async beginTransaction() { state.begin += 1; },
    async query(sql, params = []) {
      calls.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params });
      assert.ok(responses.length, `unexpected query: ${sql}`);
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return [typeof response === 'function' ? response(sql, params) : response, []];
    },
    async commit() { state.commits += 1; },
    async rollback() { state.rollbacks += 1; },
    release() { state.releases += 1; },
  };
  return {
    database: { getConnection: async () => connection },
    calls,
    state,
    assertConsumed() { assert.equal(responses.length, 0, 'all scripted responses must be used'); },
  };
}

test('create derives owner and multiple investors from an approved portfolio and interests', async () => {
  const { createManagedConversation } = loadService();
  const fake = scriptedDatabase([
    [{ id: 8, name: 'Rachel Manager', role: 'relationship_manager' }],
    [{ id: 1, owner_id: 3, name: 'X3', status: 'approved', owner_name: 'Beta' }],
    [],
    [
      { interest_id: 1, investor_id: 6, investor_name: 'testing1' },
      { interest_id: 2, investor_id: 9, investor_name: 'leticia l' },
    ],
    { insertId: 12, affectedRows: 1 },
    { affectedRows: 4 },
    { affectedRows: 3 },
  ]);

  const result = await createManagedConversation({
    database: fake.database,
    managerId: 8,
    portfolioId: 1,
    interestIds: [2, 1, 2],
  });

  assert.equal(result.conversation_id, 12);
  assert.equal(result.portfolio_id, 1);
  assert.equal(result.title, 'X3');
  assert.deepEqual(result.owner, { id: 3, name: 'Beta' });
  assert.deepEqual(result.manager, { id: 8, name: 'Rachel Manager' });
  assert.deepEqual(result.investors.map(({ id }) => id), [6, 9]);
  assert.match(fake.calls[5].sql, /INSERT INTO conversation_members/);
  assert.equal(fake.calls[5].params[0].length, 4);
  assert.deepEqual(
    fake.calls[6].params[0].map((row) => row[0]),
    [3, 6, 9],
  );
  assert.equal(fake.state.commits, 1);
  assert.equal(fake.state.rollbacks, 0);
  assert.equal(fake.state.releases, 1);
  fake.assertConsumed();
});

test('one invalid interest rolls back the complete room creation', async () => {
  const { createManagedConversation } = loadService();
  const fake = scriptedDatabase([
    [{ id: 8, name: 'Rachel Manager', role: 'relationship_manager' }],
    [{ id: 1, owner_id: 3, name: 'X3', status: 'approved', owner_name: 'Beta' }],
    [],
    [{ interest_id: 1, investor_id: 6, investor_name: 'testing1' }],
  ]);

  await assert.rejects(
    createManagedConversation({
      database: fake.database,
      managerId: 8,
      portfolioId: 1,
      interestIds: [1, 99],
    }),
    (error) => error.status === 409 && error.code === 'INELIGIBLE_INTEREST',
  );
  assert.equal(fake.state.commits, 0);
  assert.equal(fake.state.rollbacks, 1);
  assert.equal(fake.state.releases, 1);
  fake.assertConsumed();
});

test('a portfolio already claimed by another manager returns a conflict', async () => {
  const { createManagedConversation } = loadService();
  const fake = scriptedDatabase([
    [{ id: 8, name: 'Rachel Manager', role: 'relationship_manager' }],
    [{ id: 1, owner_id: 3, name: 'X3', status: 'approved', owner_name: 'Beta' }],
    [{ id: 12, relationship_manager_id: 10 }],
  ]);

  await assert.rejects(
    createManagedConversation({
      database: fake.database,
      managerId: 8,
      portfolioId: 1,
      interestIds: [1],
    }),
    (error) => error.status === 409 && error.code === 'ROOM_ALREADY_CLAIMED',
  );
  assert.equal(fake.state.rollbacks, 1);
  fake.assertConsumed();
});

test('reactivating an investor uses the latest message as both visibility cursors', async () => {
  const { addManagedInvestors } = loadService();
  const fake = scriptedDatabase([
    [{
      id: 12,
      portfolio_id: 1,
      relationship_manager_id: 8,
      title: 'X3',
      status: 'archived',
      archived_reason: 'no_active_investors',
      portfolio_status: 'approved',
    }],
    [{ interest_id: 2, investor_id: 9, investor_name: 'leticia l' }],
    [{ user_id: 9, membership_status: 'removed' }],
    [{ latest_message_id: 41 }],
    [
      { user_id: 8, member_role: 'relationship_manager' },
      { user_id: 3, member_role: 'business_owner' },
    ],
    { affectedRows: 1 },
    { affectedRows: 2 },
    [
      { id: 8, name: 'Rachel Manager', role: 'relationship_manager' },
      { id: 3, name: 'Beta', role: 'business_owner' },
      { id: 9, name: 'leticia l', role: 'investor' },
    ],
  ]);

  const result = await addManagedInvestors({
    database: fake.database,
    managerId: 8,
    conversationId: 12,
    interestIds: [2],
  });

  assert.deepEqual(result.added_investor_ids, [9]);
  assert.match(fake.calls[5].sql, /UPDATE conversation_members/);
  assert.deepEqual(fake.calls[5].params.slice(0, 2), [41, 41]);
  assert.deepEqual(fake.calls[6].params[0].map((row) => row[0]), [9, 3]);
  assert.equal(
    fake.calls.some(({ sql }) => /UPDATE conversations SET status='active'/.test(sql)),
    false,
  );
  assert.equal(fake.state.commits, 1);
  fake.assertConsumed();
});

test('adding an already-active investor is idempotent and creates no notification', async () => {
  const { addManagedInvestors } = loadService();
  const fake = scriptedDatabase([
    [{
      id: 12,
      portfolio_id: 1,
      relationship_manager_id: 8,
      title: 'X3',
      status: 'active',
      archived_reason: null,
      portfolio_status: 'approved',
    }],
    [{ interest_id: 1, investor_id: 6, investor_name: 'testing1' }],
    [{ user_id: 6, membership_status: 'active' }],
    [
      { id: 8, name: 'Rachel Manager', role: 'relationship_manager' },
      { id: 3, name: 'Beta', role: 'business_owner' },
      { id: 6, name: 'testing1', role: 'investor' },
    ],
  ]);

  const result = await addManagedInvestors({
    database: fake.database,
    managerId: 8,
    conversationId: 12,
    interestIds: [1],
  });

  assert.deepEqual(result.added_investor_ids, []);
  assert.equal(fake.calls.some(({ sql }) => /INSERT INTO notifications/.test(sql)), false);
  assert.equal(fake.calls.some(({ sql }) => /MAX\(id\)/.test(sql)), false);
  assert.equal(fake.state.commits, 1);
  fake.assertConsumed();
});

test('assigned manager can archive once and repeat archive is idempotent', async () => {
  const { archiveManagedConversation } = loadService();
  const first = scriptedDatabase([
    [{
      id: 12,
      portfolio_id: 1,
      relationship_manager_id: 8,
      status: 'active',
      archived_reason: null,
      title: 'X3',
    }],
    [
      { user_id: 8 },
      { user_id: 3 },
      { user_id: 6 },
    ],
    { affectedRows: 1 },
    { affectedRows: 2 },
  ]);
  const archived = await archiveManagedConversation({
    database: first.database,
    managerId: 8,
    conversationId: 12,
  });
  assert.deepEqual(archived, {
    conversation_id: 12,
    status: 'archived',
    archived_reason: 'manual',
    changed: true,
  });
  assert.deepEqual(first.calls[3].params[0].map((row) => row[0]), [3, 6]);

  const repeated = scriptedDatabase([[
    {
      id: 12,
      portfolio_id: 1,
      relationship_manager_id: 8,
      status: 'archived',
      archived_reason: 'manual',
      title: 'X3',
    },
  ]]);
  assert.deepEqual(
    await archiveManagedConversation({
      database: repeated.database,
      managerId: 8,
      conversationId: 12,
    }),
    {
      conversation_id: 12,
      status: 'archived',
      archived_reason: 'manual',
      changed: false,
    },
  );
  assert.equal(repeated.calls.length, 1);
});

test('reopen requires an approved portfolio and an active eligible investor', async () => {
  const { reopenManagedConversation } = loadService();
  const fake = scriptedDatabase([
    [{
      id: 12,
      portfolio_id: 1,
      relationship_manager_id: 8,
      status: 'archived',
      archived_reason: 'manual',
      portfolio_status: 'approved',
    }],
    [{ eligible_count: 1 }],
    { affectedRows: 1 },
  ]);

  assert.deepEqual(
    await reopenManagedConversation({
      database: fake.database,
      managerId: 8,
      conversationId: 12,
    }),
    {
      conversation_id: 12,
      status: 'active',
      archived_reason: null,
      changed: true,
    },
  );
  assert.equal(fake.state.commits, 1);
  fake.assertConsumed();
});
