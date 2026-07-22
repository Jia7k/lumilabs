const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'relationship-manager-route-test-secret';

const { ManagedConversationError } = require('../src/services/managed-conversation-workflow');

function loadRouterFactory() {
  return require('../src/routes/relationship-manager').createRelationshipManagerRouter;
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

function testApp({ database, workflow } = {}) {
  const app = express();
  app.use(express.json());
  app.use('/api/relationship-manager', loadRouterFactory()({ database, workflow }));
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

  for (const role of ['business_owner', 'investor', 'admin']) {
    const result = await request(t, app, 'GET', '/api/relationship-manager/dashboard', { role });
    assert.equal(result.response.status, 403, role);
  }
  assert.equal(database.calls.length, 0);
});

test('dashboard groups unclaimed interests and only the assigned manager rooms', { concurrency: false }, async (t) => {
  const database = scriptedDatabase([
    [
      {
        portfolio_id: 1,
        portfolio_name: 'X3',
        owner_id: 3,
        owner_name: 'Beta',
        interest_id: 1,
        investor_id: 6,
        investor_name: 'testing1',
        interest_created_at: '2026-07-22T13:00:00.000Z',
      },
      {
        portfolio_id: 1,
        portfolio_name: 'X3',
        owner_id: 3,
        owner_name: 'Beta',
        interest_id: 3,
        investor_id: 9,
        investor_name: 'leticia l',
        interest_created_at: '2026-07-22T13:02:00.000Z',
      },
    ],
    [{
      conversation_id: 12,
      portfolio_id: 2,
      title: 'Growth Co',
      status: 'active',
      archived_reason: null,
      unread_count: 3,
      owner_id: 4,
      owner_name: 'Owner Four',
    }],
    [
      { conversation_id: 12, investor_id: 6, investor_name: 'testing1' },
      { conversation_id: 12, investor_id: 7, investor_name: 'Investor Seven' },
    ],
    [{
      conversation_id: 12,
      interest_id: 4,
      investor_id: 9,
      investor_name: 'leticia l',
    }],
  ]);
  const app = testApp({ database });
  const { response, payload } = await request(
    t,
    app,
    'GET',
    '/api/relationship-manager/dashboard',
  );

  assert.equal(response.status, 200);
  assert.deepEqual(payload, {
    stats: {
      eligible_interests: 3,
      active_rooms: 1,
      businesses_overseen: 1,
      unread_messages: 3,
    },
    unclaimed_portfolios: [{
      portfolio_id: 1,
      portfolio_name: 'X3',
      owner: { id: 3, name: 'Beta' },
      interests: [
        {
          id: 1,
          investor: { id: 6, name: 'testing1' },
          created_at: '2026-07-22T13:00:00.000Z',
        },
        {
          id: 3,
          investor: { id: 9, name: 'leticia l' },
          created_at: '2026-07-22T13:02:00.000Z',
        },
      ],
    }],
    rooms: [{
      conversation_id: 12,
      portfolio_id: 2,
      title: 'Growth Co',
      status: 'active',
      archived_reason: null,
      unread_count: 3,
      owner: { id: 4, name: 'Owner Four' },
      investors: [
        { id: 6, name: 'testing1' },
        { id: 7, name: 'Investor Seven' },
      ],
      eligible_interests: [{
        id: 4,
        investor: { id: 9, name: 'leticia l' },
      }],
    }],
  });
  assert.equal(database.calls.length, 4);
  for (const call of database.calls) {
    if (call.sql.includes('conversations c') && !call.sql.includes('c.id IS NULL')) {
      assert.ok(call.params.includes(8), call.sql);
    }
  }
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

test('archive and reopen adapters pass the authenticated manager and conversation', { concurrency: false }, async (t) => {
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

  assert.equal(archived.response.status, 200);
  assert.equal(reopened.response.status, 200);
  assert.deepEqual(calls, [
    ['archive', { database, managerId: 8, conversationId: 12 }],
    ['reopen', { database, managerId: 8, conversationId: 12 }],
  ]);
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
