const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'relationship-manager-route-test-secret';

const { ManagedConversationError } = require('../src/services/managed-conversation-workflow');

function loadRouterFactory() {
  return require('../src/routes/relationship-manager').createRelationshipManagerRouter;
}

function loadReadModel() {
  try {
    return require('../src/services/relationship-manager-read-model');
  } catch (error) {
    if (error.code === 'MODULE_NOT_FOUND') return {};
    throw error;
  }
}

async function listen(app) {
  const server = await new Promise((resolve, reject) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    listener.once('error', reject);
  });
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    }),
  };
}

function token(role = 'relationship_manager', id = 8) {
  return jwt.sign({
    id,
    email: `${role}-${id}@example.test`,
    name: role === 'relationship_manager' ? 'Rachel Manager' : role,
    role,
  }, process.env.JWT_SECRET);
}

function testApp({ database, workflow, readModel } = {}) {
  const app = express();
  app.use(express.json());
  app.use(
    '/api/relationship-manager',
    loadRouterFactory()({ database, workflow, readModel }),
  );
  app.use((req, res) => res.status(404).json({ error: 'Route not found' }));
  return app;
}

async function request(t, app, method, path, { role, id, body, authenticated = true } = {}) {
  const server = await listen(app);
  t.after(server.close);
  const response = await fetch(`${server.origin}${path}`, {
    method,
    headers: authenticated ? {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token(role, id)}`,
    } : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { response, payload: await response.json() };
}

function scriptedDatabase(responses) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params });
      assert.ok(responses.length, `Unexpected query: ${sql}`);
      return [responses.shift(), []];
    },
  };
}

test('dashboard is private to relationship managers', { concurrency: false }, async (t) => {
  const database = scriptedDatabase([]);
  const app = testApp({ database });

  const anonymous = await request(t, app, 'GET', '/api/relationship-manager/dashboard', {
    authenticated: false,
  });
  assert.equal(anonymous.response.status, 401);

  for (const role of ['business_owner', 'investor', 'admin', 'superadmin']) {
    const result = await request(t, app, 'GET', '/api/relationship-manager/dashboard', { role });
    assert.equal(result.response.status, 403, role);
  }
  assert.equal(database.calls.length, 0);
});

test('dashboard read model includes every assigned status without duplication', async () => {
  const { loadRelationshipManagerDashboard } = loadReadModel();
  assert.equal(typeof loadRelationshipManagerDashboard, 'function');

  const database = scriptedDatabase([
    [
      {
        portfolio_id: 20,
        name: 'Approved Co',
        status: 'approved',
        readiness_score: 85,
        owner_user_id: 9,
        owner_name: 'Owner Nine',
        owner_email: 'owner9@example.test',
        conversation_id: null,
        conversation_title: null,
        conversation_status: null,
        conversation_archived_reason: null,
        unread_count: 0,
      },
      {
        portfolio_id: 21,
        name: 'Draft Co',
        status: 'draft',
        readiness_score: 40,
        owner_user_id: 10,
        owner_name: 'Owner Ten',
        owner_email: 'owner10@example.test',
        conversation_id: null,
        conversation_title: null,
        conversation_status: null,
        conversation_archived_reason: null,
        unread_count: 0,
      },
      {
        portfolio_id: 22,
        name: 'Pending Co',
        status: 'pending',
        readiness_score: 70,
        owner_user_id: 12,
        owner_name: 'Owner Twelve',
        owner_email: 'owner12@example.test',
        conversation_id: 42,
        conversation_title: 'Pending Co room',
        conversation_status: 'archived',
        conversation_archived_reason: 'portfolio_unapproved',
        unread_count: 2,
      },
      {
        portfolio_id: 23,
        name: 'Rejected Co',
        status: 'rejected',
        readiness_score: 55,
        owner_user_id: 14,
        owner_name: 'Owner Fourteen',
        owner_email: 'owner14@example.test',
        conversation_id: 43,
        conversation_title: 'Rejected Co room',
        conversation_status: 'archived',
        conversation_archived_reason: 'portfolio_unapproved',
        unread_count: 1,
      },
    ],
    [
      {
        portfolio_id: 20,
        interest_id: 31,
        investor_id: 11,
        investor_name: 'Investor Eleven',
        investor_email: 'investor11@example.test',
        is_active_member: 0,
      },
      {
        portfolio_id: 20,
        interest_id: 31,
        investor_id: 11,
        investor_name: 'Investor Eleven',
        investor_email: 'investor11@example.test',
        is_active_member: 0,
      },
      {
        portfolio_id: 20,
        interest_id: 32,
        investor_id: 13,
        investor_name: 'Investor Thirteen',
        investor_email: 'investor13@example.test',
        is_active_member: 0,
      },
      {
        portfolio_id: 22,
        interest_id: 33,
        investor_id: 11,
        investor_name: 'Investor Eleven',
        investor_email: 'investor11@example.test',
        is_active_member: 1,
      },
      {
        portfolio_id: 22,
        interest_id: 34,
        investor_id: 15,
        investor_name: 'Investor Fifteen',
        investor_email: 'investor15@example.test',
        is_active_member: 0,
      },
    ],
    [
      {
        portfolio_id: 22,
        conversation_id: 42,
        user_id: 7,
        user_name: 'Rachel Manager',
        user_email: 'rachel@example.test',
        member_role: 'relationship_manager',
        joined_at: '2026-07-26T00:00:00.000Z',
      },
      {
        portfolio_id: 22,
        conversation_id: 42,
        user_id: 9,
        user_name: 'Owner Nine',
        user_email: 'owner9@example.test',
        member_role: 'business_owner',
        joined_at: '2026-07-26T00:00:01.000Z',
      },
      {
        portfolio_id: 22,
        conversation_id: 42,
        user_id: 9,
        user_name: 'Owner Nine',
        user_email: 'owner9@example.test',
        member_role: 'business_owner',
        joined_at: '2026-07-26T00:00:01.000Z',
      },
    ],
    [
      {
        portfolio_id: 20,
        document_id: 51,
        file_name: 'deck.pdf',
        file_type: 'pitch_deck',
        uploaded_at: '2026-07-27T00:00:00.000Z',
      },
      {
        portfolio_id: 20,
        document_id: 51,
        file_name: 'deck.pdf',
        file_type: 'pitch_deck',
        uploaded_at: '2026-07-27T00:00:00.000Z',
      },
    ],
  ]);

  const dashboard = await loadRelationshipManagerDashboard({
    database,
    managerId: 7,
  });

  assert.deepEqual(dashboard.portfolios.map((item) => item.id), [20, 21, 22, 23]);
  assert.deepEqual(dashboard.portfolios.map((item) => item.status), [
    'approved',
    'draft',
    'pending',
    'rejected',
  ]);
  assert.deepEqual(dashboard.stats, {
    assigned_portfolios: 4,
    approved_portfolios: 1,
    eligible_interests: 3,
    active_rooms: 0,
    unread_messages: 3,
  });
  assert.equal(dashboard.portfolios[0].interests.length, 2);
  assert.deepEqual(dashboard.portfolios[0].documents, [{
    id: 51,
    file_name: 'deck.pdf',
    file_type: 'pitch_deck',
    uploaded_at: '2026-07-27T00:00:00.000Z',
    download_url: '/api/portfolios/20/documents/51/download',
  }]);
  assert.equal(dashboard.portfolios[1].interests.length, 0);
  assert.deepEqual(dashboard.portfolios[2].conversation, {
    id: 42,
    title: 'Pending Co room',
    status: 'archived',
    archived_reason: 'portfolio_unapproved',
    unread_count: 2,
  });
  assert.equal(dashboard.portfolios[2].participants.length, 2);
  assert.deepEqual(dashboard.portfolios.map(({ actions }) => actions), [
    {
      can_create_conversation: true,
      create_disabled_reason: null,
      can_add_investors: false,
      add_disabled_reason: 'Create the portfolio chat first',
    },
    {
      can_create_conversation: false,
      create_disabled_reason: 'Portfolio must be approved before creating a chat',
      can_add_investors: false,
      add_disabled_reason: 'Create the portfolio chat first',
    },
    {
      can_create_conversation: false,
      create_disabled_reason: 'Portfolio must be approved before creating a chat',
      can_add_investors: false,
      add_disabled_reason: 'Portfolio must be approved before adding investors',
    },
    {
      can_create_conversation: false,
      create_disabled_reason: 'Portfolio must be approved before creating a chat',
      can_add_investors: false,
      add_disabled_reason: 'Portfolio must be approved before adding investors',
    },
  ]);
  assert.equal(database.calls.length, 4);
  for (const call of database.calls) {
    assert.match(call.sql, /FROM portfolios p/);
    assert.match(call.sql, /p\.relationship_manager_id=\?/);
    assert.deepEqual(call.params, [7]);
  }
  assert.match(database.calls[0].sql, /membership_status='active'/);
  assert.match(
    database.calls[0].sql,
    /GREATEST\(\s*manager_member\.visible_after_message_id,\s*manager_member\.last_read_message_id\s*\)/,
  );
  assert.match(database.calls[2].sql, /cm\.membership_status='active'/);
});

test('dashboard route uses the injected assigned-only read model', {
  concurrency: false,
}, async (t) => {
  const calls = [];
  const database = { marker: 'injected database' };
  const expected = {
    stats: {
      assigned_portfolios: 0,
      approved_portfolios: 0,
      eligible_interests: 0,
      active_rooms: 0,
      unread_messages: 0,
    },
    portfolios: [],
  };
  const app = testApp({
    database,
    readModel: {
      async loadRelationshipManagerDashboard(options) {
        calls.push(options);
        return expected;
      },
    },
  });

  const { response, payload } = await request(
    t,
    app,
    'GET',
    '/api/relationship-manager/dashboard',
    { id: 7 },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(payload, expected);
  assert.deepEqual(calls, [{ database, managerId: 7 }]);
});

test('assigned portfolio detail distinguishes missing and cross-manager access', async () => {
  const {
    RelationshipManagerReadError,
    loadAssignedPortfolio,
  } = loadReadModel();
  assert.equal(typeof loadAssignedPortfolio, 'function');
  assert.equal(typeof RelationshipManagerReadError, 'function');

  await assert.rejects(
    loadAssignedPortfolio({
      database: scriptedDatabase([[]]),
      managerId: 7,
      portfolioId: 404,
    }),
    (error) => {
      assert.ok(error instanceof RelationshipManagerReadError);
      assert.equal(error.status, 404);
      assert.equal(error.message, 'Portfolio not found');
      return true;
    },
  );

  const otherManagerDatabase = scriptedDatabase([[
    { id: 20, relationship_manager_id: 8 },
  ]]);
  await assert.rejects(
    loadAssignedPortfolio({
      database: otherManagerDatabase,
      managerId: 7,
      portfolioId: 20,
    }),
    (error) => {
      assert.ok(error instanceof RelationshipManagerReadError);
      assert.equal(error.status, 403);
      assert.equal(error.message, 'Portfolio is not assigned to this relationship manager');
      return true;
    },
  );
  assert.equal(otherManagerDatabase.calls.length, 1);
});

test('assigned portfolio detail route validates IDs and delegates to the read model', {
  concurrency: false,
}, async (t) => {
  const calls = [];
  const database = { marker: 'injected database' };
  const readModel = {
    async loadAssignedPortfolio(options) {
      calls.push(options);
      return { id: options.portfolioId, name: 'Assigned Co', documents: [] };
    },
  };
  const app = testApp({ database, readModel });

  for (const portfolioId of ['20junk', '0', String(Number.MAX_SAFE_INTEGER + 1)]) {
    const invalid = await request(
      t,
      app,
      'GET',
      `/api/relationship-manager/portfolios/${portfolioId}`,
      { id: 7 },
    );
    assert.equal(invalid.response.status, 400, portfolioId);
  }
  assert.equal(calls.length, 0);

  const valid = await request(
    t,
    app,
    'GET',
    '/api/relationship-manager/portfolios/20',
    { id: 7 },
  );
  assert.equal(valid.response.status, 200);
  assert.equal(valid.payload.id, 20);
  assert.deepEqual(calls, [{
    database,
    managerId: 7,
    portfolioId: 20,
  }]);
});

test('assigned portfolio detail route preserves read-model 404 and 403 errors', {
  concurrency: false,
}, async (t) => {
  const { RelationshipManagerReadError } = loadReadModel();
  assert.equal(typeof RelationshipManagerReadError, 'function');
  const app = testApp({
    database: {},
    readModel: {
      async loadAssignedPortfolio({ portfolioId }) {
        if (portfolioId === 20) {
          throw new RelationshipManagerReadError(403, 'Not assigned');
        }
        throw new RelationshipManagerReadError(404, 'Portfolio not found');
      },
    },
  });

  for (const [portfolioId, status, message] of [
    [20, 403, 'Not assigned'],
    [21, 404, 'Portfolio not found'],
  ]) {
    const result = await request(
      t,
      app,
      'GET',
      `/api/relationship-manager/portfolios/${portfolioId}`,
    );
    assert.equal(result.response.status, status);
    assert.deepEqual(result.payload, { error: message });
  }
});

test('assigned detail read model includes documents and only active participants', async () => {
  const { loadAssignedPortfolio } = loadReadModel();
  assert.equal(typeof loadAssignedPortfolio, 'function');
  const database = scriptedDatabase([
    [{ id: 20, relationship_manager_id: 7 }],
    [{
      portfolio_id: 20,
      name: 'Assigned Co',
      status: 'approved',
      readiness_score: 85,
      owner_user_id: 9,
      owner_name: 'Owner Nine',
      owner_email: 'owner9@example.test',
      conversation_id: 42,
      conversation_title: 'Assigned Co room',
      conversation_status: 'active',
      conversation_archived_reason: null,
      unread_count: 4,
    }],
    [{
      portfolio_id: 20,
      interest_id: 31,
      investor_id: 11,
      investor_name: 'Investor Eleven',
      investor_email: 'investor11@example.test',
      is_active_member: 1,
    }],
    [{
      portfolio_id: 20,
      conversation_id: 42,
      user_id: 11,
      user_name: 'Investor Eleven',
      user_email: 'investor11@example.test',
      member_role: 'investor',
      joined_at: '2026-07-27T01:00:00.000Z',
    }],
    [{
      portfolio_id: 20,
      document_id: 51,
      file_name: 'deck.pdf',
      file_type: 'pitch_deck',
      uploaded_at: '2026-07-27T00:00:00.000Z',
    }],
  ]);

  const portfolio = await loadAssignedPortfolio({
    database,
    managerId: 7,
    portfolioId: 20,
  });

  assert.equal(portfolio.id, 20);
  assert.equal(portfolio.conversation.unread_count, 4);
  assert.equal(portfolio.participants.length, 1);
  assert.equal(portfolio.documents[0].download_url, '/api/portfolios/20/documents/51/download');
  assert.equal(database.calls.length, 5);
  for (const call of database.calls.slice(1)) {
    assert.match(call.sql, /p\.relationship_manager_id=\?/);
    assert.deepEqual(call.params, [7, 20]);
  }
});

test('detail route is private to relationship managers', {
  concurrency: false,
}, async (t) => {
  let calls = 0;
  const app = testApp({
    database: {},
    readModel: {
      async loadAssignedPortfolio() {
        calls += 1;
        return {};
      },
    },
  });

  const anonymous = await request(
    t,
    app,
    'GET',
    '/api/relationship-manager/portfolios/20',
    { authenticated: false },
  );
  assert.equal(anonymous.response.status, 401);
  for (const role of ['business_owner', 'investor', 'admin', 'superadmin']) {
    const result = await request(
      t,
      app,
      'GET',
      '/api/relationship-manager/portfolios/20',
      { role },
    );
    assert.equal(result.response.status, 403, role);
  }
  assert.equal(calls, 0);
});

test('read model rejects unsafe manager and portfolio identifiers before querying', async () => {
  const {
    loadAssignedPortfolio,
    loadRelationshipManagerDashboard,
  } = loadReadModel();
  const database = scriptedDatabase([]);
  for (const managerId of [0, '7', Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(
      loadRelationshipManagerDashboard({ database, managerId }),
      /managerId must be a positive safe integer/,
    );
  }
  for (const portfolioId of [0, '20', Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(
      loadAssignedPortfolio({ database, managerId: 7, portfolioId }),
      /portfolioId must be a positive safe integer/,
    );
  }
  assert.equal(database.calls.length, 0);
});

test('dashboard SQL does not load unassigned portfolios', async () => {
  const { loadRelationshipManagerDashboard } = loadReadModel();
  const database = scriptedDatabase([[], [], [], []]);
  const dashboard = await loadRelationshipManagerDashboard({
    database,
    managerId: 7,
  });

  assert.deepEqual(dashboard.portfolios, []);
  for (const call of database.calls) {
    assert.match(call.sql, /WHERE p\.relationship_manager_id=\?/);
    assert.doesNotMatch(call.sql, /p\.status='approved'\s+AND\s+c\.id IS NULL/);
  }
});

test('dashboard responds safely when the read model fails', {
  concurrency: false,
}, async (t) => {
  const originalError = console.error;
  console.error = () => {};
  t.after(() => {
    console.error = originalError;
  });
  const app = testApp({
    database: {},
    readModel: {
      async loadRelationshipManagerDashboard() {
        const error = new Error('private database failure');
        error.sql = 'SELECT secret FROM hidden';
        throw error;
      },
    },
  });

  const result = await request(
    t,
    app,
    'GET',
    '/api/relationship-manager/dashboard',
  );

  assert.equal(result.response.status, 500);
  assert.deepEqual(result.payload, { error: 'Server error' });
  assert.doesNotMatch(JSON.stringify(result.payload), /private|secret|hidden/);
});

test('dashboard has no global unclaimed portfolio compatibility aliases', async () => {
  const { loadRelationshipManagerDashboard } = loadReadModel();
  const database = scriptedDatabase([[], [], [], []]);
  const dashboard = await loadRelationshipManagerDashboard({
    database,
    managerId: 7,
  });

  for (const legacyField of ['unclaimed_portfolios', 'rooms']) {
    assert.equal(Object.hasOwn(dashboard, legacyField), false);
  }
  assert.equal(Object.hasOwn(dashboard.stats, 'businesses_overseen'), false);
});

test('portfolio with no conversation exposes an empty participant list', async () => {
  const { loadRelationshipManagerDashboard } = loadReadModel();
  const database = scriptedDatabase([
    [{
      portfolio_id: 20,
      name: 'Assigned Co',
      status: 'approved',
      readiness_score: 85,
      owner_user_id: 9,
      owner_name: 'Owner Nine',
      owner_email: 'owner9@example.test',
      conversation_id: null,
      unread_count: 0,
    }],
    [],
    [],
    [],
  ]);
  const dashboard = await loadRelationshipManagerDashboard({
    database,
    managerId: 7,
  });

  assert.equal(dashboard.portfolios[0].conversation, null);
  assert.deepEqual(dashboard.portfolios[0].participants, []);
  assert.deepEqual(dashboard.portfolios[0].documents, []);
});

test('eligible interest counts are deduplicated across assigned portfolios', async () => {
  const { loadRelationshipManagerDashboard } = loadReadModel();
  const database = scriptedDatabase([
    [{
      portfolio_id: 20,
      name: 'Assigned Co',
      status: 'approved',
      readiness_score: 85,
      owner_user_id: 9,
      owner_name: 'Owner Nine',
      owner_email: 'owner9@example.test',
      conversation_id: null,
      unread_count: 0,
    }],
    [
      {
        portfolio_id: 20,
        interest_id: 31,
        investor_id: 11,
        investor_name: 'Investor Eleven',
        investor_email: 'investor11@example.test',
        is_active_member: 0,
      },
      {
        portfolio_id: 20,
        interest_id: 31,
        investor_id: 11,
        investor_name: 'Investor Eleven',
        investor_email: 'investor11@example.test',
        is_active_member: 0,
      },
    ],
    [],
    [],
  ]);
  const dashboard = await loadRelationshipManagerDashboard({
    database,
    managerId: 7,
  });

  assert.equal(dashboard.stats.eligible_interests, 1);
  assert.equal(dashboard.portfolios[0].interests.length, 1);
});

test('approved active room with no additional interest explains disabled actions', async () => {
  const { loadRelationshipManagerDashboard } = loadReadModel();
  const database = scriptedDatabase([
    [{
      portfolio_id: 20,
      name: 'Assigned Co',
      status: 'approved',
      readiness_score: 85,
      owner_user_id: 9,
      owner_name: 'Owner Nine',
      owner_email: 'owner9@example.test',
      conversation_id: 42,
      conversation_title: 'Assigned Co room',
      conversation_status: 'active',
      conversation_archived_reason: null,
      unread_count: 0,
    }],
    [{
      portfolio_id: 20,
      interest_id: 31,
      investor_id: 11,
      investor_name: 'Investor Eleven',
      investor_email: 'investor11@example.test',
      is_active_member: 1,
    }],
    [],
    [],
  ]);
  const dashboard = await loadRelationshipManagerDashboard({
    database,
    managerId: 7,
  });

  assert.deepEqual(dashboard.portfolios[0].actions, {
    can_create_conversation: false,
    create_disabled_reason: 'This portfolio already has its group chat',
    can_add_investors: false,
    add_disabled_reason: 'No additional interested investors are available',
  });
});

test('approved active room can add only currently interested nonmembers', async () => {
  const { loadRelationshipManagerDashboard } = loadReadModel();
  const database = scriptedDatabase([
    [{
      portfolio_id: 20,
      name: 'Assigned Co',
      status: 'approved',
      readiness_score: 85,
      owner_user_id: 9,
      owner_name: 'Owner Nine',
      owner_email: 'owner9@example.test',
      conversation_id: 42,
      conversation_title: 'Assigned Co room',
      conversation_status: 'active',
      conversation_archived_reason: null,
      unread_count: 0,
    }],
    [{
      portfolio_id: 20,
      interest_id: 31,
      investor_id: 11,
      investor_name: 'Investor Eleven',
      investor_email: 'investor11@example.test',
      is_active_member: 0,
    }],
    [],
    [],
  ]);
  const dashboard = await loadRelationshipManagerDashboard({
    database,
    managerId: 7,
  });

  assert.equal(dashboard.portfolios[0].actions.can_add_investors, true);
  assert.equal(dashboard.portfolios[0].actions.add_disabled_reason, null);
});

test('participant query is constrained to active membership', async () => {
  const { loadRelationshipManagerDashboard } = loadReadModel();
  const database = scriptedDatabase([[], [], [], []]);
  await loadRelationshipManagerDashboard({ database, managerId: 7 });

  const participantQuery = database.calls[2].sql;
  assert.match(participantQuery, /cm\.membership_status='active'/);
  assert.doesNotMatch(participantQuery, /membership_status IN/);
});

test('interest query uses current interest rows and active-member marker', async () => {
  const { loadRelationshipManagerDashboard } = loadReadModel();
  const database = scriptedDatabase([[], [], [], []]);
  await loadRelationshipManagerDashboard({ database, managerId: 7 });

  const interestQuery = database.calls[1].sql;
  assert.match(interestQuery, /JOIN investor_interests ii/);
  assert.match(interestQuery, /active_member\.membership_status='active'/);
  assert.match(interestQuery, /CASE WHEN active_member\.user_id IS NULL THEN 0 ELSE 1 END/);
});

test('document query returns metadata without stored file paths', async () => {
  const { loadRelationshipManagerDashboard } = loadReadModel();
  const database = scriptedDatabase([[], [], [], []]);
  await loadRelationshipManagerDashboard({ database, managerId: 7 });

  const documentQuery = database.calls[3].sql;
  assert.match(documentQuery, /d\.id AS document_id/);
  assert.doesNotMatch(documentQuery, /file_url/);
});

test('relationship-manager dashboard result keeps portfolio detail fields', async () => {
  const { loadRelationshipManagerDashboard } = loadReadModel();
  const database = scriptedDatabase([
    [{
      portfolio_id: 20,
      owner_id: 9,
      name: 'Assigned Co',
      sector: 'Fintech',
      description: 'Full detail',
      funding_goal: '1000.00',
      status: 'approved',
      readiness_score: 85,
      owner_user_id: 9,
      owner_name: 'Owner Nine',
      owner_email: 'owner9@example.test',
      conversation_id: null,
      unread_count: 0,
    }],
    [],
    [],
    [],
  ]);
  const dashboard = await loadRelationshipManagerDashboard({
    database,
    managerId: 7,
  });

  assert.equal(dashboard.portfolios[0].sector, 'Fintech');
  assert.equal(dashboard.portfolios[0].description, 'Full detail');
  assert.equal(dashboard.portfolios[0].funding_goal, '1000.00');
  assert.equal(Object.hasOwn(dashboard.portfolios[0], 'owner_id'), false);
  assert.deepEqual(dashboard.portfolios[0].owner, {
    id: 9,
    name: 'Owner Nine',
    email: 'owner9@example.test',
  });
});

test('dashboard base query orders assigned portfolios deterministically', async () => {
  const { loadRelationshipManagerDashboard } = loadReadModel();
  const database = scriptedDatabase([[], [], [], []]);
  await loadRelationshipManagerDashboard({ database, managerId: 7 });

  assert.match(database.calls[0].sql, /ORDER BY p\.id/);
});

test('assigned detail existence check does not expose portfolio data', async () => {
  const { loadAssignedPortfolio } = loadReadModel();
  const database = scriptedDatabase([[]]);
  await assert.rejects(
    loadAssignedPortfolio({ database, managerId: 7, portfolioId: 20 }),
    /Portfolio not found/,
  );

  assert.match(database.calls[0].sql, /^SELECT id,relationship_manager_id FROM portfolios WHERE id=\?$/);
  assert.deepEqual(database.calls[0].params, [20]);
});

test('assigned portfolio uses manager assignment rather than conversation membership', async () => {
  const { loadAssignedPortfolio } = loadReadModel();
  const database = scriptedDatabase([
    [{ id: 20, relationship_manager_id: 7 }],
    [{
      portfolio_id: 20,
      name: 'Pre-chat Co',
      status: 'approved',
      readiness_score: 85,
      owner_user_id: 9,
      owner_name: 'Owner Nine',
      owner_email: 'owner9@example.test',
      conversation_id: null,
      unread_count: 0,
    }],
    [],
    [],
    [],
  ]);

  const portfolio = await loadAssignedPortfolio({
    database,
    managerId: 7,
    portfolioId: 20,
  });

  assert.equal(portfolio.id, 20);
  for (const call of database.calls.slice(1)) {
    assert.match(call.sql, /p\.relationship_manager_id=\?/);
    assert.doesNotMatch(call.sql, /c\.relationship_manager_id=\?/);
  }
});

test('assigned detail cannot disappear between authorization and load', async () => {
  const { loadAssignedPortfolio } = loadReadModel();
  const database = scriptedDatabase([
    [{ id: 20, relationship_manager_id: 7 }],
    [],
    [],
    [],
    [],
  ]);

  await assert.rejects(
    loadAssignedPortfolio({ database, managerId: 7, portfolioId: 20 }),
    (error) => {
      assert.equal(error.status, 403);
      assert.equal(error.message, 'Portfolio is not assigned to this relationship manager');
      return true;
    }
  );
});

test('create room adapter validates and forwards multiple interests', { concurrency: false }, async (t) => {
  const calls = [];
  const workflow = {
    async createManagedConversation(options) {
      calls.push(options);
      return { conversation_id: 12, investors: [{ id: 6 }, { id: 9 }] };
    },
  };
  const database = { marker: 'database' };
  const app = testApp({ database, workflow });
  const { response, payload } = await request(
    t,
    app,
    'POST',
    '/api/relationship-manager/conversations',
    { body: { portfolio_id: 1, interest_ids: [1, 3] } },
  );

  assert.equal(response.status, 201);
  assert.equal(payload.conversation_id, 12);
  assert.deepEqual(calls, [{
    database,
    managerId: 8,
    portfolioId: 1,
    interestIds: [1, 3],
  }]);
});

test('room management adapters preserve workflow status and do not leak participants', { concurrency: false }, async (t) => {
  const workflow = {
    async addManagedInvestors() {
      throw new ManagedConversationError(
        403,
        'Only the assigned relationship manager can manage this conversation',
        'NOT_ASSIGNED_MANAGER',
      );
    },
  };
  const app = testApp({ database: {}, workflow });
  const { response, payload } = await request(
    t,
    app,
    'POST',
    '/api/relationship-manager/conversations/12/investors',
    { id: 10, body: { interest_ids: [4] } },
  );

  assert.equal(response.status, 403);
  assert.deepEqual(payload, {
    error: 'Only the assigned relationship manager can manage this conversation',
    code: 'NOT_ASSIGNED_MANAGER',
  });
  assert.equal('participants' in payload, false);
});

test('manual archive and reopen routes are removed', { concurrency: false }, async (t) => {
  const calls = [];
  const workflow = {
    async archiveManagedConversation(options) {
      calls.push(['archive', options]);
      return { conversation_id: 12, status: 'archived' };
    },
    async reopenManagedConversation(options) {
      calls.push(['reopen', options]);
      return { conversation_id: 12, status: 'active' };
    },
  };
  const database = { marker: 'database' };
  const app = testApp({ database, workflow });

  const archived = await request(
    t,
    app,
    'PUT',
    '/api/relationship-manager/conversations/12/archive',
  );
  const reopened = await request(
    t,
    app,
    'PUT',
    '/api/relationship-manager/conversations/12/reopen',
  );

  assert.equal(archived.response.status, 404);
  assert.equal(reopened.response.status, 404);
  assert.deepEqual(calls, []);
});

test('remove-investor adapter validates safe IDs and delegates to the authenticated manager', {
  concurrency: false,
}, async (t) => {
  const calls = [];
  const database = { marker: 'database' };
  const app = testApp({
    database,
    workflow: {
      async removeManagedInvestor(options) {
        calls.push(options);
        return { changed: true, investor_id: options.investorId, archived: false };
      },
    },
  });

  for (const path of [
    '/api/relationship-manager/conversations/0/investors/9',
    '/api/relationship-manager/conversations/12junk/investors/9',
    `/api/relationship-manager/conversations/${Number.MAX_SAFE_INTEGER + 1}/investors/9`,
    '/api/relationship-manager/conversations/12/investors/0',
    '/api/relationship-manager/conversations/12/investors/9junk',
    `/api/relationship-manager/conversations/12/investors/${Number.MAX_SAFE_INTEGER + 1}`,
  ]) {
    const invalid = await request(t, app, 'DELETE', path);
    assert.equal(invalid.response.status, 400, path);
  }
  assert.equal(calls.length, 0);

  const removed = await request(
    t,
    app,
    'DELETE',
    '/api/relationship-manager/conversations/12/investors/9',
  );
  assert.equal(removed.response.status, 200);
  assert.deepEqual(removed.payload, {
    changed: true,
    investor_id: 9,
    archived: false,
  });
  assert.deepEqual(calls, [{
    database,
    managerId: 8,
    conversationId: 12,
    investorId: 9,
  }]);
});

test('remove-investor route preserves stable workflow errors and sanitizes unknown failures', {
  concurrency: false,
}, async (t) => {
  const originalError = console.error;
  console.error = () => {};
  t.after(() => {
    console.error = originalError;
  });
  const app = testApp({
    database: {},
    workflow: {
      async removeManagedInvestor({ investorId }) {
        if (investorId === 9) {
          throw new ManagedConversationError(
            403,
            'Only the assigned relationship manager can manage this conversation',
            'NOT_ASSIGNED_MANAGER',
          );
        }
        const error = new Error('private database failure');
        error.sql = 'SELECT secret FROM hidden';
        throw error;
      },
    },
  });

  const forbidden = await request(
    t,
    app,
    'DELETE',
    '/api/relationship-manager/conversations/12/investors/9',
  );
  assert.equal(forbidden.response.status, 403);
  assert.deepEqual(forbidden.payload, {
    error: 'Only the assigned relationship manager can manage this conversation',
    code: 'NOT_ASSIGNED_MANAGER',
  });

  const failed = await request(
    t,
    app,
    'DELETE',
    '/api/relationship-manager/conversations/12/investors/10',
  );
  assert.equal(failed.response.status, 500);
  assert.deepEqual(failed.payload, { error: 'Server error' });
  assert.doesNotMatch(JSON.stringify(failed.payload), /private|secret|hidden/);
});

test('empty interest selection is rejected before calling the workflow', { concurrency: false }, async (t) => {
  let calls = 0;
  const app = testApp({
    database: {},
    workflow: {
      async createManagedConversation() {
        calls += 1;
      },
    },
  });
  const { response, payload } = await request(
    t,
    app,
    'POST',
    '/api/relationship-manager/conversations',
    { body: { portfolio_id: 1, interest_ids: [] } },
  );

  assert.equal(response.status, 400);
  assert.ok(Array.isArray(payload.errors));
  assert.equal(calls, 0);
});
