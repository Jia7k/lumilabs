const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'business-owner-dashboard-test-secret';

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

function authHeaders() {
  return {
    Authorization: `Bearer ${jwt.sign({
      id: 3,
      email: 'owner@example.test',
      name: 'Business Owner',
      role: 'business_owner',
    }, process.env.JWT_SECRET)}`,
  };
}

async function requestDashboard(t) {
  const server = await listen(createApp());
  t.after(server.close);
  const response = await fetch(`${server.origin}/api/dashboard/business-owner`, {
    headers: authHeaders(),
  });
  return { response, payload: await response.json() };
}

function stubDashboardQueries(t, portfolioStats) {
  const original = db.query;
  db.query = async (sql) => {
    const normalized = String(sql).replace(/\s+/g, ' ').trim();
    if (normalized.includes('ROUND(AVG(readiness_score), 0) AS avg_readiness')) {
      assert.match(
        normalized,
        /SUM\(status = 'rejected'\) AS rejected/,
      );
      return [[portfolioStats], []];
    }
    if (normalized.startsWith('SELECT COUNT(*) AS total FROM investor_interests')) {
      return [[{ total: 0 }], []];
    }
    if (normalized.includes('FROM conversation_members cm')) {
      return [[{ total: 0, unread: 0 }], []];
    }
    if (normalized.startsWith('SELECT id, name, sector, status, readiness_score')) {
      return [[], []];
    }
    if (normalized.startsWith('SELECT u.name AS investor')) {
      return [[], []];
    }
    if (normalized.startsWith('SELECT n.id, n.type, n.title')) {
      return [[], []];
    }
    throw new Error(`Unexpected query: ${normalized}`);
  };
  t.after(() => {
    db.query = original;
  });
}

test('business-owner dashboard returns a complete portfolio status breakdown including rejected', { concurrency: false }, async (t) => {
  stubDashboardQueries(t, {
    total: '4',
    approved: '1',
    pending: '1',
    rejected: '1',
    draft: '1',
    avg_readiness: '70',
  });

  const { response, payload } = await requestDashboard(t);

  assert.equal(response.status, 200);
  assert.deepEqual(payload.portfolios, {
    total: 4,
    approved: 1,
    pending: 1,
    rejected: 1,
    draft: 1,
  });
  for (const field of ['total', 'approved', 'pending', 'rejected', 'draft']) {
    assert.equal(typeof payload.portfolios[field], 'number');
  }
  assert.equal(
    payload.portfolios.approved
      + payload.portfolios.pending
      + payload.portfolios.rejected
      + payload.portfolios.draft,
    payload.portfolios.total,
  );
});

test('business-owner dashboard normalizes empty status aggregates to zero', { concurrency: false }, async (t) => {
  stubDashboardQueries(t, {
    total: 0,
    approved: null,
    pending: null,
    rejected: null,
    draft: null,
    avg_readiness: null,
  });

  const { response, payload } = await requestDashboard(t);

  assert.equal(response.status, 200);
  assert.deepEqual(payload.portfolios, {
    total: 0,
    approved: 0,
    pending: 0,
    rejected: 0,
    draft: 0,
  });
});
