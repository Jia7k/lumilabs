const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SuperadminAssignmentError,
  assignPortfolio,
  unassignPortfolio,
} = require('../src/services/superadmin-assignment-workflow');

const users = [
  { id: 1, name: 'Root Admin', email: 'root@example.test', role: 'superadmin' },
  { id: 7, name: 'Old Manager', email: 'old@example.test', role: 'relationship_manager' },
  { id: 8, name: 'New Manager', email: 'new@example.test', role: 'relationship_manager' },
  { id: 9, name: 'Owner', email: 'owner@example.test', role: 'business_owner' },
  { id: 10, name: 'Ordinary Admin', email: 'admin@example.test', role: 'admin' },
  { id: 11, name: 'Investor One', email: 'one@example.test', role: 'investor' },
  { id: 12, name: 'Investor Two', email: 'two@example.test', role: 'investor' },
];

const unassignedFixture = {
  users,
  portfolios: [{
    id: 20,
    name: 'Example',
    status: 'approved',
    owner_id: 9,
    relationship_manager_id: null,
  }],
  conversations: [],
  members: [],
  messages: [],
};

const assignedFixture = {
  ...unassignedFixture,
  portfolios: [{
    ...unassignedFixture.portfolios[0],
    relationship_manager_id: 7,
  }],
};

const postChatFixture = {
  ...assignedFixture,
  conversations: [{
    id: 40,
    portfolio_id: 20,
    relationship_manager_id: 7,
    status: 'active',
    archived_reason: null,
  }],
  members: [
    {
      conversation_id: 40,
      user_id: 7,
      member_role: 'relationship_manager',
      membership_status: 'active',
      visible_after_message_id: 0,
      last_read_message_id: 103,
      left_at: null,
    },
    {
      conversation_id: 40,
      user_id: 8,
      member_role: 'relationship_manager',
      membership_status: 'removed',
      visible_after_message_id: 103,
      last_read_message_id: 103,
      left_at: '2026-07-26 00:00:00',
    },
    {
      conversation_id: 40,
      user_id: 9,
      member_role: 'business_owner',
      membership_status: 'active',
      visible_after_message_id: 0,
      last_read_message_id: 0,
      left_at: null,
    },
    {
      conversation_id: 40,
      user_id: 11,
      member_role: 'investor',
      membership_status: 'active',
      visible_after_message_id: 0,
      last_read_message_id: 0,
      left_at: null,
    },
    {
      conversation_id: 40,
      user_id: 12,
      member_role: 'investor',
      membership_status: 'active',
      visible_after_message_id: 0,
      last_read_message_id: 0,
      left_at: null,
    },
  ],
  messages: [
    { id: 101, conversation_id: 40, sender_id: 7, content: 'First' },
    { id: 102, conversation_id: 40, sender_id: 11, content: 'Second' },
    { id: 103, conversation_id: 40, sender_id: 9, content: 'Third' },
  ],
};

function clone(value) {
  return structuredClone(value);
}

function normalizedSql(sql) {
  return String(sql).replace(/\s+/g, ' ').trim();
}

function assignmentHarness(fixture, options = {}) {
  let state = {
    users: clone(fixture.users || []),
    portfolios: clone(fixture.portfolios || []),
    conversations: clone(fixture.conversations || []),
    members: clone(fixture.members || []),
    messages: clone(fixture.messages || []),
    audits: clone(fixture.audits || []),
    notifications: clone(fixture.notifications || []),
  };
  let transactionSnapshot = null;
  const initialState = clone(state);
  const calls = [];
  let begins = 0;
  let commits = 0;
  let rollbacks = 0;
  let releases = 0;
  let writeCount = 0;

  function finishWrite(result) {
    writeCount += 1;
    if (writeCount === options.failAfterWrite) {
      throw options.writeError || new Error(`injected write failure ${writeCount}`);
    }
    return [result, []];
  }

  const connection = {
    async beginTransaction() {
      begins += 1;
      transactionSnapshot = clone(state);
    },
    async query(sqlValue, params = []) {
      const sql = normalizedSql(sqlValue);
      calls.push({ sql, params: clone(params) });

      if (sql.includes('FROM portfolios p') && sql.includes('JOIN users owner')) {
        const portfolio = state.portfolios.find((row) => row.id === params[0]);
        if (!portfolio) return [[], []];
        const owner = state.users.find((row) => row.id === portfolio.owner_id);
        return [[{
          ...clone(portfolio),
          owner_name: owner.name,
          owner_email: owner.email,
        }], []];
      }

      if (sql.includes('FROM conversations') && sql.includes('WHERE portfolio_id=?')) {
        return [[
          ...state.conversations
            .filter((row) => row.portfolio_id === params[0])
            .map(clone),
        ], []];
      }

      if (sql.includes('FROM users') && sql.includes('WHERE id IN (?,?,?)')) {
        const requested = new Set(params);
        return [[
          ...state.users
            .filter((row) => requested.has(row.id))
            .sort((left, right) => left.id - right.id)
            .map(clone),
        ], []];
      }

      if (
        sql.includes('FROM conversation_members')
        && sql.includes("member_role='relationship_manager'")
        && sql.includes("membership_status='active'")
      ) {
        const rows = options.activeManagerIds
          ? options.activeManagerIds.map((user_id) => ({ user_id }))
          : state.members
            .filter((row) => (
              row.conversation_id === params[0]
              && row.member_role === 'relationship_manager'
              && row.membership_status === 'active'
            ))
            .map((row) => ({ user_id: row.user_id }));
        return [rows, []];
      }

      if (
        sql.startsWith('UPDATE portfolios')
        && sql.includes('SET relationship_manager_id=?')
      ) {
        const [managerId, portfolioId, expectedManagerId] = params;
        const portfolio = state.portfolios.find((row) => (
          row.id === portfolioId
          && (
            expectedManagerId === undefined
            || row.relationship_manager_id === expectedManagerId
          )
        ));
        if (portfolio) portfolio.relationship_manager_id = managerId;
        return finishWrite({ affectedRows: portfolio ? 1 : 0 });
      }

      if (
        sql.startsWith('UPDATE portfolios')
        && sql.includes('SET relationship_manager_id=NULL')
      ) {
        const [portfolioId, expectedManagerId] = params;
        const portfolio = state.portfolios.find((row) => (
          row.id === portfolioId
          && row.relationship_manager_id === expectedManagerId
        ));
        if (portfolio) portfolio.relationship_manager_id = null;
        return finishWrite({ affectedRows: portfolio ? 1 : 0 });
      }

      if (
        sql.startsWith('UPDATE conversation_members')
        && sql.includes("membership_status='removed'")
      ) {
        const [conversationId, managerId] = params;
        const member = state.members.find((row) => (
          row.conversation_id === conversationId
          && row.user_id === managerId
          && row.member_role === 'relationship_manager'
          && row.membership_status === 'active'
        ));
        if (member) {
          member.membership_status = 'removed';
          member.left_at = 'CURRENT_TIMESTAMP';
        }
        return finishWrite({ affectedRows: member ? 1 : 0 });
      }

      if (sql.startsWith('INSERT INTO conversation_members')) {
        assert.match(sql, /last_read_message_id/);
        assert.doesNotMatch(sql, /last_read_at/);
        const [conversationId, managerId] = params;
        let member = state.members.find((row) => (
          row.conversation_id === conversationId && row.user_id === managerId
        ));
        if (member) {
          member.member_role = 'relationship_manager';
          member.membership_status = 'active';
          member.visible_after_message_id = 0;
          member.left_at = null;
        } else {
          member = {
            conversation_id: conversationId,
            user_id: managerId,
            member_role: 'relationship_manager',
            membership_status: 'active',
            visible_after_message_id: 0,
            last_read_message_id: 0,
            left_at: null,
          };
          state.members.push(member);
        }
        return finishWrite({ affectedRows: 1 });
      }

      if (sql.startsWith('UPDATE conversations SET relationship_manager_id=?')) {
        const [managerId, conversationId, expectedManagerId] = params;
        const conversation = state.conversations.find((row) => (
          row.id === conversationId
          && (
            expectedManagerId === undefined
            || row.relationship_manager_id === expectedManagerId
          )
        ));
        if (conversation) conversation.relationship_manager_id = managerId;
        return finishWrite({ affectedRows: conversation ? 1 : 0 });
      }

      if (sql.startsWith('INSERT INTO superadmin_audit_logs')) {
        const columns = [
          'superadmin_id',
          'superadmin_id_snapshot',
          'superadmin_name_snapshot',
          'superadmin_email_snapshot',
          'action',
          'portfolio_id',
          'portfolio_id_snapshot',
          'portfolio_name_snapshot',
          'previous_relationship_manager_id',
          'previous_relationship_manager_id_snapshot',
          'previous_relationship_manager_name_snapshot',
          'previous_relationship_manager_email_snapshot',
          'new_relationship_manager_id',
          'new_relationship_manager_id_snapshot',
          'new_relationship_manager_name_snapshot',
          'new_relationship_manager_email_snapshot',
        ];
        assert.match(sql, new RegExp(columns.join('[\\s,]+')));
        state.audits.push(Object.fromEntries(
          columns.map((column, index) => [column, params[index]]),
        ));
        return finishWrite({ affectedRows: 1, insertId: state.audits.length });
      }

      if (sql.startsWith('INSERT INTO notifications')) {
        assert.equal(params.length, 1);
        for (const values of params[0]) {
          const [
            user_id,
            type,
            title,
            body,
            related_portfolio_id,
            related_conversation_id,
            related_user_id,
          ] = values;
          state.notifications.push({
            user_id,
            type,
            title,
            body,
            related_portfolio_id,
            related_conversation_id,
            related_user_id,
          });
        }
        return finishWrite({ affectedRows: params[0].length });
      }

      throw new Error(`Unexpected SQL: ${sql}`);
    },
    async commit() {
      commits += 1;
      transactionSnapshot = null;
    },
    async rollback() {
      rollbacks += 1;
      if (options.rollbackError) throw options.rollbackError;
      state = clone(transactionSnapshot);
      transactionSnapshot = null;
    },
    release() {
      releases += 1;
    },
  };

  return {
    get commits() { return commits; },
    get rollbacks() { return rollbacks; },
    get releases() { return releases; },
    get writeCount() { return writeCount; },
    calls,
    async getConnection() {
      begins += 0;
      return connection;
    },
    get begins() { return begins; },
    portfolio(id) {
      return clone(state.portfolios.find((row) => row.id === id));
    },
    conversation(id) {
      return clone(state.conversations.find((row) => row.id === id));
    },
    member(conversationId, userId) {
      return clone(state.members.find((row) => (
        row.conversation_id === conversationId && row.user_id === userId
      )));
    },
    activeMembers(conversationId, role) {
      return state.members
        .filter((row) => (
          row.conversation_id === conversationId
          && row.member_role === role
          && row.membership_status === 'active'
        ))
        .map((row) => row.user_id)
        .sort((left, right) => left - right);
    },
    activeInvestorIds(conversationId) {
      return this.activeMembers(conversationId, 'investor');
    },
    messageIds(conversationId) {
      return state.messages
        .filter((row) => row.conversation_id === conversationId)
        .map((row) => row.id);
    },
    auditActions() {
      return state.audits.map((row) => row.action);
    },
    auditRows() {
      return clone(state.audits);
    },
    notificationRecipientIds() {
      return state.notifications
        .map((row) => row.user_id)
        .sort((left, right) => left - right);
    },
    notificationFor(userId) {
      return clone(state.notifications.find((row) => row.user_id === userId));
    },
    snapshot() {
      return clone(state);
    },
    initialSnapshot() {
      return clone(initialState);
    },
  };
}

function isAssignmentError(status, code) {
  return (error) => (
    error instanceof SuperadminAssignmentError
    && error.status === status
    && error.code === code
  );
}

test('initial assignment changes only the canonical portfolio and records snapshots', async () => {
  const database = assignmentHarness(unassignedFixture);

  const result = await assignPortfolio({
    database,
    superadminId: 1,
    portfolioId: 20,
    relationshipManagerId: 8,
  });

  assert.deepEqual(result, {
    changed: true,
    action: 'portfolio_assigned',
    portfolio: { id: 20, name: 'Example', status: 'approved' },
    previous_relationship_manager: null,
    relationship_manager: {
      id: 8,
      name: 'New Manager',
      email: 'new@example.test',
    },
    conversation_id: null,
  });
  assert.equal(database.portfolio(20).relationship_manager_id, 8);
  assert.deepEqual(database.auditRows(), [{
    superadmin_id: 1,
    superadmin_id_snapshot: 1,
    superadmin_name_snapshot: 'Root Admin',
    superadmin_email_snapshot: 'root@example.test',
    action: 'portfolio_assigned',
    portfolio_id: 20,
    portfolio_id_snapshot: 20,
    portfolio_name_snapshot: 'Example',
    previous_relationship_manager_id: null,
    previous_relationship_manager_id_snapshot: null,
    previous_relationship_manager_name_snapshot: null,
    previous_relationship_manager_email_snapshot: null,
    new_relationship_manager_id: 8,
    new_relationship_manager_id_snapshot: 8,
    new_relationship_manager_name_snapshot: 'New Manager',
    new_relationship_manager_email_snapshot: 'new@example.test',
  }]);
  assert.deepEqual(database.notificationRecipientIds(), [8, 9]);
  assert.equal(database.notificationFor(8).related_conversation_id, null);
  assert.equal(database.commits, 1);
  assert.equal(database.rollbacks, 0);
  assert.equal(database.releases, 1);
});

test('pre-chat reassignment changes the portfolio without creating chat state', async () => {
  const database = assignmentHarness(assignedFixture);

  const result = await assignPortfolio({
    database,
    superadminId: 1,
    portfolioId: 20,
    relationshipManagerId: 8,
  });

  assert.equal(result.action, 'portfolio_reassigned');
  assert.equal(result.conversation_id, null);
  assert.deepEqual(result.previous_relationship_manager, {
    id: 7,
    name: 'Old Manager',
    email: 'old@example.test',
  });
  assert.equal(database.portfolio(20).relationship_manager_id, 8);
  assert.deepEqual(database.auditActions(), ['portfolio_reassigned']);
  assert.deepEqual(database.notificationRecipientIds(), [7, 8, 9]);
  assert.equal(database.calls.some(({ sql }) => sql.includes('conversation_members')), false);
  assert.equal(database.commits, 1);
});

test('post-chat reassignment transfers only the manager and grants full history', async () => {
  const database = assignmentHarness(postChatFixture);
  const result = await assignPortfolio({
    database,
    superadminId: 1,
    portfolioId: 20,
    relationshipManagerId: 8,
  });

  assert.equal(result.action, 'portfolio_reassigned');
  assert.equal(result.conversation_id, 40);
  assert.equal(database.portfolio(20).relationship_manager_id, 8);
  assert.equal(database.conversation(40).relationship_manager_id, 8);
  assert.deepEqual(database.activeMembers(40, 'relationship_manager'), [8]);
  assert.equal(database.member(40, 7).membership_status, 'removed');
  assert.equal(database.member(40, 8).visible_after_message_id, 0);
  assert.deepEqual(database.messageIds(40), [101, 102, 103]);
  assert.deepEqual(database.activeInvestorIds(40), [11, 12]);
  assert.deepEqual(database.auditActions(), ['portfolio_reassigned']);
  assert.deepEqual(database.notificationRecipientIds(), [7, 8, 9]);
  assert.equal(database.notificationFor(7).related_conversation_id, null);
  assert.equal(database.notificationFor(7).related_portfolio_id, 20);
  assert.equal(database.notificationFor(8).related_conversation_id, 40);
  assert.equal(database.notificationFor(9).related_conversation_id, 40);
  assert.equal(database.commits, 1);

  const portfolioLock = database.calls.findIndex(({ sql }) => sql.includes('FROM portfolios p'));
  const conversationLock = database.calls.findIndex(({ sql }) => sql.includes('FROM conversations'));
  const userLock = database.calls.findIndex(({ sql }) => sql.includes('FROM users'));
  assert.ok(portfolioLock > -1 && portfolioLock < conversationLock);
  assert.ok(conversationLock < userLock);
  assert.match(database.calls[portfolioLock].sql, /FOR UPDATE$/);
  assert.match(database.calls[conversationLock].sql, /FOR UPDATE$/);
  assert.match(database.calls[userLock].sql, /ORDER BY id FOR UPDATE$/);
});

test('same-manager request is a no-op', async () => {
  const database = assignmentHarness(assignedFixture);
  const result = await assignPortfolio({
    database,
    superadminId: 1,
    portfolioId: 20,
    relationshipManagerId: 7,
  });
  assert.deepEqual(result, {
    changed: false,
    action: null,
    portfolio: { id: 20, name: 'Example', status: 'approved' },
    previous_relationship_manager: {
      id: 7,
      name: 'Old Manager',
      email: 'old@example.test',
    },
    relationship_manager: {
      id: 7,
      name: 'Old Manager',
      email: 'old@example.test',
    },
    conversation_id: null,
  });
  assert.equal(database.writeCount, 0);
  assert.equal(database.commits, 1);
});

test('assign and reassign reject a non-approved portfolio unless the request is a no-op', async (t) => {
  const scenarios = [
    {
      name: 'initial assignment',
      fixture: {
        ...unassignedFixture,
        portfolios: [{ ...unassignedFixture.portfolios[0], status: 'pending' }],
      },
    },
    {
      name: 'reassignment',
      fixture: {
        ...assignedFixture,
        portfolios: [{ ...assignedFixture.portfolios[0], status: 'rejected' }],
      },
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      const database = assignmentHarness(scenario.fixture);
      await assert.rejects(
        () => assignPortfolio({
          database,
          superadminId: 1,
          portfolioId: 20,
          relationshipManagerId: 8,
        }),
        isAssignmentError(409, 'PORTFOLIO_NOT_APPROVED'),
      );
      assert.equal(database.writeCount, 0);
      assert.equal(database.rollbacks, 1);
    });
  }

  const noOpDatabase = assignmentHarness(scenarios[1].fixture);
  const result = await assignPortfolio({
    database: noOpDatabase,
    superadminId: 1,
    portfolioId: 20,
    relationshipManagerId: 7,
  });
  assert.equal(result.changed, false);
});

test('assignment validates portfolio, acting role, and target role before mutation', async (t) => {
  const cases = [
    {
      name: 'missing portfolio',
      database: assignmentHarness({ ...unassignedFixture, portfolios: [] }),
      args: { superadminId: 1, portfolioId: 20, relationshipManagerId: 8 },
      status: 404,
      code: 'PORTFOLIO_NOT_FOUND',
    },
    {
      name: 'actor is not a superadmin',
      database: assignmentHarness(unassignedFixture),
      args: { superadminId: 10, portfolioId: 20, relationshipManagerId: 8 },
      status: 403,
      code: 'SUPERADMIN_REQUIRED',
    },
    {
      name: 'target has the wrong role',
      database: assignmentHarness(unassignedFixture),
      args: { superadminId: 1, portfolioId: 20, relationshipManagerId: 10 },
      status: 400,
      code: 'RELATIONSHIP_MANAGER_REQUIRED',
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      await assert.rejects(
        () => assignPortfolio({ database: scenario.database, ...scenario.args }),
        isAssignmentError(scenario.status, scenario.code),
      );
      assert.equal(scenario.database.writeCount, 0);
      assert.equal(scenario.database.rollbacks, 1);
    });
  }
});

test('invalid identifiers are rejected before a connection is acquired', async (t) => {
  const invalidCases = [
    { superadminId: '1', portfolioId: 20, relationshipManagerId: 8 },
    { superadminId: 1, portfolioId: 0, relationshipManagerId: 8 },
    { superadminId: 1, portfolioId: 20, relationshipManagerId: Number.MAX_SAFE_INTEGER + 1 },
  ];

  for (const values of invalidCases) {
    await t.test(JSON.stringify(values), async () => {
      let acquired = 0;
      const database = {
        async getConnection() {
          acquired += 1;
          throw new Error('must not acquire');
        },
      };
      await assert.rejects(
        () => assignPortfolio({ database, ...values }),
        isAssignmentError(400, 'INVALID_ID'),
      );
      assert.equal(acquired, 0);
    });
  }
});

test('assignment rejects portfolio and conversation manager mismatches', async (t) => {
  const fixtures = [
    {
      name: 'different manager IDs',
      value: {
        ...postChatFixture,
        conversations: [{
          ...postChatFixture.conversations[0],
          relationship_manager_id: 8,
        }],
      },
    },
    {
      name: 'chat exists while canonical assignment is null',
      value: {
        ...postChatFixture,
        portfolios: [{
          ...postChatFixture.portfolios[0],
          relationship_manager_id: null,
        }],
      },
    },
  ];

  for (const fixture of fixtures) {
    await t.test(fixture.name, async () => {
      const database = assignmentHarness(fixture.value);
      await assert.rejects(
        () => assignPortfolio({
          database,
          superadminId: 1,
          portfolioId: 20,
          relationshipManagerId: 8,
        }),
        isAssignmentError(409, 'ASSIGNMENT_STATE_MISMATCH'),
      );
      assert.equal(database.writeCount, 0);
      assert.equal(database.rollbacks, 1);
    });
  }
});

test('post-chat reassignment checks every affected row and sole active manager invariant', async (t) => {
  await t.test('missing old membership', async () => {
    const fixture = {
      ...postChatFixture,
      members: postChatFixture.members.filter((row) => row.user_id !== 7),
    };
    const database = assignmentHarness(fixture);
    await assert.rejects(
      () => assignPortfolio({
        database,
        superadminId: 1,
        portfolioId: 20,
        relationshipManagerId: 8,
      }),
      isAssignmentError(409, 'ASSIGNMENT_STATE_MISMATCH'),
    );
    assert.deepEqual(database.snapshot(), database.initialSnapshot());
  });

  await t.test('more than one active manager', async () => {
    const database = assignmentHarness(postChatFixture, {
      activeManagerIds: [8, 13],
    });
    await assert.rejects(
      () => assignPortfolio({
        database,
        superadminId: 1,
        portfolioId: 20,
        relationshipManagerId: 8,
      }),
      isAssignmentError(409, 'ASSIGNMENT_STATE_MISMATCH'),
    );
    assert.deepEqual(database.snapshot(), database.initialSnapshot());
  });
});

test('pre-chat unassignment succeeds for a retained non-approved portfolio', async () => {
  const fixture = {
    ...assignedFixture,
    portfolios: [{ ...assignedFixture.portfolios[0], status: 'rejected' }],
  };
  const database = assignmentHarness(fixture);

  const result = await unassignPortfolio({
    database,
    superadminId: 1,
    portfolioId: 20,
  });

  assert.deepEqual(result, {
    changed: true,
    action: 'portfolio_unassigned',
    portfolio: { id: 20, name: 'Example', status: 'rejected' },
    previous_relationship_manager: {
      id: 7,
      name: 'Old Manager',
      email: 'old@example.test',
    },
    relationship_manager: null,
    conversation_id: null,
  });
  assert.equal(database.portfolio(20).relationship_manager_id, null);
  assert.deepEqual(database.auditActions(), ['portfolio_unassigned']);
  assert.deepEqual(database.notificationRecipientIds(), [7, 9]);
  assert.equal(database.notificationFor(7).related_conversation_id, null);
  assert.equal(database.notificationFor(9).related_conversation_id, null);
  assert.equal(database.commits, 1);
});

test('unassignment rejects any existing chat with the required conflict', async () => {
  const database = assignmentHarness(postChatFixture);

  await assert.rejects(
    () => unassignPortfolio({
      database,
      superadminId: 1,
      portfolioId: 20,
    }),
    (error) => (
      isAssignmentError(409, 'CONVERSATION_REQUIRES_REASSIGNMENT')(error)
      && error.message === 'Reassign required because this portfolio already has a chat'
    ),
  );
  assert.equal(database.writeCount, 0);
  assert.equal(database.rollbacks, 1);
});

test('already-unassigned portfolio is a no-op after authorization', async () => {
  const database = assignmentHarness(unassignedFixture);
  const result = await unassignPortfolio({
    database,
    superadminId: 1,
    portfolioId: 20,
  });

  assert.deepEqual(result, {
    changed: false,
    action: null,
    portfolio: { id: 20, name: 'Example', status: 'approved' },
    previous_relationship_manager: null,
    relationship_manager: null,
    conversation_id: null,
  });
  assert.equal(database.writeCount, 0);
  assert.equal(database.commits, 1);
});

test('duplicate-key races are translated to assignment conflicts', async () => {
  const duplicate = new Error('duplicate singleton');
  duplicate.code = 'ER_DUP_ENTRY';
  const database = assignmentHarness(postChatFixture, {
    failAfterWrite: 2,
    writeError: duplicate,
  });

  await assert.rejects(
    () => assignPortfolio({
      database,
      superadminId: 1,
      portfolioId: 20,
      relationshipManagerId: 8,
    }),
    isAssignmentError(409, 'ASSIGNMENT_CONFLICT'),
  );
  assert.equal(database.commits, 0);
  assert.equal(database.rollbacks, 1);
  assert.deepEqual(database.snapshot(), database.initialSnapshot());
});

test('post-chat reassignment rolls back after every write boundary', async (t) => {
  for (let failAfterWrite = 1; failAfterWrite <= 6; failAfterWrite += 1) {
    await t.test(`write ${failAfterWrite}`, async () => {
      const database = assignmentHarness(postChatFixture, { failAfterWrite });
      await assert.rejects(
        () => assignPortfolio({
          database,
          superadminId: 1,
          portfolioId: 20,
          relationshipManagerId: 8,
        }),
        new RegExp(`injected write failure ${failAfterWrite}`),
      );
      assert.equal(database.commits, 0);
      assert.equal(database.rollbacks, 1);
      assert.equal(database.releases, 1);
      assert.deepEqual(database.snapshot(), database.initialSnapshot());
    });
  }
});

test('rollback failure does not replace the original write error', async () => {
  const original = new Error('audit unavailable');
  const database = assignmentHarness(unassignedFixture, {
    failAfterWrite: 2,
    writeError: original,
    rollbackError: new Error('rollback unavailable'),
  });
  const originalConsoleError = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args);

  try {
    await assert.rejects(
      () => assignPortfolio({
        database,
        superadminId: 1,
        portfolioId: 20,
        relationshipManagerId: 8,
      }),
      (error) => error === original,
    );
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(database.rollbacks, 1);
  assert.equal(database.releases, 1);
  assert.equal(logged.length, 1);
  assert.equal(logged[0][0], 'Assignment rollback failed');
  assert.match(logged[0][1].message, /rollback unavailable/);
});
