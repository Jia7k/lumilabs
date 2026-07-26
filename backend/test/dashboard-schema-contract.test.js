const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'workflow-route-boundary-test-secret';

const source = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'routes', 'dashboard.js'),
  'utf8',
);
const notificationsSource = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'routes', 'notifications.js'),
  'utf8',
);
const interestsSource = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'routes', 'interests.js'),
  'utf8',
);
const portfoliosSource = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'routes', 'portfolios.js'),
  'utf8',
);

test('admin dashboard reads the canonical audit reason field', () => {
  assert.match(source, /al\.reason/);
  assert.doesNotMatch(source, /al\.notes/);
});

test('owner and investor message stats use membership cursors, not direct-message fields', () => {
  assert.match(source, /FROM conversation_members cm/);
  assert.match(
    source,
    /GREATEST\(cm\.visible_after_message_id,\s*cm\.last_read_message_id\)/,
  );
  assert.doesNotMatch(source, /receiver_id|messages\.read_at|partnerId/);
});

test('recent interests expose managed-room state for owner and investor dashboards', () => {
  const ownerQuery = source.match(
    /const \[recentInterests\] = await db\.query\([\s\S]*?FROM investor_interests ii[\s\S]*?\[userId\]\s*\)/,
  )?.[0] || '';
  assert.match(ownerQuery, /p\.relationship_manager_id/);
  assert.match(source, /AS conversation_id/);
  assert.match(source, /AS conversation_status/);
  assert.match(source, /AS chat_state/);
  assert.match(source, /'awaiting_manager'/);
  assert.match(source, /'archived'/);
  assert.match(source, /'open'/);
  assert.match(source, /owner_member\.user_id = p\.owner_id/);
  assert.match(source, /owner_member\.member_role = 'business_owner'/);
  assert.match(source, /owner_member\.membership_status = 'active'/);
});

test('interest lists expose room IDs only through active membership and preserve removed state', () => {
  assert.ok(
    interestsSource.match(/AS conversation_id/g)?.length >= 2,
    'expected investor and owner interest queries to expose conversation IDs',
  );
  assert.ok(
    interestsSource.match(/AS conversation_status/g)?.length >= 2,
    'expected investor and owner interest queries to expose conversation status',
  );
  assert.ok(
    interestsSource.match(/AS chat_state/g)?.length >= 2,
    'expected investor and owner interest queries to expose chat state',
  );
  assert.match(interestsSource, /investor_member\.user_id=ii\.investor_id/);
  assert.match(interestsSource, /investor_member\.member_role='investor'/);
  assert.match(
    interestsSource,
    /CASE WHEN investor_member\.membership_status='active' THEN c\.id ELSE NULL END AS conversation_id/,
  );
  assert.match(
    interestsSource,
    /WHEN investor_member\.membership_status='removed' THEN 'removed'/,
  );
  assert.match(interestsSource, /owner_member\.user_id=p\.owner_id/);
  assert.match(interestsSource, /owner_member\.member_role='business_owner'/);
  assert.doesNotMatch(
    interestsSource,
    /investor_member\.member_role='investor'\s+AND investor_member\.membership_status='active'/,
  );
  assert.match(interestsSource, /owner_member\.membership_status='active'/);
});

test('portfolio lists expose room IDs only to active members and preserve removed investor state', () => {
  assert.ok(
    portfoliosSource.match(/AS conversation_id/g)?.length >= 2,
    'expected owner and browse portfolio queries to expose conversation IDs',
  );
  assert.ok(
    portfoliosSource.match(/AS chat_state/g)?.length >= 2,
    'expected owner and browse portfolio queries to expose chat state',
  );
  assert.match(portfoliosSource, /owner_member\.user_id=\?/);
  assert.match(portfoliosSource, /owner_member\.member_role='business_owner'/);
  assert.match(portfoliosSource, /investor_member\.user_id=\?/);
  assert.match(portfoliosSource, /investor_member\.member_role='investor'/);
  assert.match(
    portfoliosSource,
    /CASE WHEN investor_member\.membership_status='active' THEN c\.id ELSE NULL END AS conversation_id/,
  );
  assert.match(
    portfoliosSource,
    /WHEN investor_member\.membership_status='removed' THEN 'removed'/,
  );
  assert.doesNotMatch(
    portfoliosSource,
    /investor_member\.member_role='investor'\s+AND investor_member\.membership_status='active'/,
  );
  assert.match(portfoliosSource, /owner_member\.membership_status='active'/);
});

test('investor-facing workflow reads project assignment and safe notification links', () => {
  assert.match(
    portfoliosSource,
    /SELECT p\.id,[\s\S]*?p\.relationship_manager_id,[\s\S]*?AS conversation_id/,
  );
  assert.match(
    interestsSource,
    /SELECT p\.id,[\s\S]*?p\.relationship_manager_id,[\s\S]*?AS conversation_id/,
  );
  assert.match(
    source,
    /SELECT p\.id,\s*p\.name,\s*p\.sector,\s*p\.relationship_manager_id,[\s\S]*?AS conversation_id/,
  );
  assert.match(
    source,
    /SELECT n\.id,\s*n\.type,\s*n\.title,\s*n\.body,\s*n\.related_conversation_id,/,
  );
  assert.match(
    source,
    /n\.related_conversation_id[\s\S]*?cm\.conversation_id\s*=\s*n\.related_conversation_id[\s\S]*?cm\.membership_status\s*=\s*'active'/,
  );
});

test('all notification operations hide room notifications after membership removal', () => {
  assert.match(notificationsSource, /n\.related_conversation_id IS NULL/);
  assert.match(notificationsSource, /cm\.conversation_id=n\.related_conversation_id/);
  assert.match(notificationsSource, /cm\.user_id=n\.user_id/);
  assert.match(notificationsSource, /cm\.membership_status='active'/);
  assert.ok(
    notificationsSource.match(/VISIBLE_NOTIFICATION_PREDICATE/g)?.length >= 5,
    'expected the visibility predicate declaration plus list, count, single-read, and read-all usage',
  );
});

function assertRemovedProjectionSql(sql) {
  assert.match(
    sql,
    /CASE WHEN investor_member\.membership_status\s*=\s*'active'\s+THEN c\.id ELSE NULL END AS conversation_id/,
  );
  assert.match(
    sql,
    /CASE WHEN investor_member\.membership_status\s*=\s*'active'\s+THEN c\.status ELSE NULL END AS conversation_status/,
  );
  assert.match(
    sql,
    /CASE\s+WHEN investor_member\.membership_status\s*=\s*'removed' THEN 'removed'[\s\S]*?WHEN investor_member\.membership_status\s*=\s*'active' AND c\.status\s*=\s*'active' THEN 'open'[\s\S]*?ELSE 'awaiting_manager'\s+END AS chat_state/,
  );
  const join = sql.match(
    /LEFT JOIN conversation_members investor_member[\s\S]*?(?=\s+WHERE\b)/,
  )?.[0] || '';
  assert.doesNotMatch(join, /investor_member\.membership_status\s*=\s*'active'/);
}

test('investor dashboard route preserves removed chat state without exposing its room ID', {
  concurrency: false,
}, async (t) => {
  const db = require('../src/config/db');
  const originalQuery = db.query;
  let projectionSql = '';
  db.query = async (sql) => {
    const statement = String(sql);
    if (statement.includes("COUNT(*) AS available")) return [[{ available: 1 }]];
    if (statement.includes("COUNT(*) AS my_interests")) return [[{ my_interests: 1 }]];
    if (statement.includes('COUNT(m.id) AS total')) return [[{ total: 0, unread: 0 }]];
    if (statement.includes("COUNT(*) AS high_potential")) return [[{ high_potential: 0 }]];
    if (statement.includes('FROM investor_interests ii')) {
      projectionSql = statement;
      return [[{
        id: 20,
        name: 'Northstar',
        sector: 'Healthtech',
        relationship_manager_id: 8,
        conversation_id: null,
        conversation_status: null,
        chat_state: 'removed',
      }]];
    }
    if (statement.includes('FROM notifications n')) return [[]];
    throw new Error(`Unexpected query: ${statement}`);
  };
  t.after(() => {
    db.query = originalQuery;
  });

  const result = await request(t, 'GET', '/api/dashboard/investor', 'investor');

  assert.equal(result.response.status, 200);
  assert.deepEqual(result.payload.recentInterests, [{
    id: 20,
    name: 'Northstar',
    sector: 'Healthtech',
    relationship_manager_id: 8,
    conversation_id: null,
    conversation_status: null,
    chat_state: 'removed',
  }]);
  assertRemovedProjectionSql(projectionSql);
});

test('investor interest route preserves removed state and omits withdrawn rows', {
  concurrency: false,
}, async (t) => {
  const db = require('../src/config/db');
  const originalQuery = db.query;
  const rows = [{
    id: 20,
    owner_id: 9,
    name: 'Northstar',
    sector: 'Healthtech',
    readiness_score: 82,
    funding_goal: '250000.00',
    relationship_manager_id: 8,
    owner_name: 'Owner',
    interested_at: '2026-07-22T00:00:00.000Z',
    conversation_id: null,
    conversation_status: null,
    chat_state: 'removed',
  }];
  let projectionSql = '';
  db.query = async (sql) => {
    projectionSql = String(sql);
    return [rows];
  };
  t.after(() => {
    db.query = originalQuery;
  });

  const removed = await request(t, 'GET', '/api/interests/my', 'investor');
  assert.equal(removed.response.status, 200);
  assert.deepEqual(removed.payload, rows);
  assertRemovedProjectionSql(projectionSql);

  db.query = async (sql) => {
    projectionSql = String(sql);
    return [[]];
  };
  const withdrawn = await request(t, 'GET', '/api/interests/my', 'investor');
  assert.equal(withdrawn.response.status, 200);
  assert.deepEqual(withdrawn.payload, []);
  assert.match(projectionSql, /FROM investor_interests ii/);
  assert.match(projectionSql, /WHERE ii\.investor_id\s*=\s*\?/);
});

test('Browse route preserves removed state without exposing its room ID', {
  concurrency: false,
}, async (t) => {
  const db = require('../src/config/db');
  const originalQuery = db.query;
  const rows = [{
    id: 20,
    owner_id: 9,
    name: 'Northstar',
    sector: 'Healthtech',
    description: 'Care coordination',
    funding_goal: '250000.00',
    readiness_score: 82,
    created_at: '2026-07-22T00:00:00.000Z',
    relationship_manager_id: 8,
    owner_name: 'Owner',
    interest_count: 1,
    conversation_id: null,
    conversation_status: null,
    chat_state: 'removed',
  }];
  let projectionSql = '';
  db.query = async (sql) => {
    projectionSql = String(sql);
    return [rows];
  };
  t.after(() => {
    db.query = originalQuery;
  });

  const result = await request(t, 'GET', '/api/portfolios', 'investor');

  assert.equal(result.response.status, 200);
  assert.deepEqual(result.payload, rows);
  assertRemovedProjectionSql(projectionSql);
});

function authHeaders(role, id = 31) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${jwt.sign({
      id,
      name: role,
      email: `${role}@example.test`,
      role,
    }, process.env.JWT_SECRET)}`,
  };
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

async function request(t, method, requestPath, role, body) {
  const { createApp } = require('../server');
  const server = await listen(createApp());
  t.after(server.close);
  const response = await fetch(`${server.origin}${requestPath}`, {
    method,
    headers: authHeaders(role),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    response,
    payload: await response.json(),
  };
}

test('changed workflow routes reject malformed IDs before database access', {
  concurrency: false,
}, async (t) => {
  const db = require('../src/config/db');
  const originalQuery = db.query;
  const originalGetConnection = db.getConnection;
  let databaseCalls = 0;
  db.query = async () => {
    databaseCalls += 1;
    throw new Error('database must not be reached');
  };
  db.getConnection = async () => {
    databaseCalls += 1;
    throw new Error('database must not be reached');
  };
  t.after(() => {
    db.query = originalQuery;
    db.getConnection = originalGetConnection;
  });

  const cases = [
    ['POST', '/api/interests/20junk', 'investor'],
    ['DELETE', '/api/interests/0', 'investor'],
    ['PUT', '/api/admin/portfolios/20junk/approve', 'admin'],
    ['PUT', '/api/admin/portfolios/0/reject', 'admin', { reason: 'Not ready' }],
    ['PUT', '/api/notifications/20junk/read', 'investor'],
  ];
  for (const [method, requestPath, role, body] of cases) {
    const result = await request(t, method, requestPath, role, body);
    assert.equal(result.response.status, 400, `${method} ${requestPath}`);
  }
  assert.equal(databaseCalls, 0);
});

test('interest mutation stays investor-only and moderation stays admin-only', {
  concurrency: false,
}, async (t) => {
  const db = require('../src/config/db');
  const originalQuery = db.query;
  const originalGetConnection = db.getConnection;
  let databaseCalls = 0;
  db.query = async () => {
    databaseCalls += 1;
    throw new Error('database must not be reached');
  };
  db.getConnection = async () => {
    databaseCalls += 1;
    throw new Error('database must not be reached');
  };
  t.after(() => {
    db.query = originalQuery;
    db.getConnection = originalGetConnection;
  });

  const interest = await request(
    t,
    'POST',
    '/api/interests/20',
    'business_owner',
  );
  const moderation = await request(
    t,
    'PUT',
    '/api/admin/portfolios/20/approve',
    'superadmin',
  );
  assert.equal(interest.response.status, 403);
  assert.equal(moderation.response.status, 403);
  assert.equal(databaseCalls, 0);
});

test('unexpected workflow failures stay generic and do not log secrets', {
  concurrency: false,
}, async (t) => {
  const db = require('../src/config/db');
  const originalGetConnection = db.getConnection;
  const originalError = console.error;
  const secret = 'driver password=workflow-secret';
  const logs = [];
  db.getConnection = async () => {
    const error = new Error(secret);
    error.status = 418;
    throw error;
  };
  console.error = (...parts) => {
    logs.push(parts.join(' '));
  };
  t.after(() => {
    db.getConnection = originalGetConnection;
    console.error = originalError;
  });

  const interest = await request(t, 'POST', '/api/interests/20', 'investor');
  const moderation = await request(
    t,
    'PUT',
    '/api/admin/portfolios/20/approve',
    'admin',
  );
  assert.equal(interest.response.status, 500);
  assert.deepEqual(interest.payload, { error: 'Server error' });
  assert.equal(moderation.response.status, 500);
  assert.deepEqual(moderation.payload, { error: 'Server error' });
  assert.equal(logs.some((line) => line.includes(secret)), false);
  assert.deepEqual(logs, [
    'Interest workflow failed',
    'Admin moderation workflow failed',
  ]);
});

test('unlinked revocation notices remain visible without weakening room isolation', {
  concurrency: false,
}, async (t) => {
  const db = require('../src/config/db');
  const originalQuery = db.query;
  let notificationSql = '';
  db.query = async (sql) => {
    notificationSql = String(sql);
    return [[{
      id: 90,
      type: 'conversation_member_removed',
      related_conversation_id: null,
      related_portfolio_id: 20,
    }], []];
  };
  t.after(() => {
    db.query = originalQuery;
  });

  const result = await request(t, 'GET', '/api/notifications', 'investor');
  assert.equal(result.response.status, 200);
  assert.equal(result.payload[0].type, 'conversation_member_removed');
  assert.equal(result.payload[0].related_conversation_id, null);
  assert.equal(result.payload[0].related_portfolio_id, 20);
  assert.match(notificationSql, /n\.related_conversation_id IS NULL/);
  assert.match(notificationSql, /cm\.membership_status='active'/);
});
