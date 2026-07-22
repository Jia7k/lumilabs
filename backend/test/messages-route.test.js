const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const db = require('../src/config/db');
const { createMessagingApp } = require('../messages-server');

process.env.JWT_SECRET = 'messages-route-test-secret';

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

function fakeConnection({
  saved,
  receiver,
  portfolio = null,
  failNotification = false,
}) {
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

      if (sql.includes('SELECT id, name FROM users')) {
        return [[receiver], []];
      }

      if (sql.includes('SELECT id, name, owner_id FROM portfolios')) {
        return [[portfolio], []];
      }

      if (sql.includes('INSERT INTO messages')) {
        return [{ insertId: saved.id }, []];
      }

      if (sql.includes('INSERT INTO notifications')) {
        if (failNotification) {
          throw new Error('notification insert failed');
        }
        return [{ insertId: 90 }, []];
      }

      if (sql.includes('SELECT * FROM messages WHERE id')) {
        return [[saved], []];
      }

      throw new Error(`Unexpected transaction query: ${sql}`);
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

function stubPool(t, { connection }) {
  let getConnectionCalls = 0;

  db.getConnection = async () => {
    getConnectionCalls += 1;
    return connection;
  };

  t.after(() => {
    delete db.getConnection;
  });

  return () => getConnectionCalls;
}

async function postMessage(t, sender, body) {
  const server = await listen(createMessagingApp());
  t.after(server.close);

  const response = await fetch(`${server.origin}/api/messages`, {
    method: 'POST',
    headers: authHeaders(sender),
    body: JSON.stringify(body),
  });
  const payload = await response.json();

  return { response, payload };
}

test('Beta send commits one message and notification', { concurrency: false }, async (t) => {
  const sender = {
    id: 3,
    email: 'beta@example.com',
    name: 'Beta',
    role: 'business_owner',
  };
  const saved = {
    id: 41,
    sender_id: 3,
    receiver_id: 2,
    portfolio_id: 1,
    content: 'Beta persistence test',
    read_at: null,
    created_at: '2026-07-20T09:00:00.000Z',
  };
  const connection = fakeConnection({
    saved,
    receiver: { id: 2, name: 'Alpha' },
    portfolio: { id: 1, name: 'X3', owner_id: 3 },
  });
  const getConnectionCalls = stubPool(t, { connection });

  const { response, payload } = await postMessage(t, sender, {
    receiver_id: 2,
    content: '  Beta persistence test  ',
    portfolio_id: 1,
  });

  assert.equal(response.status, 201);
  assert.deepEqual(payload, saved);
  assert.equal(getConnectionCalls(), 1);
  assert.equal(connection.calls.begin, 1);
  assert.equal(connection.calls.commit, 1);
  assert.equal(connection.calls.rollback, 0);
  assert.equal(connection.calls.release, 1);

  const messageInsert = connection.calls.queries.find(
    ({ sql }) => sql.includes('INSERT INTO messages')
  );
  assert.deepEqual(messageInsert.params, [3, 2, 1, 'Beta persistence test']);

  const notificationInsert = connection.calls.queries.find(
    ({ sql }) => sql.includes('INSERT INTO notifications')
  );
  assert.deepEqual(notificationInsert.params, [
    2,
    'Beta sent you a message about "X3"',
    1,
    3,
  ]);
});

test('Alpha send uses Alpha as sender and Beta as receiver', { concurrency: false }, async (t) => {
  const sender = {
    id: 2,
    email: 'alpha@example.com',
    name: 'Alpha',
    role: 'investor',
  };
  const saved = {
    id: 42,
    sender_id: 2,
    receiver_id: 3,
    portfolio_id: null,
    content: 'Alpha persistence test',
    read_at: null,
    created_at: '2026-07-20T09:01:00.000Z',
  };
  const connection = fakeConnection({
    saved,
    receiver: { id: 3, name: 'Beta' },
  });
  stubPool(t, { connection });

  const { response } = await postMessage(t, sender, {
    receiver_id: 3,
    content: 'Alpha persistence test',
    portfolio_id: null,
  });

  assert.equal(response.status, 201);
  const messageInsert = connection.calls.queries.find(
    ({ sql }) => sql.includes('INSERT INTO messages')
  );
  assert.deepEqual(messageInsert.params, [2, 3, null, 'Alpha persistence test']);
});

test('notification failure rolls back the message transaction', { concurrency: false }, async (t) => {
  t.mock.method(console, 'error', () => {});
  const sender = {
    id: 3,
    email: 'beta@example.com',
    name: 'Beta',
    role: 'business_owner',
  };

  const connection = fakeConnection({
    saved: { id: 43 },
    receiver: { id: 2, name: 'Alpha' },
    failNotification: true,
  });
  stubPool(t, { connection });

  const { response, payload } = await postMessage(t, sender, {
    receiver_id: 2,
    content: 'Rollback test',
    portfolio_id: null,
  });

  assert.equal(response.status, 500);
  assert.equal(payload.error, 'Server error');
  assert.equal(connection.calls.commit, 0);
  assert.equal(connection.calls.rollback, 1);
  assert.equal(connection.calls.release, 1);
});

test('invalid content does not acquire a transaction connection', { concurrency: false }, async (t) => {
  const sender = {
    id: 3,
    email: 'beta@example.com',
    name: 'Beta',
    role: 'business_owner',
  };
  const connection = fakeConnection({
    saved: { id: 44 },
    receiver: { id: 2, name: 'Alpha' },
  });
  const getConnectionCalls = stubPool(t, { connection });

  const { response, payload } = await postMessage(t, sender, {
    receiver_id: 2,
    content: '   ',
    portfolio_id: null,
  });

  assert.equal(response.status, 400);
  assert.ok(Array.isArray(payload.errors));
  assert.equal(getConnectionCalls(), 0);
});

test('prototype headers cannot authenticate an anonymous message request', { concurrency: false }, async (t) => {
  const server = await listen(createMessagingApp());
  t.after(server.close);

  const response = await fetch(`${server.origin}/api/messages/me`, {
    headers: { 'X-LumiLabs-Prototype-User': 'beta' },
  });

  assert.equal(response.status, 401);
});
