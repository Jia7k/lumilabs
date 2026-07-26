const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'auth-request-boundaries-test-secret';

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

function stubQueries(t, handler = async () => {
  throw new Error('database should not be queried');
}) {
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

async function request(server, path, body, { admin = false } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (admin) {
    headers.Authorization = `Bearer ${jwt.sign({
      id: 1,
      email: 'admin@example.test',
      name: 'Admin',
      role: 'admin',
    }, process.env.JWT_SECRET)}`;
  }
  const response = await fetch(`${server.origin}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const responseBody = await response.text();
  let payload = responseBody;
  try {
    payload = JSON.parse(responseBody);
  } catch {
    // Express returns an HTML body for removed routes.
  }
  return {
    response,
    payload,
  };
}

function registration(overrides = {}) {
  return {
    name: 'Boundary User',
    email: 'boundary@example.test',
    password: 'secret1',
    role: 'investor',
    ...overrides,
  };
}

test('registration rejects name and email overflow before a database call', {
  concurrency: false,
}, async (t) => {
  const calls = stubQueries(t);
  const server = await listen(createApp());
  t.after(server.close);

  const overlongName = await request(
    server,
    '/api/auth/register',
    registration({ name: 'n'.repeat(101) }),
  );
  assert.equal(overlongName.response.status, 400);
  assert.equal(calls.length, 0);

  const overlongEmailValue = `${'a'.repeat(245)}@example.test`;
  const overlongEmail = await request(
    server,
    '/api/auth/register',
    registration({ email: overlongEmailValue }),
  );
  assert.equal(overlongEmail.response.status, 400);
  assert.equal(
    overlongEmail.payload.errors.some(
      ({ msg }) => msg === 'Email must be at most 255 characters',
    ),
    true,
  );
  assert.equal(calls.length, 0);
});

test('registration accepts exact name boundary and keeps public roles closed', {
  concurrency: false,
}, async (t) => {
  const calls = stubQueries(t, async () => [[{ id: 9 }], []]);
  const server = await listen(createApp());
  t.after(server.close);

  const boundary = await request(
    server,
    '/api/auth/register',
    registration({ name: 'n'.repeat(100) }),
  );
  assert.equal(boundary.response.status, 409);
  assert.equal(calls.length, 1);

  const manager = await request(
    server,
    '/api/auth/register',
    registration({
      email: 'manager-public@example.test',
      role: 'relationship_manager',
    }),
  );
  assert.equal(manager.response.status, 400);
  assert.equal(calls.length, 1);
});

test('successful public registration explicitly inserts the submitted approved role', {
  concurrency: false,
}, async (t) => {
  const calls = stubQueries(t, async (sql) => {
    if (/^\s*SELECT id FROM users WHERE email = \?/i.test(sql)) return [[], []];
    if (/^\s*INSERT INTO users/i.test(sql)) return [{ insertId: 42 }, []];
    throw new Error(`Unexpected registration query: ${sql}`);
  });
  const server = await listen(createApp());
  t.after(server.close);

  const result = await request(
    server,
    '/api/auth/register',
    registration({
      name: 'Explicit Investor',
      email: 'explicit-investor@example.test',
      role: 'investor',
    }),
  );

  assert.equal(result.response.status, 201);
  assert.equal(calls.length, 2);
  const insert = calls[1];
  assert.match(
    String(insert.sql).replace(/\s+/g, ' ').trim(),
    /^INSERT INTO users \(email, password_hash, name, role\) VALUES \(\?, \?, \?, \?\)$/i,
  );
  assert.equal(insert.params.length, 4);
  assert.equal(insert.params[0], 'explicit-investor@example.test');
  assert.equal(insert.params[2], 'Explicit Investor');
  assert.equal(insert.params[3], 'investor');
});

test('login rejects email overflow before a database call', {
  concurrency: false,
}, async (t) => {
  const calls = stubQueries(t);
  const server = await listen(createApp());
  t.after(server.close);
  const email = `${'a'.repeat(245)}@example.test`;

  const result = await request(server, '/api/auth/login', {
    email,
    password: 'secret1',
  });

  assert.equal(result.response.status, 400);
  assert.equal(
    result.payload.errors.some(
      ({ msg }) => msg === 'Email must be at most 255 characters',
    ),
    true,
  );
  assert.equal(calls.length, 0);
});

test('removed admin manager creation endpoint performs no database call', {
  concurrency: false,
}, async (t) => {
  const calls = stubQueries(t);
  const server = await listen(createApp());
  t.after(server.close);

  const name = await request(
    server,
    '/api/admin/relationship-managers',
    {
      name: 'n'.repeat(101),
      email: 'manager@example.test',
      password: 'secret1',
    },
    { admin: true },
  );
  assert.equal(name.response.status, 404);
  assert.equal(calls.length, 0);

  const email = await request(
    server,
    '/api/admin/relationship-managers',
    {
      name: 'Manager',
      email: `${'a'.repeat(245)}@example.test`,
      password: 'secret1',
    },
    { admin: true },
  );
  assert.equal(email.response.status, 404);
  assert.equal(calls.length, 0);
});

test('validation responses never include the submitted password', {
  concurrency: false,
}, async (t) => {
  stubQueries(t);
  const server = await listen(createApp());
  t.after(server.close);
  const submittedPassword = 'priv';

  const result = await request(
    server,
    '/api/auth/register',
    registration({ email: 'invalid', password: submittedPassword }),
  );

  assert.equal(result.response.status, 400);
  assert.doesNotMatch(JSON.stringify(result.payload), new RegExp(submittedPassword));
});
