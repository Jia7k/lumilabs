const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'recommendations-readiness-test-secret';

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

function investorToken() {
  return jwt.sign({
    id: 9,
    email: 'investor@example.test',
    name: 'Investor',
    role: 'investor',
  }, process.env.JWT_SECRET);
}

test('recommendations normalize nullable and malformed readiness scores', {
  concurrency: false,
}, async (t) => {
  const originalQuery = db.query;
  const originalGetConnection = db.getConnection;
  const rawScores = [null, undefined, 'not-a-score', -1, '88', 101];
  let queryCalls = 0;
  db.query = async (sql, params) => {
    queryCalls += 1;
    if (sql.includes('FROM portfolios p')) {
      return [rawScores.map((readinessScore, index) => ({
        id: index + 1,
        name: `Portfolio ${index + 1}`,
        sector: 'Fintech',
        description: '',
        funding_goal: '1000.00',
        readiness_score: readinessScore,
        created_at: '2026-01-01T00:00:00.000Z',
        owner_name: 'Owner',
        interest_count: 0,
      })), []];
    }
    assert.match(sql, /SELECT portfolio_id FROM investor_interests/);
    assert.deepEqual(params, [9]);
    return [[], []];
  };
  db.getConnection = async () => {
    throw new Error('Recommendations must not start a transaction');
  };
  t.after(() => {
    db.query = originalQuery;
    db.getConnection = originalGetConnection;
  });

  const server = await listen(createApp());
  t.after(server.close);
  const response = await fetch(`${server.origin}/api/recommendations`, {
    headers: { Authorization: `Bearer ${investorToken()}` },
  });

  assert.equal(response.status, 200);
  const recommendations = await response.json();
  const byId = recommendations.toSorted((a, b) => a.id - b.id);
  assert.deepEqual(
    byId.map(({ readiness_score: readinessScore }) => readinessScore),
    [0, 0, 0, 0, 88, 100],
  );
  assert.deepEqual(
    byId.map(({ is_high_potential: highPotential }) => highPotential),
    [false, false, false, false, true, true],
  );
  for (const recommendation of byId) {
    assert.equal(Number.isFinite(recommendation.readiness_score), true);
    assert.equal(Number.isFinite(recommendation.ai_score), true);
    assert.ok(recommendation.ai_score >= 0 && recommendation.ai_score <= 100);
  }
  assert.equal(queryCalls, 2);
});
