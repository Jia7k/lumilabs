const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

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
  const responseBody = await response.text();
  let payload = responseBody;
  try {
    payload = JSON.parse(responseBody);
  } catch {
    // Express returns an HTML body for removed routes.
  }
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

test('admin staff and general-user endpoints are removed', { concurrency: false }, async (t) => {
  const calls = stubQueries(t, async () => {
    throw new Error('database should not be queried');
  });
  const endpoints = [
    ['POST', '/api/admin/relationship-managers', {
      name: 'Rachel Manager',
      email: 'rm@example.test',
      password: 'secret1',
    }],
    ['GET', '/api/admin/relationship-managers'],
    ['GET', '/api/admin/users'],
  ];

  for (const [method, path, body] of endpoints) {
    const { response } = await request(t, method, path, { body });
    assert.equal(response.status, 404, `${method} ${path}`);
  }
  assert.equal(calls.length, 0);
});

test('superadmins cannot approve or reject portfolios', { concurrency: false }, async (t) => {
  const calls = stubQueries(t, async () => {
    throw new Error('database should not be queried');
  });
  const approve = await request(t, 'PUT', '/api/admin/portfolios/20/approve', {
    role: 'superadmin',
  });
  const reject = await request(t, 'PUT', '/api/admin/portfolios/20/reject', {
    role: 'superadmin',
    body: { reason: 'No' },
  });

  assert.equal(approve.response.status, 403);
  assert.equal(reject.response.status, 403);
  assert.equal(calls.length, 0);
});

test('admins cannot access any superadmin route', { concurrency: false }, async (t) => {
  const calls = stubQueries(t, async () => {
    throw new Error('database should not be queried');
  });
  const endpoints = [
    ['GET', '/api/superadmin/stats'],
    ['GET', '/api/superadmin/portfolio-assignments'],
    ['GET', '/api/superadmin/relationship-managers'],
    ['PUT', '/api/superadmin/portfolios/20/assign', {
      relationship_manager_id: 8,
    }],
  ];

  for (const [method, path, body] of endpoints) {
    const { response } = await request(t, method, path, { body });
    assert.equal(response.status, 403, `${method} ${path}`);
  }
  assert.equal(calls.length, 0);
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
