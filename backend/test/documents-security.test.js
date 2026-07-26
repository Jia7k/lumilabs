const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const multer = require('multer');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'documents-security-test-secret';

const db = require('../src/config/db');
const { createApp } = require('../server');
const { fileFilter } = require('../src/middleware/upload');

const root = path.join(__dirname, '..', '..');
const uploadDirectory = path.join(root, 'backend/uploads/portfolio-documents');
const route = fs.readFileSync(path.join(root, 'backend/src/routes/portfolios.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'backend/server.js'), 'utf8');
const apiClient = fs.readFileSync(path.join(root, 'js/api.js'), 'utf8');
const moderatorClient = fs.readFileSync(path.join(root, 'js/moderatordashboard.js'), 'utf8');

function runFileFilter(file) {
  return new Promise((resolve) => {
    fileFilter(null, file, (error, accepted) => resolve({ error, accepted }));
  });
}

async function listen(app) {
  const httpServer = await new Promise((resolve, reject) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    listener.once('error', reject);
  });
  return {
    origin: `http://127.0.0.1:${httpServer.address().port}`,
    close: () => new Promise((resolve, reject) => {
      httpServer.close((error) => (error ? reject(error) : resolve()));
    }),
  };
}

function roleToken(role, id) {
  return jwt.sign({
    id,
    email: `${role}-${id}@example.test`,
    name: `${role} ${id}`,
    role,
  }, process.env.JWT_SECRET);
}

function ownerToken() {
  return roleToken('business_owner', 7);
}

test('an allowed MIME with an html extension is rejected', async () => {
  const { error } = await runFileFilter({
    mimetype: 'application/pdf',
    originalname: 'payload.html',
  });
  assert.ok(error instanceof multer.MulterError);
});

test('a complete 255-code-point document filename is accepted', async () => {
  const originalname = `${'a'.repeat(251)}.pdf`;
  assert.equal(Array.from(originalname).length, 255);

  const result = await runFileFilter({
    mimetype: 'application/pdf',
    originalname,
  });

  assert.equal(result.error, null);
  assert.equal(result.accepted, true);
});

test('a complete 256-code-point document filename is rejected', async () => {
  const originalname = `${'a'.repeat(252)}.pdf`;
  assert.equal(Array.from(originalname).length, 256);

  const { error } = await runFileFilter({
    mimetype: 'application/pdf',
    originalname,
  });

  assert.ok(error instanceof multer.MulterError);
});

test('astral document filename limits are measured in code points', async () => {
  const exact = `${'😀'.repeat(251)}.pdf`;
  const overflow = `${'😀'.repeat(252)}.pdf`;
  assert.equal(Array.from(exact).length, 255);
  assert.equal(Array.from(overflow).length, 256);

  const accepted = await runFileFilter({
    mimetype: 'application/pdf',
    originalname: exact,
  });
  const rejected = await runFileFilter({
    mimetype: 'application/pdf',
    originalname: overflow,
  });

  assert.equal(accepted.error, null);
  assert.equal(accepted.accepted, true);
  assert.ok(rejected.error instanceof multer.MulterError);
});

test('an overlong multipart filename is rejected before storage or transaction', {
  concurrency: false,
}, async (t) => {
  const originals = {
    query: db.query,
    getConnection: db.getConnection,
  };
  let queryCalls = 0;
  let connectionCalls = 0;
  db.query = async (sql, params) => {
    queryCalls += 1;
    assert.match(sql, /SELECT \* FROM portfolios WHERE id = \? AND owner_id = \?/);
    assert.deepEqual(params, [12, 7]);
    return [[{ id: 12, owner_id: 7, status: 'draft' }], []];
  };
  db.getConnection = async () => {
    connectionCalls += 1;
    throw new Error('A rejected upload must not start a transaction');
  };
  t.after(() => {
    db.query = originals.query;
    db.getConnection = originals.getConnection;
  });

  const before = fs.readdirSync(uploadDirectory).sort();
  const httpServer = await listen(createApp());
  t.after(httpServer.close);

  const form = new FormData();
  form.append(
    'documents',
    new Blob(['valid pdf bytes'], { type: 'application/pdf' }),
    `${'a'.repeat(252)}.pdf`,
  );
  const response = await fetch(`${httpServer.origin}/api/portfolios/12/documents`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ownerToken()}`,
    },
    body: form,
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'Invalid document upload' });
  assert.deepEqual(fs.readdirSync(uploadDirectory).sort(), before);
  assert.equal(queryCalls, 1);
  assert.equal(connectionCalls, 0);
});

test('the owned portfolio is checked before multer writes a file', () => {
  assert.match(route, /loadOwnedEditablePortfolio,\s*upload\.array\('documents', 5\)/);
});

test('draft documents are unavailable to unrelated investors', () => {
  assert.match(route, /case 'investor':[\s\S]*portfolio\.status === 'approved'/);
  assert.match(route, /return res\.status\(403\)\.json\(\{ error: 'Forbidden' \}\)/);
});

test('relationship-manager document access uses the canonical portfolio assignment', () => {
  assert.match(route, /case 'relationship_manager':/);
  assert.match(
    route,
    /FROM portfolios\s+WHERE id=\? AND relationship_manager_id=\?/,
  );
  assert.doesNotMatch(
    route,
    /relationshipManagerCanAccessPortfolio[\s\S]*FROM conversations c[\s\S]*conversation_members/,
  );
  assert.doesNotMatch(route, /req\.user\.role === 'relationship_manager'\s*\|\|/);
});

test('assigned manager can download before chat and another manager cannot', {
  concurrency: false,
}, async (t) => {
  const originalQuery = db.query;
  const filename = `task-7-assigned-download-${process.pid}.pdf`;
  const absolute = path.join(uploadDirectory, filename);
  fs.writeFileSync(absolute, 'assigned document');
  t.after(() => {
    db.query = originalQuery;
    fs.rmSync(absolute, { force: true });
  });

  const calls = [];
  db.query = async (sql, params = []) => {
    const normalized = String(sql).replace(/\s+/g, ' ').trim();
    calls.push({ sql: normalized, params });
    if (normalized.startsWith('SELECT d.*, p.owner_id, p.status')) {
      return [[{
        id: 51,
        portfolio_id: 20,
        file_name: 'deck.pdf',
        file_url: `/uploads/portfolio-documents/${filename}`,
        owner_id: 9,
        status: 'approved',
      }], []];
    }
    if (
      normalized
        === 'SELECT 1 FROM portfolios WHERE id=? AND relationship_manager_id=?'
    ) {
      return [Number(params[0]) === 20 && Number(params[1]) === 7 ? [{ 1: 1 }] : [], []];
    }
    throw new Error(`Unexpected query: ${normalized}`);
  };

  const httpServer = await listen(createApp());
  t.after(httpServer.close);
  const downloadAsManager = (managerId) => fetch(
    `${httpServer.origin}/api/portfolios/20/documents/51/download`,
    {
      headers: {
        Authorization: `Bearer ${roleToken('relationship_manager', managerId)}`,
      },
    },
  );

  const assigned = await downloadAsManager(7);
  assert.equal(assigned.status, 200);
  assert.equal(await assigned.text(), 'assigned document');
  const other = await downloadAsManager(8);
  assert.equal(other.status, 403);
  assert.deepEqual(await other.json(), { error: 'Forbidden' });
  assert.equal(
    calls.filter(({ sql }) => (
      sql === 'SELECT 1 FROM portfolios WHERE id=? AND relationship_manager_id=?'
    )).length,
    2,
  );
});

test('document downloads explicitly authorize each role and deny superadmin fallthrough', {
  concurrency: false,
}, async (t) => {
  const originalQuery = db.query;
  const filename = `task-7-role-download-${process.pid}.pdf`;
  const absolute = path.join(uploadDirectory, filename);
  fs.writeFileSync(absolute, 'role document');
  t.after(() => {
    db.query = originalQuery;
    fs.rmSync(absolute, { force: true });
  });

  db.query = async (sql, params = []) => {
    const normalized = String(sql).replace(/\s+/g, ' ').trim();
    if (normalized.startsWith('SELECT d.*, p.owner_id, p.status')) {
      return [[{
        id: 51,
        portfolio_id: 20,
        file_name: 'deck.pdf',
        file_url: `/uploads/portfolio-documents/${filename}`,
        owner_id: 9,
        status: 'approved',
      }], []];
    }
    if (normalized === 'SELECT 1 FROM portfolios WHERE id=? AND relationship_manager_id=?') {
      return [Number(params[1]) === 7 ? [{ 1: 1 }] : [], []];
    }
    throw new Error(`Unexpected query: ${normalized}`);
  };

  const httpServer = await listen(createApp());
  t.after(httpServer.close);
  const downloadAs = (role, id) => fetch(
    `${httpServer.origin}/api/portfolios/20/documents/51/download`,
    {
      headers: {
        Authorization: `Bearer ${roleToken(role, id)}`,
      },
    },
  );

  for (const [role, id] of [
    ['business_owner', 9],
    ['investor', 11],
    ['relationship_manager', 7],
    ['admin', 2],
  ]) {
    const allowed = await downloadAs(role, id);
    assert.equal(allowed.status, 200, `${role} should be allowed`);
    assert.equal(await allowed.text(), 'role document');
  }
  for (const [role, id] of [
    ['business_owner', 10],
    ['relationship_manager', 8],
    ['superadmin', 1],
    ['auditor', 3],
  ]) {
    const denied = await downloadAs(role, id);
    assert.equal(denied.status, 403, `${role} should be denied`);
    assert.deepEqual(await denied.json(), { error: 'Forbidden' });
  }
});

test('download responses use attachment disposition', () => {
  assert.match(route, /documents\/:docId\/download/);
  assert.match(route, /res\.download\(absolute, doc\.file_name\)/);
  assert.doesNotMatch(server, /express\.static\(path\.join\(__dirname, 'uploads'\)\)/);
});

test('multer size and type failures return 4xx JSON', () => {
  assert.match(server, /error instanceof multer\.MulterError/);
  assert.match(server, /error\.code === 'LIMIT_FILE_SIZE' \? 413 : 400/);
});

test('browser document downloads are intercepted and sent with authentication', () => {
  assert.match(apiClient, /downloadDocument:\s*downloadDocument/);
  assert.match(apiClient, /fetch\(downloadUrl,\s*\{[\s\S]*Authorization/);
  assert.match(moderatorClient, /data-document-download/);
  assert.match(moderatorClient, /preventDefault\(\)/);
});
