const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const servicePath = path.join(
  __dirname,
  '..',
  'src',
  'services',
  'group-message-workflow.js',
);

function loadService() {
  assert.equal(fs.existsSync(servicePath), true, 'group message service must exist');
  return require(servicePath);
}

function scriptedDatabase(poolResponses = [], transactionResponses = []) {
  const poolCalls = [];
  const transactionCalls = [];
  const state = { begin: 0, commits: 0, rollbacks: 0, releases: 0 };
  const take = (responses, sql, params) => {
    assert.ok(responses.length, `unexpected query: ${sql}`);
    const response = responses.shift();
    if (response instanceof Error) throw response;
    return [typeof response === 'function' ? response(sql, params) : response, []];
  };
  const connection = {
    async beginTransaction() { state.begin += 1; },
    async query(sql, params = []) {
      transactionCalls.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params });
      return take(transactionResponses, sql, params);
    },
    async commit() { state.commits += 1; },
    async rollback() { state.rollbacks += 1; },
    release() { state.releases += 1; },
  };
  return {
    database: {
      async query(sql, params = []) {
        poolCalls.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params });
        return take(poolResponses, sql, params);
      },
      async getConnection() { return connection; },
    },
    poolCalls,
    transactionCalls,
    state,
    assertConsumed() {
      assert.equal(poolResponses.length, 0, 'all pool responses must be consumed');
      assert.equal(transactionResponses.length, 0, 'all transaction responses must be consumed');
    },
  };
}

test('conversation list includes only accessible rooms with participants and unread state', async () => {
  const { listAccessibleConversations } = loadService();
  const fake = scriptedDatabase([
    [{
      id: 12,
      portfolio_id: 1,
      title: 'X3',
      status: 'active',
      archived_reason: null,
      unread_count: 2,
      latest_message_id: 51,
      latest_sender_id: 3,
      latest_sender_name: 'Beta',
      latest_content: 'Latest update',
      latest_created_at: '2026-07-22T13:00:00.000Z',
    }],
    [
      { conversation_id: 12, id: 8, name: 'Rachel Manager', role: 'relationship_manager' },
      { conversation_id: 12, id: 3, name: 'Beta', role: 'business_owner' },
      { conversation_id: 12, id: 6, name: 'testing1', role: 'investor' },
    ],
  ]);

  const rooms = await listAccessibleConversations({ database: fake.database, userId: 6 });
  assert.equal(rooms.length, 1);
  assert.equal(rooms[0].id, 12);
  assert.equal(rooms[0].unread_count, 2);
  assert.deepEqual(rooms[0].participants.map(({ role }) => role), [
    'relationship_manager',
    'business_owner',
    'investor',
  ]);
  assert.equal(rooms[0].latest_message.sender_name, 'Beta');
  assert.match(fake.poolCalls[0].sql, /membership_status='active'/);
  assert.match(fake.poolCalls[0].sql, /GREATEST\(cm\.visible_after_message_id,cm\.last_read_message_id\)/);
  fake.assertConsumed();
});

test('new investor thread excludes messages at or below the visibility boundary', async () => {
  const { loadConversationThread } = loadService();
  const fake = scriptedDatabase([], [
    [{
      id: 12,
      portfolio_id: 1,
      title: 'X3',
      status: 'active',
      archived_reason: null,
      user_id: 9,
      member_role: 'investor',
      membership_status: 'active',
      visible_after_message_id: 50,
      last_read_message_id: 50,
      unread_count: 2,
    }],
    [
      { id: 8, name: 'Rachel Manager', role: 'relationship_manager' },
      { id: 3, name: 'Beta', role: 'business_owner' },
      { id: 9, name: 'leticia l', role: 'investor' },
    ],
    [
      {
        id: 51,
        conversation_id: 12,
        sender_id: 8,
        sender_name: 'Rachel Manager',
        sender_role: 'relationship_manager',
        content: 'Welcome',
        created_at: '2026-07-22T13:01:00.000Z',
      },
      {
        id: 52,
        conversation_id: 12,
        sender_id: 3,
        sender_name: 'Beta',
        sender_role: 'business_owner',
        content: 'Hello',
        created_at: '2026-07-22T13:02:00.000Z',
      },
    ],
  ]);

  const thread = await loadConversationThread({
    database: fake.database,
    userId: 9,
    conversationId: 12,
  });
  assert.deepEqual(thread.messages.map(({ id }) => id), [51, 52]);
  assert.equal(thread.conversation.can_send, true);
  assert.deepEqual(thread.conversation.latest_message, {
    id: 52,
    sender_id: 3,
    sender_name: 'Beta',
    content: 'Hello',
    created_at: '2026-07-22T13:02:00.000Z',
  });
  assert.match(fake.transactionCalls[0].sql, /FOR UPDATE$/);
  assert.match(fake.transactionCalls[2].sql, /m\.id>\?/);
  assert.deepEqual(fake.transactionCalls[2].params, [12, 50]);
  assert.equal(fake.poolCalls.length, 0);
  assert.deepEqual(fake.state, {
    begin: 1,
    commits: 1,
    rollbacks: 0,
    releases: 1,
  });
  fake.assertConsumed();
});

test('nonmember receives 403 without participant or message queries', async () => {
  const { loadConversationThread } = loadService();
  const fake = scriptedDatabase([], [[
    {
      id: 12,
      portfolio_id: 1,
      title: 'X3',
      status: 'active',
      user_id: null,
      membership_status: null,
    },
  ]]);

  await assert.rejects(
    loadConversationThread({ database: fake.database, userId: 10, conversationId: 12 }),
    (error) => error.status === 403 && error.code === 'ROOM_ACCESS_DENIED',
  );
  assert.equal(fake.poolCalls.length, 0);
  assert.equal(fake.transactionCalls.length, 1);
  assert.match(fake.transactionCalls[0].sql, /FOR UPDATE$/);
  assert.equal(fake.state.rollbacks, 1);
  assert.equal(fake.state.releases, 1);
  fake.assertConsumed();
});

test('removed investor and replaced manager immediately receive 403', async () => {
  const { loadConversationThread } = loadService();
  for (const [userId, memberRole] of [
    [9, 'investor'],
    [8, 'relationship_manager'],
  ]) {
    const fake = scriptedDatabase([], [[
      {
        id: 12,
        portfolio_id: 1,
        title: 'X3',
        status: 'active',
        user_id: userId,
        member_role: memberRole,
        membership_status: 'removed',
      },
    ]]);

    await assert.rejects(
      loadConversationThread({
        database: fake.database,
        userId,
        conversationId: 12,
      }),
      (error) => error.status === 403 && error.code === 'ROOM_ACCESS_DENIED',
    );
    assert.equal(fake.poolCalls.length, 0);
    assert.equal(fake.transactionCalls.length, 1);
    assert.match(fake.transactionCalls[0].sql, /FOR UPDATE$/);
    assert.equal(fake.state.rollbacks, 1);
    fake.assertConsumed();
  }
});

test('manager full-history membership boundary loads the complete thread', async () => {
  const { loadConversationThread } = loadService();
  const fake = scriptedDatabase([], [
    [{
      id: 12,
      portfolio_id: 1,
      title: 'X3',
      status: 'active',
      archived_reason: null,
      user_id: 10,
      member_role: 'relationship_manager',
      membership_status: 'active',
      visible_after_message_id: 0,
      last_read_message_id: 0,
      unread_count: 3,
    }],
    [
      { id: 10, name: 'New Manager', role: 'relationship_manager' },
      { id: 3, name: 'Beta', role: 'business_owner' },
      { id: 9, name: 'Investor', role: 'investor' },
    ],
    [
      {
        id: 1,
        conversation_id: 12,
        sender_id: 8,
        sender_name: 'Old Manager',
        sender_role: 'relationship_manager',
        content: 'Historical context',
        created_at: '2026-07-20T13:00:00.000Z',
      },
      {
        id: 103,
        conversation_id: 12,
        sender_id: 3,
        sender_name: 'Beta',
        sender_role: 'business_owner',
        content: 'Current state',
        created_at: '2026-07-27T13:00:00.000Z',
      },
    ],
  ]);

  const thread = await loadConversationThread({
    database: fake.database,
    userId: 10,
    conversationId: 12,
  });
  assert.deepEqual(thread.messages.map(({ id }) => id), [1, 103]);
  assert.deepEqual(fake.transactionCalls[2].params, [12, 0]);
  assert.equal(fake.state.commits, 1);
  fake.assertConsumed();
});

test('thread read linearizes membership revocation and re-add visibility before disclosure', async (t) => {
  const { loadConversationThread } = loadService();

  function racingDatabase() {
    let membership = {
      user_id: 9,
      member_role: 'investor',
      membership_status: 'active',
      visible_after_message_id: 0,
      last_read_message_id: 0,
    };
    let participantQueries = 0;
    let messageQueries = 0;
    let signalAccess;
    let resumeAccess;
    const accessStarted = new Promise((resolve) => { signalAccess = resolve; });
    const resume = new Promise((resolve) => { resumeAccess = resolve; });
    const state = {
      begin: 0, commits: 0, rollbacks: 0, releases: 0,
    };

    const query = async (sql, params = []) => {
      const normalized = String(sql).replace(/\s+/g, ' ').trim();
      if (normalized.includes('FROM conversations c')) {
        const beforePause = { ...membership };
        signalAccess();
        await resume;
        const visibleMembership = /FOR UPDATE$/.test(normalized)
          ? membership
          : beforePause;
        return [[{
          id: 12,
          portfolio_id: 1,
          title: 'X3',
          status: 'active',
          archived_reason: null,
          unread_count: 0,
          ...visibleMembership,
        }], []];
      }
      if (normalized.includes('FROM conversation_members cm')) {
        participantQueries += 1;
        return [[
          { id: 8, name: 'Manager', role: 'relationship_manager' },
          { id: 3, name: 'Owner', role: 'business_owner' },
          { id: 9, name: 'Investor', role: 'investor' },
        ], []];
      }
      if (normalized.includes('FROM messages m')) {
        messageQueries += 1;
        const boundary = Number(params[1]);
        return [[
          {
            id: 10,
            conversation_id: 12,
            sender_id: 3,
            sender_name: 'Owner',
            sender_role: 'business_owner',
            content: 'Before re-add',
            created_at: '2026-07-27T10:00:00.000Z',
          },
          {
            id: 51,
            conversation_id: 12,
            sender_id: 8,
            sender_name: 'Manager',
            sender_role: 'relationship_manager',
            content: 'After re-add',
            created_at: '2026-07-27T11:00:00.000Z',
          },
        ].filter(({ id }) => id > boundary), []];
      }
      throw new Error(`Unexpected query: ${normalized}`);
    };
    const connection = {
      async beginTransaction() { state.begin += 1; },
      query,
      async commit() { state.commits += 1; },
      async rollback() { state.rollbacks += 1; },
      release() { state.releases += 1; },
    };
    return {
      database: {
        query,
        async getConnection() { return connection; },
      },
      accessStarted,
      revoke() {
        membership = { ...membership, membership_status: 'removed' };
        resumeAccess();
      },
      readdAt(boundary) {
        membership = {
          ...membership,
          membership_status: 'active',
          visible_after_message_id: boundary,
          last_read_message_id: boundary,
        };
        resumeAccess();
      },
      state,
      disclosures: () => ({ participantQueries, messageQueries }),
    };
  }

  await t.test('revoked investor receives no participants or messages', async () => {
    const fake = racingDatabase();
    const pending = loadConversationThread({
      database: fake.database,
      userId: 9,
      conversationId: 12,
    });
    await fake.accessStarted;
    fake.revoke();
    await assert.rejects(
      pending,
      (error) => error.status === 403 && error.code === 'ROOM_ACCESS_DENIED',
    );
    assert.deepEqual(fake.disclosures(), {
      participantQueries: 0,
      messageQueries: 0,
    });
  });

  await t.test('re-added investor cannot bypass the new message boundary', async () => {
    const fake = racingDatabase();
    const pending = loadConversationThread({
      database: fake.database,
      userId: 9,
      conversationId: 12,
    });
    await fake.accessStarted;
    fake.readdAt(50);
    const thread = await pending;
    assert.deepEqual(thread.messages.map(({ id }) => id), [51]);
    assert.deepEqual(fake.disclosures(), {
      participantQueries: 1,
      messageQueries: 1,
    });
    assert.equal(fake.state.commits, 1);
  });
});

test('send inserts one message and notifies every other active member', async () => {
  const { sendConversationMessage } = loadService();
  const fake = scriptedDatabase([], [
    [{
      id: 12,
      portfolio_id: 1,
      title: 'X3',
      status: 'active',
      archived_reason: null,
      user_id: 8,
      member_role: 'relationship_manager',
      membership_status: 'active',
      visible_after_message_id: 0,
      last_read_message_id: 0,
    }],
    [{ user_id: 3 }, { user_id: 6 }, { user_id: 9 }],
    { insertId: 53, affectedRows: 1 },
    { affectedRows: 3 },
    [{
      id: 53,
      conversation_id: 12,
      sender_id: 8,
      sender_name: 'Rachel Manager',
      sender_role: 'relationship_manager',
      content: 'Welcome everyone',
      created_at: '2026-07-22T13:03:00.000Z',
    }],
  ]);

  const saved = await sendConversationMessage({
    database: fake.database,
    user: { id: 8, name: 'Rachel Manager', role: 'relationship_manager' },
    conversationId: 12,
    content: '  Welcome everyone  ',
  });
  assert.equal(saved.content, 'Welcome everyone');
  assert.deepEqual(
    fake.transactionCalls[3].params[0].map((row) => row[0]),
    [3, 6, 9],
  );
  assert.equal(fake.state.commits, 1);
  assert.equal(fake.state.rollbacks, 0);
  fake.assertConsumed();
});

test('archived rooms reject sends without inserting a message', async () => {
  const { sendConversationMessage } = loadService();
  const fake = scriptedDatabase([], [[{
    id: 12,
    portfolio_id: 1,
    title: 'X3',
    status: 'archived',
    archived_reason: 'manual',
    user_id: 8,
    member_role: 'relationship_manager',
    membership_status: 'active',
    visible_after_message_id: 0,
    last_read_message_id: 0,
  }]]);

  await assert.rejects(
    sendConversationMessage({
      database: fake.database,
      user: { id: 8, name: 'Rachel Manager', role: 'relationship_manager' },
      conversationId: 12,
      content: 'Cannot send',
    }),
    (error) => error.status === 409 && error.code === 'ROOM_ARCHIVED',
  );
  assert.equal(fake.transactionCalls.length, 1);
  assert.equal(fake.state.commits, 0);
  assert.equal(fake.state.rollbacks, 1);
  fake.assertConsumed();
});

test('notification insertion failure rolls back the message', async () => {
  const { sendConversationMessage } = loadService();
  const fake = scriptedDatabase([], [
    [{
      id: 12,
      portfolio_id: 1,
      title: 'X3',
      status: 'active',
      user_id: 8,
      membership_status: 'active',
    }],
    [{ user_id: 3 }],
    { insertId: 53, affectedRows: 1 },
    new Error('notification insert failed'),
  ]);

  await assert.rejects(
    sendConversationMessage({
      database: fake.database,
      user: { id: 8, name: 'Rachel Manager', role: 'relationship_manager' },
      conversationId: 12,
      content: 'Rollback me',
    }),
    /notification insert failed/,
  );
  assert.equal(fake.state.commits, 0);
  assert.equal(fake.state.rollbacks, 1);
  fake.assertConsumed();
});

test('rollback failure destroys the group-message connection without leaking its cause', {
  concurrency: false,
}, async (t) => {
  const { sendConversationMessage } = loadService();
  const originalError = console.error;
  const logs = [];
  console.error = (...parts) => logs.push(parts);
  t.after(() => {
    console.error = originalError;
  });

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
        rollbacks: 0, destroys: 0, releases: 0,
      };
      const connection = {
        async beginTransaction() {},
        async query() {
          return [[{
            id: 12,
            title: 'X3',
            status: 'archived',
            user_id: 8,
            membership_status: 'active',
          }], []];
        },
        async commit() {
          assert.fail('commit must not run');
        },
        async rollback() {
          state.rollbacks += 1;
          throw new Error('rollback password sentinel');
        },
        release() { state.releases += 1; },
        destroy() { return destroy(state); },
      };

      let caught;
      try {
        await sendConversationMessage({
          database: { getConnection: async () => connection },
          user: { id: 8, name: 'Manager' },
          conversationId: 12,
          content: 'Cannot send',
        });
      } catch (error) {
        caught = error;
      }

      assert.equal(caught.status, 409);
      assert.equal(caught.code, 'ROOM_ARCHIVED');
      assert.equal(Object.hasOwn(caught, 'rollbackError'), false);
      assert.doesNotMatch(JSON.stringify(caught), /rollback|password|sentinel|destroy|secret/i);
      assert.deepEqual(state, {
        rollbacks: 1, destroys: 1, releases: 0,
      });
    });
  }
  assert.deepEqual(logs, [
    ['Group message rollback failed'],
    ['Group message rollback failed'],
    ['Group message rollback failed'],
    ['Group message rollback failed'],
  ]);
});

test('read cursor validates visibility and advances member plus notifications together', async () => {
  const { markConversationRead } = loadService();
  const fake = scriptedDatabase([], [
    [{
      id: 12,
      status: 'active',
      user_id: 9,
      membership_status: 'active',
      visible_after_message_id: 40,
      last_read_message_id: 45,
    }],
    [{ id: 50, conversation_id: 12 }],
    { affectedRows: 1 },
    { affectedRows: 2 },
  ]);

  assert.deepEqual(
    await markConversationRead({
      database: fake.database,
      userId: 9,
      conversationId: 12,
      messageId: 50,
    }),
    { conversation_id: 12, last_read_message_id: 50 },
  );
  assert.match(fake.transactionCalls[2].sql, /GREATEST\(last_read_message_id,\?\)/);
  assert.match(fake.transactionCalls[3].sql, /related_message_id<=\?/);
  assert.equal(fake.state.commits, 1);
  fake.assertConsumed();
});
