const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const seedPath = path.join(__dirname, '..', 'scripts', 'seed-managed-chat.js');

function loadSeed() {
  assert.equal(fs.existsSync(seedPath), true, 'managed chat seed script must exist');
  return require(seedPath);
}

function scriptedDatabase(responses) {
  const calls = [];
  const state = { begins: 0, commits: 0, rollbacks: 0, releases: 0 };
  const connection = {
    async beginTransaction() { state.begins += 1; },
    async query(sql, params = []) {
      calls.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params });
      assert.ok(responses.length, `Unexpected query: ${sql}`);
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return [typeof response === 'function' ? response(sql, params) : response, []];
    },
    async commit() { state.commits += 1; },
    async rollback() { state.rollbacks += 1; },
    release() { state.releases += 1; },
  };
  return {
    database: { async getConnection() { return connection; } },
    calls,
    state,
    assertConsumed() { assert.equal(responses.length, 0); },
  };
}

function config(overrides = {}) {
  return {
    seedKey: 'managed-chat-demo-v1',
    managerEmail: 'rm@example.test',
    managerId: null,
    portfolioId: 1,
    investorId: 6,
    ...overrides,
  };
}

const portfolio = {
  id: 1,
  name: 'X3',
  owner_id: 3,
  owner_name: 'Beta',
  status: 'approved',
};
const manager = {
  id: 8,
  name: 'Rachel Manager',
  email: 'rm@example.test',
  role: 'relationship_manager',
};
const investor = {
  id: 6,
  name: 'testing1',
  role: 'investor',
  interest_id: 1,
};
const room = {
  id: 12,
  portfolio_id: 1,
  relationship_manager_id: 8,
  title: 'X3',
  status: 'active',
};
const members = [
  { user_id: 8, member_role: 'relationship_manager', membership_status: 'active' },
  { user_id: 3, member_role: 'business_owner', membership_status: 'active' },
  { user_id: 6, member_role: 'investor', membership_status: 'active' },
];

test('seed config requires explicit stable identifiers and confirmation', () => {
  const seed = loadSeed();
  assert.throws(() => seed.resolveSeedConfig({}), /confirmation/i);
  assert.throws(() => seed.resolveSeedConfig({
    CONFIRM_MANAGED_CHAT_SEED: seed.SEED_CONFIRMATION,
  }), /seed key/i);

  const resolved = seed.resolveSeedConfig({
    CONFIRM_MANAGED_CHAT_SEED: seed.SEED_CONFIRMATION,
    MANAGED_CHAT_SEED_KEY: seed.SEED_KEY,
    MANAGED_CHAT_MANAGER_EMAIL: 'RM@EXAMPLE.TEST',
    MANAGED_CHAT_PORTFOLIO_ID: '1',
    MANAGED_CHAT_INVESTOR_ID: '6',
  });
  assert.deepEqual(resolved, config());
});

test('absent room creates only the fixed members and three deterministic messages', async () => {
  const { seedManagedChat, DEMO_MESSAGES } = loadSeed();
  const fake = scriptedDatabase([
    [portfolio],
    [manager],
    [investor],
    [],
    { insertId: 12 },
    { affectedRows: 3 },
    [],
    { affectedRows: 3 },
  ]);

  const result = await seedManagedChat(fake.database, config());

  assert.deepEqual(result, { created: true, conversation_id: 12 });
  assert.match(fake.calls[0].sql, /FROM portfolios p/);
  assert.match(fake.calls[0].sql, /FOR UPDATE/);
  const roomLockIndex = fake.calls.findIndex(({ sql }) => /FROM conversations/.test(sql));
  assert.ok(roomLockIndex > 0, 'portfolio is locked before room lookup');

  const memberInsert = fake.calls.find(({ sql }) => sql.includes('INSERT INTO conversation_members'));
  assert.deepEqual(memberInsert.params[0], [
    [12, 8, 'relationship_manager', 0, 0],
    [12, 3, 'business_owner', 0, 0],
    [12, 6, 'investor', 0, 0],
  ]);
  const messageInsert = fake.calls.find(({ sql }) => sql.includes('INSERT INTO messages'));
  assert.deepEqual(messageInsert.params[0], [
    [12, 8, DEMO_MESSAGES[0].body],
    [12, 3, DEMO_MESSAGES[1].body],
    [12, 6, DEMO_MESSAGES[2].body],
  ]);
  assert.equal(fake.calls.some(({ sql }) => /notifications/.test(sql)), false);
  assert.equal(fake.calls.some(({ params }) => JSON.stringify(params).includes('leticia l')), false);
  assert.equal(fake.state.commits, 1);
  assert.equal(fake.state.rollbacks, 0);
  fake.assertConsumed();
});

test('complete rerun validates the matching room and performs no inserts', async () => {
  const { seedManagedChat, DEMO_MESSAGES } = loadSeed();
  const seededMessages = DEMO_MESSAGES.map((message, index) => ({
    id: 40 + index,
    sender_id: [8, 3, 6][index],
    content: message.body,
  }));
  const fake = scriptedDatabase([
    [portfolio],
    [manager],
    [investor],
    [room],
    members,
    seededMessages,
  ]);

  assert.deepEqual(
    await seedManagedChat(fake.database, config()),
    { created: false, conversation_id: 12 },
  );
  assert.equal(fake.calls.some(({ sql }) => /^INSERT/.test(sql)), false);
  assert.equal(fake.state.commits, 1);
  fake.assertConsumed();
});

test('partial deterministic message set is a conflict and rolls back', async () => {
  const { seedManagedChat, DEMO_MESSAGES } = loadSeed();
  const fake = scriptedDatabase([
    [portfolio],
    [manager],
    [investor],
    [room],
    members,
    [{ id: 40, sender_id: 8, content: DEMO_MESSAGES[0].body }],
  ]);

  await assert.rejects(
    seedManagedChat(fake.database, config()),
    (error) => error.code === 'PARTIAL_SEED_MESSAGES',
  );
  assert.equal(fake.state.commits, 0);
  assert.equal(fake.state.rollbacks, 1);
  fake.assertConsumed();
});

test('wrong author for a deterministic body is rejected', async () => {
  const { seedManagedChat, DEMO_MESSAGES } = loadSeed();
  const fake = scriptedDatabase([
    [portfolio],
    [manager],
    [investor],
    [room],
    members,
    [
      { id: 40, sender_id: 3, content: DEMO_MESSAGES[0].body },
      { id: 41, sender_id: 3, content: DEMO_MESSAGES[1].body },
      { id: 42, sender_id: 6, content: DEMO_MESSAGES[2].body },
    ],
  ]);

  await assert.rejects(
    seedManagedChat(fake.database, config()),
    (error) => error.code === 'PARTIAL_SEED_MESSAGES',
  );
  assert.equal(fake.state.rollbacks, 1);
});

test('seed requires the exact approved X3 portfolio owned by Beta', async () => {
  const { seedManagedChat } = loadSeed();
  for (const changed of [
    { name: 'Not X3' },
    { owner_name: 'Not Beta' },
    { status: 'pending' },
  ]) {
    const fake = scriptedDatabase([[{ ...portfolio, ...changed }]]);
    await assert.rejects(
      seedManagedChat(fake.database, config()),
      (error) => error.code === 'INVALID_DEMO_PORTFOLIO',
    );
    assert.equal(fake.state.rollbacks, 1);
  }
});

test('existing room must match the explicit manager, owner, and testing1 investor', async () => {
  const { seedManagedChat } = loadSeed();
  const wrongManager = scriptedDatabase([
    [portfolio],
    [manager],
    [investor],
    [{ ...room, relationship_manager_id: 99 }],
  ]);
  await assert.rejects(
    seedManagedChat(wrongManager.database, config()),
    (error) => error.code === 'SEED_ROOM_MISMATCH',
  );

  const wrongMembership = scriptedDatabase([
    [portfolio],
    [manager],
    [investor],
    [room],
    members.filter(({ member_role: role }) => role !== 'investor'),
  ]);
  await assert.rejects(
    seedManagedChat(wrongMembership.database, config()),
    (error) => error.code === 'SEED_ROOM_MISMATCH',
  );
  assert.equal(wrongMembership.state.rollbacks, 1);
});
