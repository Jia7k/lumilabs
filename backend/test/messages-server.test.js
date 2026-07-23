const test = require('node:test');
const assert = require('node:assert/strict');
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

async function readJson(response) {
  const body = await response.text();
  assert.equal(response.status, 200, body);
  return JSON.parse(body);
}

test('serves the unified API health endpoint', async (t) => {
  const server = await listen(createApp());
  t.after(server.close);

  const payload = await readJson(await fetch(`${server.origin}/api/health`));
  assert.deepEqual(payload, { status: 'ok' });
});

test('readiness checks connectivity and the complete schema contract', {
  concurrency: false,
}, async (t) => {
  const queries = [];
  const database = {
    async query(sql) {
      queries.push(sql);
      return [[{ ready: 1 }], []];
    },
  };
  let verifierDatabase;
  const server = await listen(createApp({
    database,
    verifySchema: async (receivedDatabase) => {
      verifierDatabase = receivedDatabase;
      return true;
    },
  }));
  t.after(server.close);

  const response = await fetch(`${server.origin}/api/ready`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ready' });
  assert.deepEqual(queries, ['SELECT 1']);
  assert.equal(verifierDatabase, database);
});

test('readiness returns 503 and logs the precise schema invariant', {
  concurrency: false,
}, async (t) => {
  const invariant =
    'Missing schema invariants: audit_logs foreign key (portfolio_id) must use ON DELETE CASCADE';
  const errors = [];
  const originalError = console.error;
  console.error = (...parts) => errors.push(parts.join(' '));
  t.after(() => {
    console.error = originalError;
  });

  const database = {
    async query(sql) {
      assert.equal(sql, 'SELECT 1');
      return [[{ ready: 1 }], []];
    },
  };
  const server = await listen(createApp({
    database,
    verifySchema: async () => {
      throw new Error(invariant);
    },
  }));
  t.after(server.close);

  const response = await fetch(`${server.origin}/api/ready`);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { status: 'not ready' });
  assert.equal(errors.some((message) => message.includes(invariant)), true);
});

test('returns JSON for unknown unified API routes', async (t) => {
  const server = await listen(createApp());
  t.after(server.close);

  const response = await fetch(`${server.origin}/api/not-a-route`);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'Route not found' });
});

test('mounts the relationship-manager API behind authentication', async (t) => {
  const server = await listen(createApp());
  t.after(server.close);

  const response = await fetch(`${server.origin}/api/relationship-manager/dashboard`);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'Access token required' });
});

test('oversized JSON returns a safe 413 response before database access', {
  concurrency: false,
}, async (t) => {
  const originalQuery = db.query;
  const originalGetConnection = db.getConnection;
  const originalError = console.error;
  let databaseCalls = 0;
  const loggedErrors = [];
  db.query = async () => {
    databaseCalls += 1;
    throw new Error('Oversized JSON must not reach the database');
  };
  db.getConnection = async () => {
    databaseCalls += 1;
    throw new Error('Oversized JSON must not start a transaction');
  };
  console.error = (...parts) => loggedErrors.push(parts);
  t.after(() => {
    db.query = originalQuery;
    db.getConnection = originalGetConnection;
    console.error = originalError;
  });

  const server = await listen(createApp());
  t.after(server.close);
  const response = await fetch(`${server.origin}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ padding: 'x'.repeat(270 * 1024) }),
  });

  assert.equal(response.status, 413);
  assert.match(response.headers.get('content-type') || '', /^application\/json\b/);
  assert.deepEqual(await response.json(), { error: 'Request body too large' });
  assert.equal(databaseCalls, 0);
  assert.equal(loggedErrors.length, 0);
});

test('JSON below 256 KiB reaches ordinary route validation', {
  concurrency: false,
}, async (t) => {
  const originalQuery = db.query;
  const originalGetConnection = db.getConnection;
  let databaseCalls = 0;
  db.query = async () => {
    databaseCalls += 1;
    throw new Error('Invalid registration must not reach the database');
  };
  db.getConnection = async () => {
    databaseCalls += 1;
    throw new Error('Invalid registration must not start a transaction');
  };
  t.after(() => {
    db.query = originalQuery;
    db.getConnection = originalGetConnection;
  });

  const server = await listen(createApp());
  t.after(server.close);
  const response = await fetch(`${server.origin}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Boundary Owner',
      email: 'boundary@example.test',
      password: '123456',
      role: 'unsupported',
      padding: 'x'.repeat(200 * 1024),
    }),
  });

  assert.equal(response.status, 400);
  assert.match(response.headers.get('content-type') || '', /^application\/json\b/);
  const payload = await response.json();
  assert.ok(Array.isArray(payload.errors));
  assert.equal(databaseCalls, 0);
});
