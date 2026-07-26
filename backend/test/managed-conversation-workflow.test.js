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
    [{
      id: 1,
      owner_id: 3,
      name: 'X3',
      status: 'approved',
      relationship_manager_id: 8,
      owner_name: 'Beta',
    }],
    [],
    [{ id: 8, name: 'Rachel Manager', role: 'relationship_manager' }],
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
  assert.match(fake.calls[0].sql, /FROM portfolios p/);
  assert.match(fake.calls[0].sql, /FOR UPDATE/);
  assert.match(fake.calls[1].sql, /FROM conversations/);
  assert.match(fake.calls[2].sql, /FROM users/);
  assert.match(fake.calls[5].sql, /INSERT INTO conversation_members/);
  assert.equal(fake.calls[5].params[0].length, 4);
  assert.deepEqual(fake.calls[5].params[0].slice(0, 2), [
    [12, 8, 'relationship_manager', 0, 0],
    [12, 3, 'business_owner', 0, 0],
  ]);
  assert.deepEqual(
    fake.calls[6].params[0].map((row) => row[0]),
    [3, 6, 9],
  );
  assert.equal(fake.state.commits, 1);
  assert.equal(fake.state.rollbacks, 0);
  assert.equal(fake.state.releases, 1);
  fake.assertConsumed();
});

test('create accepts one current investor and adds manager and owner with full history', async () => {
  const { createManagedConversation } = loadService();
  const fake = scriptedDatabase([
    [{
      id: 1,
      owner_id: 3,
      name: 'X3',
      status: 'approved',
      relationship_manager_id: 8,
      owner_name: 'Beta',
    }],
    [],
    [{ id: 8, name: 'Rachel Manager', role: 'relationship_manager' }],
    [{ interest_id: 1, investor_id: 6, investor_name: 'testing1' }],
    { insertId: 12, affectedRows: 1 },
    { affectedRows: 3 },
    { affectedRows: 2 },
  ]);

  await createManagedConversation({
    database: fake.database,
    managerId: 8,
    portfolioId: 1,
    interestIds: [1],
  });

  assert.deepEqual(fake.calls[5].params[0], [
    [12, 8, 'relationship_manager', 0, 0],
    [12, 3, 'business_owner', 0, 0],
    [12, 6, 'investor', 0, 0],
  ]);
  assert.deepEqual(fake.calls[6].params[0].map((row) => row[0]), [3, 6]);
  fake.assertConsumed();
});

test('one invalid interest rolls back the complete room creation', async () => {
  const { createManagedConversation } = loadService();
  const fake = scriptedDatabase([
    [{
      id: 1,
      owner_id: 3,
      name: 'X3',
      status: 'approved',
      relationship_manager_id: 8,
      owner_name: 'Beta',
    }],
    [],
    [{ id: 8, name: 'Rachel Manager', role: 'relationship_manager' }],
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
    [{
      id: 1,
      owner_id: 3,
      name: 'X3',
      status: 'approved',
      relationship_manager_id: 8,
      owner_name: 'Beta',
    }],
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

test('a concurrent duplicate room insert maps to the stable room conflict and rolls back', async () => {
  const { createManagedConversation } = loadService();
  const duplicate = new Error('duplicate');
  duplicate.code = 'ER_DUP_ENTRY';
  const fake = scriptedDatabase([
    [{
      id: 1,
      owner_id: 3,
      name: 'X3',
      status: 'approved',
      relationship_manager_id: 8,
      owner_name: 'Beta',
    }],
    [],
    [{ id: 8, name: 'Rachel Manager', role: 'relationship_manager' }],
    [{ interest_id: 1, investor_id: 6, investor_name: 'testing1' }],
    duplicate,
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
  assert.equal(fake.state.commits, 0);
  assert.equal(fake.state.rollbacks, 1);
  fake.assertConsumed();
});

test('only the canonical portfolio assignment can create its one chat', async () => {
  const { createManagedConversation } = loadService();
  const fake = scriptedDatabase([[
    {
      id: 1,
      owner_id: 3,
      name: 'X3',
      status: 'approved',
      relationship_manager_id: 10,
      owner_name: 'Beta',
    },
  ]]);

  await assert.rejects(
    createManagedConversation({
      database: fake.database,
      managerId: 8,
      portfolioId: 1,
      interestIds: [1],
    }),
    (error) => error.status === 403 && error.code === 'NOT_ASSIGNED_MANAGER',
  );
  assert.equal(fake.calls.length, 1);
  assert.equal(fake.state.commits, 0);
  assert.equal(fake.state.rollbacks, 1);
  fake.assertConsumed();
});

test('reactivating an investor uses the latest message as both visibility cursors', async () => {
  const { addManagedInvestors } = loadService();
  const fake = scriptedDatabase([
    [{ id: 12, portfolio_id: 1 }],
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
      archived_reason: 'no_active_investors',
      portfolio_status: 'approved',
    }],
    [{ id: 8, name: 'Rachel Manager', role: 'relationship_manager' }],
    [{ interest_id: 2, investor_id: 9, investor_name: 'leticia l' }],
    [{ user_id: 9, membership_status: 'removed' }],
    [{ latest_message_id: 41 }],
    [
      { user_id: 8, member_role: 'relationship_manager' },
      { user_id: 3, member_role: 'business_owner' },
    ],
    { affectedRows: 1 },
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
  const membershipUpdate = fake.calls.find(({ sql }) => /UPDATE conversation_members/.test(sql));
  assert.deepEqual(membershipUpdate.params.slice(0, 2), [41, 41]);
  const roomUpdate = fake.calls.find(({ sql }) => (
    /UPDATE conversations/.test(sql) && /status='active'/.test(sql)
  ));
  assert.ok(roomUpdate);
  assert.deepEqual(roomUpdate.params, [12]);
  const notification = fake.calls.find(({ sql }) => /INSERT INTO notifications/.test(sql));
  assert.deepEqual(notification.params[0].map((row) => row[0]), [9, 3]);
  assert.equal(fake.state.commits, 1);
  fake.assertConsumed();
});

test('adding an already-active investor is idempotent and creates no notification', async () => {
  const { addManagedInvestors } = loadService();
  const fake = scriptedDatabase([
    [{ id: 12, portfolio_id: 1 }],
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
      portfolio_status: 'approved',
    }],
    [{ id: 8, name: 'Rachel Manager', role: 'relationship_manager' }],
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

test('adding an investor never reactivates a stronger archived state', async () => {
  const { addManagedInvestors } = loadService();
  const fake = scriptedDatabase([
    [{ id: 12, portfolio_id: 1 }],
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
    [{ id: 8, name: 'Rachel Manager', role: 'relationship_manager' }],
    [{ interest_id: 2, investor_id: 9, investor_name: 'leticia l' }],
    [{ user_id: 9, member_role: 'investor', membership_status: 'removed' }],
    [{ latest_message_id: 103 }],
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

  await addManagedInvestors({
    database: fake.database,
    managerId: 8,
    conversationId: 12,
    interestIds: [2],
  });

  assert.equal(
    fake.calls.some(({ sql }) => (
      /UPDATE conversations/.test(sql) && /status='active'/.test(sql)
    )),
    false,
  );
  fake.assertConsumed();
});

test('an old conversation manager cannot add investors after reassignment', async () => {
  const { addManagedInvestors } = loadService();
  const fake = scriptedDatabase([
    [{ id: 12, portfolio_id: 1 }],
    [{
      id: 1,
      owner_id: 3,
      name: 'X3',
      status: 'approved',
      relationship_manager_id: 10,
    }],
  ]);

  await assert.rejects(
    addManagedInvestors({
      database: fake.database,
      managerId: 8,
      conversationId: 12,
      interestIds: [1],
    }),
    (error) => error.status === 403 && error.code === 'NOT_ASSIGNED_MANAGER',
  );
  assert.equal(fake.state.rollbacks, 1);
  fake.assertConsumed();
});

test('manual lifecycle functions are not exported', () => {
  const service = loadService();
  assert.equal(Object.hasOwn(service, 'archiveManagedConversation'), false);
  assert.equal(Object.hasOwn(service, 'reopenManagedConversation'), false);
});

test('manual removal preserves interest and history, notifies safely, and archives the last investor', async () => {
  const { removeManagedInvestor } = loadService();
  assert.equal(typeof removeManagedInvestor, 'function');
  const fake = scriptedDatabase([
    [{ id: 12, portfolio_id: 1 }],
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
      status: 'active',
      archived_reason: null,
      title: 'X3',
    }],
    [{ id: 8, name: 'Rachel Manager', role: 'relationship_manager' }],
    [{ id: 31, investor_id: 9, portfolio_id: 1 }],
    [{ user_id: 9, member_role: 'investor', membership_status: 'active' }],
    [{ user_id: 9 }],
    [{ user_id: 3 }],
    { affectedRows: 1 },
    { affectedRows: 1 },
    { affectedRows: 2 },
  ]);

  const result = await removeManagedInvestor({
    database: fake.database,
    managerId: 8,
    conversationId: 12,
    investorId: 9,
  });

  assert.deepEqual(result, {
    changed: true,
    investor_id: 9,
    archived: true,
  });
  assert.equal(fake.calls.some(({ sql }) => /DELETE FROM investor_interests/.test(sql)), false);
  assert.equal(fake.calls.some(({ sql }) => /DELETE FROM messages/.test(sql)), false);
  assert.equal(fake.calls.some(({ sql }) => /DELETE FROM notifications/.test(sql)), false);
  const notification = fake.calls.find(({ sql }) => /INSERT INTO notifications/.test(sql));
  assert.deepEqual(notification.params[0].map((row) => row[0]), [9, 3]);
  assert.equal(notification.params[0][0][5], null);
  assert.equal(notification.params[0][1][5], 12);
  assert.ok(fake.calls.some(({ sql, params }) => (
    /UPDATE conversations/.test(sql)
    && /archived_reason=\?/.test(sql)
    && params[0] === 'no_active_investors'
  )));
  assert.equal(fake.state.commits, 1);
  fake.assertConsumed();
});

test('manual removal is idempotent and emits no writes or notifications', async () => {
  const { removeManagedInvestor } = loadService();
  const fake = scriptedDatabase([
    [{ id: 12, portfolio_id: 1 }],
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
      status: 'archived',
      archived_reason: 'no_active_investors',
      title: 'X3',
    }],
    [{ id: 8, name: 'Rachel Manager', role: 'relationship_manager' }],
    [{ id: 31, investor_id: 9, portfolio_id: 1 }],
    [{ user_id: 9, member_role: 'investor', membership_status: 'removed' }],
    [],
    [{ user_id: 3 }],
  ]);

  assert.deepEqual(
    await removeManagedInvestor({
      database: fake.database,
      managerId: 8,
      conversationId: 12,
      investorId: 9,
    }),
    { changed: false, investor_id: 9, archived: true },
  );
  assert.equal(fake.calls.some(({ sql }) => /^(UPDATE|INSERT|DELETE)/.test(sql)), false);
  assert.equal(fake.state.commits, 1);
  fake.assertConsumed();
});

test('manual removal keeps the room active when another eligible investor remains', async () => {
  const { removeManagedInvestor } = loadService();
  const fake = scriptedDatabase([
    [{ id: 12, portfolio_id: 1 }],
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
      status: 'active',
      archived_reason: null,
      title: 'X3',
    }],
    [{ id: 8, name: 'Rachel Manager', role: 'relationship_manager' }],
    [{ id: 31, investor_id: 9, portfolio_id: 1 }],
    [{ user_id: 9, member_role: 'investor', membership_status: 'active' }],
    [{ user_id: 9 }, { user_id: 11 }],
    [{ user_id: 3 }],
    { affectedRows: 1 },
    { affectedRows: 2 },
  ]);

  assert.deepEqual(
    await removeManagedInvestor({
      database: fake.database,
      managerId: 8,
      conversationId: 12,
      investorId: 9,
    }),
    { changed: true, investor_id: 9, archived: false },
  );
  assert.equal(fake.calls.some(({ sql }) => /UPDATE conversations/.test(sql)), false);
  fake.assertConsumed();
});

test('manual removal rolls back membership and archive changes when notification insertion fails', async () => {
  const { removeManagedInvestor } = loadService();
  const fake = scriptedDatabase([
    [{ id: 12, portfolio_id: 1 }],
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
      status: 'active',
      archived_reason: null,
      title: 'X3',
    }],
    [{ id: 8, name: 'Rachel Manager', role: 'relationship_manager' }],
    [{ id: 31, investor_id: 9, portfolio_id: 1 }],
    [{ user_id: 9, member_role: 'investor', membership_status: 'active' }],
    [{ user_id: 9 }],
    [{ user_id: 3 }],
    { affectedRows: 1 },
    { affectedRows: 1 },
    new Error('notification insertion failed'),
  ]);

  await assert.rejects(
    removeManagedInvestor({
      database: fake.database,
      managerId: 8,
      conversationId: 12,
      investorId: 9,
    }),
    /notification insertion failed/,
  );
  assert.equal(fake.state.commits, 0);
  assert.equal(fake.state.rollbacks, 1);
  fake.assertConsumed();
});

test('rollback failure destroys the uncertain connection without exposing or replacing the primary error', async (t) => {
  const { createManagedConversation, ManagedConversationError } = loadService();
  for (const [label, destroy] of [
    ['sync destroy', (state) => { state.destroys += 1; }],
    ['async destroy', async (state) => { state.destroys += 1; }],
    ['throwing destroy', (state) => {
      state.destroys += 1;
      throw new Error('destroy secret');
    }],
    ['rejecting destroy', async (state) => {
      state.destroys += 1;
      throw new Error('destroy rejection secret');
    }],
  ]) {
    await t.test(label, async () => {
      const state = {
        begins: 0,
        rollbacks: 0,
        releases: 0,
        destroys: 0,
      };
      const connection = {
        async beginTransaction() { state.begins += 1; },
        async query() {
          return [[{
            id: 1,
            owner_id: 3,
            name: 'X3',
            status: 'approved',
            relationship_manager_id: 10,
            owner_name: 'Beta',
          }], []];
        },
        async commit() {
          assert.fail('commit must not run');
        },
        async rollback() {
          state.rollbacks += 1;
          throw new Error('rollback sql password secret');
        },
        release() { state.releases += 1; },
        destroy() { return destroy(state); },
      };

      let caught;
      try {
        await createManagedConversation({
          database: { getConnection: async () => connection },
          managerId: 8,
          portfolioId: 1,
          interestIds: [31],
        });
      } catch (error) {
        caught = error;
      }

      assert.ok(caught instanceof ManagedConversationError);
      assert.equal(caught.status, 403);
      assert.equal(caught.code, 'NOT_ASSIGNED_MANAGER');
      assert.equal(caught.message, 'Only the assigned relationship manager can manage this conversation');
      assert.equal(Object.hasOwn(caught, 'rollbackError'), false);
      assert.doesNotMatch(JSON.stringify(caught), /rollback|password|destroy|secret/i);
      assert.deepEqual(state, {
        begins: 1,
        rollbacks: 1,
        releases: 0,
        destroys: 1,
      });
    });
  }
});
