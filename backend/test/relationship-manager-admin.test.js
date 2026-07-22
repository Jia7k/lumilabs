const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

process.env.JWT_SECRET = 'relationship-manager-admin-test-secret';

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

function authHeaders(role = 'admin') {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${jwt.sign({
      id: role === 'admin' ? 1 : 2,
      email: `${role}@example.test`,
      name: role,
      role,
    }, process.env.JWT_SECRET)}`,
  };
}

async function request(t, method, path, { role, body, authenticated = true } = {}) {
  const server = await listen(createApp());
  t.after(server.close);
  const response = await fetch(`${server.origin}${path}`, {
    method,
    headers: authenticated ? authHeaders(role) : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json();
  return { response, payload };
}

function stubQueries(t, handler) {
  const original = db.query;
  const calls = [];
  db.query = async (sql, params = []) => {
    calls.push({ sql, params });
    return handler(sql, params, calls.length);
  };
  t.after(() => {
    db.query = original;
  });
  return calls;
}

test('relationship-manager account endpoints require an administrator', { concurrency: false }, async (t) => {
  const anonymous = await request(t, 'GET', '/api/admin/relationship-managers', {
    authenticated: false,
  });
  assert.equal(anonymous.response.status, 401);

  for (const role of ['business_owner', 'investor', 'relationship_manager']) {
    const result = await request(t, 'GET', '/api/admin/relationship-managers', { role });
    assert.equal(result.response.status, 403, role);
  }
});

test('invalid manager fields are rejected before querying the database', { concurrency: false }, async (t) => {
  const calls = stubQueries(t, async () => {
    throw new Error('database should not be queried');
  });
  const { response, payload } = await request(t, 'POST', '/api/admin/relationship-managers', {
    body: { name: ' ', email: 'not-an-email', password: 'short' },
  });

  assert.equal(response.status, 400);
  assert.ok(Array.isArray(payload.errors));
  assert.equal(payload.errors.some((error) => Object.hasOwn(error, 'value')), false);
  assert.doesNotMatch(JSON.stringify(payload), /short/);
  assert.equal(calls.length, 0);
});

test('duplicate manager email returns a conflict without inserting', { concurrency: false }, async (t) => {
  const calls = stubQueries(t, async (sql, params) => {
    assert.match(sql, /SELECT id FROM users WHERE email/);
    assert.deepEqual(params, ['rm@example.test']);
    return [[{ id: 8 }], []];
  });
  const { response, payload } = await request(t, 'POST', '/api/admin/relationship-managers', {
    body: { name: 'Rachel Manager', email: 'RM@EXAMPLE.TEST', password: 'secret1' },
  });

  assert.equal(response.status, 409);
  assert.equal(payload.error, 'Email already registered');
  assert.equal(calls.length, 1);
});

test('administrator creates a forced-role account with a bcrypt password and safe output', { concurrency: false }, async (t) => {
  const created = {
    id: 8,
    name: 'Rachel Manager',
    email: 'rm@example.test',
    role: 'relationship_manager',
    created_at: '2026-07-22T13:00:00.000Z',
  };
  const calls = stubQueries(t, async (sql, params) => {
    if (sql.includes('SELECT id FROM users WHERE email')) return [[], []];
    if (sql.startsWith('INSERT INTO users')) return [{ insertId: 8 }, []];
    if (sql.includes('WHERE id = ?')) return [[created], []];
    throw new Error(`Unexpected query: ${sql}`);
  });

  const { response, payload } = await request(t, 'POST', '/api/admin/relationship-managers', {
    body: {
      name: ' Rachel Manager ',
      email: 'RM@EXAMPLE.TEST',
      password: 'secret1',
      role: 'admin',
      password_hash: 'client-controlled',
    },
  });

  assert.equal(response.status, 201);
  assert.deepEqual(payload, created);
  assert.equal('password' in payload, false);
  assert.equal('password_hash' in payload, false);

  const insert = calls.find(({ sql }) => sql.startsWith('INSERT INTO users'));
  assert.match(insert.sql, /\(email, password_hash, name, role\)/);
  assert.deepEqual([insert.params[0], insert.params[2], insert.params[3]], [
    'rm@example.test',
    'Rachel Manager',
    'relationship_manager',
  ]);
  assert.notEqual(insert.params[1], 'secret1');
  assert.equal(await bcrypt.compare('secret1', insert.params[1]), true);
});

test('a duplicate-email insert race maps to the normal conflict response', { concurrency: false }, async (t) => {
  stubQueries(t, async (sql) => {
    if (sql.includes('SELECT id FROM users WHERE email')) return [[], []];
    const error = new Error('duplicate');
    error.code = 'ER_DUP_ENTRY';
    throw error;
  });
  const { response, payload } = await request(t, 'POST', '/api/admin/relationship-managers', {
    body: { name: 'Rachel Manager', email: 'rm@example.test', password: 'secret1' },
  });

  assert.equal(response.status, 409);
  assert.equal(payload.error, 'Email already registered');
});

test('administrator lists only safe relationship-manager metadata in stable order', { concurrency: false }, async (t) => {
  const rows = [{
    id: 8,
    name: 'Rachel Manager',
    email: 'rm@example.test',
    role: 'relationship_manager',
    created_at: '2026-07-22T13:00:00.000Z',
  }];
  const calls = stubQueries(t, async () => [rows, []]);
  const { response, payload } = await request(t, 'GET', '/api/admin/relationship-managers');

  assert.equal(response.status, 200);
  assert.deepEqual(payload, rows);
  assert.match(calls[0].sql, /SELECT id, name, email, role, created_at/);
  assert.match(calls[0].sql, /role = 'relationship_manager'/);
  assert.match(calls[0].sql, /ORDER BY created_at DESC, id DESC/);
  assert.doesNotMatch(calls[0].sql, /password_hash/);
});

test('public registration rejects relationship managers before inserting', { concurrency: false }, async (t) => {
  const calls = stubQueries(t, async () => {
    throw new Error('database should not be queried');
  });
  const { response } = await request(t, 'POST', '/api/auth/register', {
    authenticated: false,
    body: {
      name: 'Unauthorised RM',
      email: 'rm-public@example.test',
      password: 'secret1',
      role: 'relationship_manager',
    },
  });

  assert.equal(response.status, 400);
  assert.equal(calls.length, 0);
});
