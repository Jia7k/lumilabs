const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'messages-route-test-secret';

const db = require('../src/config/db');
const { createApp } = require('../server');

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

function authHeaders(user) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${jwt.sign(user, process.env.JWT_SECRET)}`,
  };
}

function stubPool(t, connection) {
  let getConnectionCalls = 0;
  const original = db.getConnection;
  db.getConnection = async () => {
    getConnectionCalls += 1;
    return connection;
  };
  t.after(() => {
    db.getConnection = original;
  });
  return () => getConnectionCalls;
}

function transactionConnection(query) {
  const calls = {
    begin: 0,
    queries: [],
    commit: 0,
    rollback: 0,
    release: 0,
  };
  return {
    calls,
    async beginTransaction() {
      calls.begin += 1;
    },
    async query(sql, params) {
      calls.queries.push({ sql, params });
      return query(sql, params);
    },
    async commit() {
      calls.commit += 1;
    },
    async rollback() {
      calls.rollback += 1;
    },
    release() {
      calls.release += 1;
    },
  };
}

async function request(t, path, user, options = {}) {
  const server = await listen(createApp());
  t.after(server.close);
  const response = await fetch(`${server.origin}/api/messages${path}`, {
    ...options,
    headers: user ? authHeaders(user) : options.headers,
  });
  const payload = await response.json();
  return { response, payload };
}

const manager = {
  id: 8,
  email: 'testing1@example.com',
  name: 'Testing One',
  role: 'relationship_manager',
};

test('GET conversations returns only room summaries exposed by membership', { concurrency: false }, async (t) => {
  const original = db.query;
  const calls = [];
  db.query = async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes('FROM conversation_members cm') && sql.includes('latest_message')) {
      return [[{
        id: 12,
        portfolio_id: 1,
        title: 'X3 Investor Room',
        status: 'active',
        archived_reason: null,
        unread_count: 2,
        latest_message_id: 41,
        latest_sender_id: 2,
        latest_sender_name: 'Alpha',
        latest_content: 'Interested in the raise.',
        latest_created_at: '2026-07-22T08:00:00.000Z',
      }], []];
    }
    if (sql.includes('cm.conversation_id IN')) {
      return [[
        { conversation_id: 12, id: 8, name: 'Testing One', role: 'relationship_manager' },
        { conversation_id: 12, id: 3, name: 'Beta', role: 'business_owner' },
        { conversation_id: 12, id: 2, name: 'Alpha', role: 'investor' },
      ], []];
    }
    throw new Error(`Unexpected query: ${sql}`);
  };
  t.after(() => {
    db.query = original;
  });

  const { response, payload } = await request(t, '/conversations', manager);

  assert.equal(response.status, 200);
  assert.equal(payload.length, 1);
  assert.equal(payload[0].id, 12);
  assert.equal(payload[0].unread_count, 2);
  assert.deepEqual(payload[0].participants.map(({ role }) => role), [
    'relationship_manager',
    'business_owner',
    'investor',
  ]);
  assert.deepEqual(calls[0].params, [8]);
});

test('GET conversation rejects a user without active membership', { concurrency: false }, async (t) => {
  const original = db.query;
  db.query = async (sql) => {
    assert.match(sql, /LEFT JOIN conversation_members/);
    return [[{
      id: 12,
      portfolio_id: 1,
      title: 'X3 Investor Room',
      status: 'active',
      user_id: null,
      membership_status: null,
    }], []];
  };
  t.after(() => {
    db.query = original;
  });

  const outsider = { ...manager, id: 99 };
  const { response, payload } = await request(t, '/conversations/12', outsider);

  assert.equal(response.status, 403);
  assert.equal(payload.code, 'ROOM_ACCESS_DENIED');
});

test('POST room message commits one message and fans out notifications', { concurrency: false }, async (t) => {
  const saved = {
    id: 42,
    conversation_id: 12,
    sender_id: 8,
    sender_name: 'Testing One',
    sender_role: 'relationship_manager',
    content: 'Welcome everyone.',
    created_at: '2026-07-22T08:01:00.000Z',
  };
  const connection = transactionConnection(async (sql, params) => {
    if (sql.includes('FROM conversations c')) {
      return [[{
        id: 12,
        portfolio_id: 1,
        title: 'X3 Investor Room',
        status: 'active',
        user_id: 8,
        membership_status: 'active',
        visible_after_message_id: 0,
        last_read_message_id: 0,
      }], []];
    }
    if (sql.includes('FROM conversation_members') && sql.includes('user_id<>?')) {
      assert.deepEqual(params, [12, 8]);
      return [[{ user_id: 2 }, { user_id: 3 }], []];
    }
    if (sql.startsWith('INSERT INTO messages')) {
      assert.deepEqual(params, [12, 8, 'Welcome everyone.']);
      return [{ insertId: 42 }, []];
    }
    if (sql.includes('INSERT INTO notifications')) {
      assert.equal(params[0].length, 2);
      return [{ affectedRows: 2 }, []];
    }
    if (sql.includes('WHERE m.id=?')) {
      return [[saved], []];
    }
    throw new Error(`Unexpected query: ${sql}`);
  });
  stubPool(t, connection);

  const { response, payload } = await request(t, '/conversations/12/messages', manager, {
    method: 'POST',
    body: JSON.stringify({ content: '  Welcome everyone.  ' }),
  });

  assert.equal(response.status, 201);
  assert.deepEqual(payload, saved);
  assert.equal(connection.calls.commit, 1);
  assert.equal(connection.calls.rollback, 0);
  assert.equal(connection.calls.release, 1);
});

test('PUT read advances the room cursor transactionally', { concurrency: false }, async (t) => {
  const connection = transactionConnection(async (sql, params) => {
    if (sql.includes('FROM conversations c')) {
      return [[{
        id: 12,
        status: 'active',
        user_id: 8,
        membership_status: 'active',
        visible_after_message_id: 0,
        last_read_message_id: 41,
      }], []];
    }
    if (sql.startsWith('SELECT id,conversation_id FROM messages')) {
      assert.deepEqual(params, [42, 12]);
      return [[{ id: 42, conversation_id: 12 }], []];
    }
    if (sql.startsWith('UPDATE conversation_members')) return [{ affectedRows: 1 }, []];
    if (sql.startsWith('UPDATE notifications')) return [{ affectedRows: 2 }, []];
    throw new Error(`Unexpected query: ${sql}`);
  });
  stubPool(t, connection);

  const { response, payload } = await request(t, '/conversations/12/read', manager, {
    method: 'PUT',
    body: JSON.stringify({ message_id: 42 }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(payload, { conversation_id: 12, last_read_message_id: 42 });
  assert.equal(connection.calls.commit, 1);
});

test('invalid message content does not acquire a transaction connection', { concurrency: false }, async (t) => {
  const connection = transactionConnection(async () => {
    throw new Error('No query expected');
  });
  const getConnectionCalls = stubPool(t, connection);

  const { response, payload } = await request(t, '/conversations/12/messages', manager, {
    method: 'POST',
    body: JSON.stringify({ content: '   ' }),
  });

  assert.equal(response.status, 400);
  assert.ok(Array.isArray(payload.errors));
  assert.equal(getConnectionCalls(), 0);
});

test('prototype headers cannot authenticate an anonymous message request', { concurrency: false }, async (t) => {
  const { response } = await request(t, '/me', null, {
    headers: { 'X-LumiLabs-Prototype-User': 'testing1' },
  });

  assert.equal(response.status, 401);
});
