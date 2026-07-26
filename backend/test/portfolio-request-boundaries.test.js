const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'portfolio-request-boundaries-test-secret';

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

function ownerHeaders() {
  return roleHeaders('business_owner', 7);
}

function roleHeaders(role, id) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${jwt.sign({
      id,
      email: `${role}-${id}@example.test`,
      name: `${role} ${id}`,
      role,
    }, process.env.JWT_SECRET)}`,
  };
}

async function request(server, method, path, body) {
  const response = await fetch(`${server.origin}${path}`, {
    method,
    headers: ownerHeaders(),
    body: JSON.stringify(body),
  });
  return {
    response,
    payload: await response.json(),
  };
}

async function requestAs(server, method, path, { role, id, body } = {}) {
  const response = await fetch(`${server.origin}${path}`, {
    method,
    headers: roleHeaders(role, id),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    response,
    payload: await response.json(),
  };
}

function validCreate(overrides = {}) {
  return {
    name: 'Boundary Labs',
    sector: 'Fintech',
    mvp_status: 'Beta',
    funding_goal: '1000.00',
    ...overrides,
  };
}

function longHttpUrl(length) {
  const prefix = 'https://example.com/';
  return prefix + 'a'.repeat(length - prefix.length);
}

function installDatabaseSpies(t, {
  query = async () => {
    throw new Error('db.query should not be called');
  },
  getConnection = async () => {
    throw new Error('db.getConnection should not be called');
  },
} = {}) {
  const originals = {
    query: db.query,
    getConnection: db.getConnection,
  };
  const calls = {
    query: 0,
    getConnection: 0,
  };
  db.query = async (...args) => {
    calls.query += 1;
    return query(...args);
  };
  db.getConnection = async (...args) => {
    calls.getConnection += 1;
    return getConnection(...args);
  };
  t.after(() => {
    db.query = originals.query;
    db.getConnection = originals.getConnection;
  });
  return calls;
}

test('invalid create and supplied update values stop before data access', {
  concurrency: false,
}, async (t) => {
  const calls = installDatabaseSpies(t);
  const server = await listen(createApp());
  t.after(server.close);
  const invalidCases = [
    ['missing name', (body) => { delete body.name; }, false],
    ['blank name', (body) => { body.name = ' '; }],
    ['name overflow', (body) => { body.name = 'n'.repeat(256); }],
    ['invalid sector', (body) => { body.sector = 'Technology'; }],
    ['invalid MVP', (body) => { body.mvp_status = 'beta'; }],
    ['missing funding', (body) => { delete body.funding_goal; }, false],
    ['null funding', (body) => { body.funding_goal = null; }],
    ['blank funding', (body) => { body.funding_goal = ''; }],
    ['whitespace funding', (body) => { body.funding_goal = ' '; }],
    ['boolean funding', (body) => { body.funding_goal = true; }],
    ['array funding', (body) => { body.funding_goal = []; }],
    ['object funding', (body) => { body.funding_goal = {}; }],
    ['non-finite funding', (body) => { body.funding_goal = 'Infinity'; }],
    ['funding scale', (body) => { body.funding_goal = '0.001'; }],
    ['funding overflow', (body) => { body.funding_goal = '10000000000000.00'; }],
    ['funding exponent overflow', (body) => { body.funding_goal = '1e13'; }],
    ['negative funding', (body) => { body.funding_goal = '-0.01'; }],
    ['monthly revenue overflow', (body) => { body.monthly_revenue = '1e13'; }],
    ['burn scale', (body) => { body.burn_rate = '0.001'; }],
    ['growth overflow', (body) => { body.growth_rate = '1000.00'; }],
    ['growth scale', (body) => { body.growth_rate = '1e-3'; }],
    ['fractional team', (body) => { body.team_size = '1.5'; }],
    ['team overflow', (body) => { body.team_size = '2147483648'; }],
    ['boolean users', (body) => { body.user_count = false; }],
    ['array runway', (body) => { body.runway_months = []; }],
    ['object team', (body) => { body.team_size = {}; }],
    ['year below range', (body) => { body.founded_year = 1900; }],
    ['year above range', (body) => { body.founded_year = 2101; }],
    ['location overflow', (body) => { body.location = 'l'.repeat(256); }],
    ['website overflow', (body) => { body.website = longHttpUrl(501); }],
    ['non-http website', (body) => { body.website = 'ftp://example.com'; }],
    ['market overflow', (body) => { body.market_size = 'm'.repeat(501); }],
    ['advisor overflow', (body) => { body.advisor_names = 'a'.repeat(501); }],
    ['description byte overflow', (body) => { body.description = 'a'.repeat(65536); }],
    [
      'multibyte description overflow',
      (body) => { body.description = `${'界'.repeat(21845)}a`; },
    ],
    [
      'competitor byte overflow',
      (body) => { body.competitor_analysis = '😀'.repeat(16384); },
    ],
  ];

  for (const [label, mutate, testUpdate = true] of invalidCases) {
    const createBody = validCreate();
    mutate(createBody);
    const beforeCreate = { ...calls };
    const created = await request(server, 'POST', '/api/portfolios', createBody);
    assert.equal(created.response.status, 400, `create: ${label}`);
    assert.deepEqual(calls, beforeCreate, `create data access: ${label}`);

    if (!testUpdate) continue;
    const updateBody = {};
    mutate(updateBody);
    const beforeUpdate = { ...calls };
    const updated = await request(server, 'PUT', '/api/portfolios/12', updateBody);
    assert.equal(updated.response.status, 400, `update: ${label}`);
    assert.deepEqual(calls, beforeUpdate, `update data access: ${label}`);
  }
});

test('valid create accepts exact maxima, exponent notation, and byte boundaries', {
  concurrency: false,
}, async (t) => {
  const saved = [];
  const calls = installDatabaseSpies(t, {
    query: async (sql, params) => {
      if (sql.startsWith('INSERT INTO portfolios')) {
        saved.push(params);
        return [{ insertId: saved.length }, []];
      }
      if (sql.startsWith('SELECT * FROM portfolios WHERE id = ?')) {
        return [[{ id: saved.length, status: 'draft' }], []];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  });
  const server = await listen(createApp());
  t.after(server.close);

  const first = await request(server, 'POST', '/api/portfolios', validCreate({
    name: 'n'.repeat(255),
    funding_goal: '9999999999999.99',
    team_size: '2147483647',
    founded_year: '1901',
    location: 'l'.repeat(255),
    website: longHttpUrl(500),
    monthly_revenue: '1.2e2',
    user_count: '1e3',
    growth_rate: '1e-2',
    market_size: 'm'.repeat(500),
    advisor_names: 'a'.repeat(500),
    description: '界'.repeat(21845),
    burn_rate: '0.01',
    runway_months: '2147483647',
  }));
  assert.equal(first.response.status, 201);

  const second = await request(server, 'POST', '/api/portfolios', validCreate({
    founded_year: '2100',
    competitor_analysis: 'a'.repeat(65535),
  }));
  assert.equal(second.response.status, 201);
  assert.equal(saved.length, 2);
  assert.equal(calls.getConnection, 0);
});

test('omitted optional numerics pass and a valid partial update reaches workflow', {
  concurrency: false,
}, async (t) => {
  const portfolio = {
    id: 12,
    owner_id: 7,
    name: 'Boundary Labs',
    sector: 'Fintech',
    mvp_status: 'Beta',
    description: '',
    funding_goal: '1000.00',
    team_size: null,
    founded_year: null,
    location: null,
    website: null,
    monthly_revenue: null,
    user_count: null,
    growth_rate: null,
    market_size: null,
    competitor_analysis: null,
    advisor_names: null,
    burn_rate: null,
    runway_months: null,
    status: 'draft',
  };
  const connection = {
    async beginTransaction() {},
    async query(sql) {
      if (sql.includes('FOR UPDATE')) return [[portfolio], []];
      if (sql.includes('COUNT(*) AS c')) return [[{ c: 0 }], []];
      if (sql.startsWith('UPDATE portfolios')) return [{ affectedRows: 1 }, []];
      if (sql.startsWith('SELECT * FROM portfolios WHERE id=?')) {
        return [[{ ...portfolio, name: 'Updated Boundary Labs' }], []];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    async commit() {},
    async rollback() {},
    release() {},
  };
  const calls = installDatabaseSpies(t, {
    getConnection: async () => connection,
  });
  const server = await listen(createApp());
  t.after(server.close);

  const result = await request(server, 'PUT', '/api/portfolios/12', {
    name: 'Updated Boundary Labs',
  });

  assert.equal(result.response.status, 200);
  assert.equal(result.payload.name, 'Updated Boundary Labs');
  assert.equal(calls.query, 0);
  assert.equal(calls.getConnection, 1);
});

test('malformed portfolio route IDs stop before data or transaction access', {
  concurrency: false,
}, async (t) => {
  const calls = installDatabaseSpies(t);
  const server = await listen(createApp());
  t.after(server.close);

  for (const [method, path, body] of [
    ['GET', '/api/portfolios/22junk'],
    ['PUT', '/api/portfolios/22junk', {}],
    ['POST', '/api/portfolios/22junk/submit'],
    ['POST', '/api/portfolios/22junk/documents'],
    ['DELETE', '/api/portfolios/22junk'],
    ['GET', '/api/portfolios/22/documents/9junk/download'],
    ['DELETE', '/api/portfolios/22/documents/9junk'],
  ]) {
    const before = { ...calls };
    const result = await request(server, method, path, body);
    assert.equal(result.response.status, 400, `${method} ${path}`);
    assert.deepEqual(calls, before, `${method} ${path} data access`);
  }
});

test('portfolio detail has explicit authorization for all five roles', {
  concurrency: false,
}, async (t) => {
  const calls = installDatabaseSpies(t, {
    query: async (sql, params = []) => {
      const normalized = String(sql).replace(/\s+/g, ' ').trim();
      if (normalized.includes('FROM portfolios p JOIN users u ON u.id = p.owner_id')) {
        return [[{
          id: 20,
          owner_id: 9,
          name: 'Assigned Co',
          status: 'approved',
          owner_name: 'Owner Nine',
          owner_email: 'owner9@example.test',
          doc_count: 1,
          interest_count: 1,
        }], []];
      }
      if (normalized === 'SELECT 1 FROM portfolios WHERE id=? AND relationship_manager_id=?') {
        return [Number(params[1]) === 7 ? [{ 1: 1 }] : [], []];
      }
      if (
        normalized
          === 'SELECT * FROM portfolio_documents WHERE portfolio_id = ? ORDER BY uploaded_at DESC'
      ) {
        return [[{
          id: 51,
          portfolio_id: 20,
          file_name: 'deck.pdf',
          file_url: '/uploads/portfolio-documents/deck.pdf',
          file_type: 'pitch_deck',
        }], []];
      }
      throw new Error(`Unexpected query: ${normalized}`);
    },
  });
  const server = await listen(createApp());
  t.after(server.close);

  for (const [role, id] of [
    ['business_owner', 9],
    ['investor', 11],
    ['relationship_manager', 7],
    ['admin', 2],
  ]) {
    const result = await requestAs(server, 'GET', '/api/portfolios/20', { role, id });
    assert.equal(result.response.status, 200, `${role} should be allowed`);
    assert.equal(result.payload.id, 20);
    assert.equal(
      result.payload.documents[0].download_url,
      '/api/portfolios/20/documents/51/download',
    );
  }

  for (const [role, id] of [
    ['business_owner', 10],
    ['relationship_manager', 8],
    ['superadmin', 1],
    ['auditor', 3],
  ]) {
    const result = await requestAs(server, 'GET', '/api/portfolios/20', { role, id });
    assert.equal(result.response.status, 403, `${role} should be denied`);
    assert.equal(result.payload.error, 'Forbidden');
  }
  assert.equal(calls.getConnection, 0);
});

test('investors cannot read an unapproved portfolio while admin can moderate it', {
  concurrency: false,
}, async (t) => {
  installDatabaseSpies(t, {
    query: async (sql) => {
      const normalized = String(sql).replace(/\s+/g, ' ').trim();
      if (normalized.includes('FROM portfolios p JOIN users u ON u.id = p.owner_id')) {
        return [[{
          id: 20,
          owner_id: 9,
          name: 'Pending Co',
          status: 'pending',
          owner_name: 'Owner Nine',
          owner_email: 'owner9@example.test',
          doc_count: 0,
          interest_count: 0,
        }], []];
      }
      if (
        normalized
          === 'SELECT * FROM portfolio_documents WHERE portfolio_id = ? ORDER BY uploaded_at DESC'
      ) {
        return [[], []];
      }
      throw new Error(`Unexpected query: ${normalized}`);
    },
  });
  const server = await listen(createApp());
  t.after(server.close);

  const investor = await requestAs(server, 'GET', '/api/portfolios/20', {
    role: 'investor',
    id: 11,
  });
  assert.equal(investor.response.status, 403);
  assert.equal(investor.payload.error, 'Portfolio not available');

  const admin = await requestAs(server, 'GET', '/api/portfolios/20', {
    role: 'admin',
    id: 2,
  });
  assert.equal(admin.response.status, 200);
  assert.equal(admin.payload.status, 'pending');
});
